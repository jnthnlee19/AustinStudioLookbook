import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";
import { withBookingWriteLock } from "./lib/booking-write-lock.mjs";

import { TYPES, TEAM, weekday, ruleMatchesDate, availability, assignAppointments } from '../../assets/booking-schedule.mjs';

const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

function reply(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}

function getBookingStore() {
  return getStore({
    name: "austin-studio-booking",
    consistency: "strong"
  });
}

function clean(value, max = 300) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function dateLabel(value) {
  if (!value) return "";

  const date =
    new Date(`${value}T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString(
    "en-US",
    {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    }
  );
}

function timeLabel(value) {
  if (!value) return "";

  const [hText, mText] =
    String(value).split(":");

  const hour = Number(hText);
  const minute = Number(mText);

  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return value;
  }

  return (
    `${hour % 12 || 12}:` +
    `${String(minute).padStart(2, "0")} ` +
    `${hour >= 12 ? "PM" : "AM"}`
  );
}

async function listRecords(prefix) {
  const store = getBookingStore();
  const records = [];

  let cursor;

  do {
    const result =
      await store.list({
        prefix,
        cursor
      });

    for (const blob of result.blobs) {
      const record =
        await store.get(
          blob.key,
          { type: "json" }
        );

      if (record) {
        records.push(record);
      }
    }

    cursor = result.cursor;

  } while (cursor);

  return records;
}

async function calculateAvailability(type, dateValue) {
  const [requests, rules] = await Promise.all([listRecords('requests/'), listRecords('rules/')]);
  return availability(type, dateValue, requests, rules).map(slot => ({ ...slot, label: timeLabel(slot.time) }));
}

async function getRequests() {
  const requests =
    await listRecords("requests/");

  return requests.sort((a, b) => {
    const aValue =
      `${a.date || ""}T${a.time || "00:00"}`;

    const bValue =
      `${b.date || ""}T${b.time || "00:00"}`;

    return (
      new Date(aValue) -
      new Date(bValue)
    );
  });
}

async function getRules() {
  const rules =
    await listRecords("rules/");

  return rules.sort((a, b) => {
    const dayDiff =
      Number(a.weekday || 0) -
      Number(b.weekday || 0);

    if (dayDiff !== 0) {
      return dayDiff;
    }

    return String(
      a.startTime || ""
    ).localeCompare(
      String(b.startTime || "")
    );
  });
}

export default async function handler(request) {
  const action = new URL(request.url).searchParams.get('action');
  if (request.method === 'POST' && ['request', 'status', 'assign', 'rule', 'delete-rule'].includes(action)) {
    try {
      return await withBookingWriteLock(getBookingStore(), assertLease => handleAction(request, assertLease));
    } catch (error) {
      return reply({ error: error.message || 'Could not update scheduling.' }, error.status || 500);
    }
  }
  return handleAction(request);
}

async function handleAction(request, assertLease = () => {}) {
  const requestURL =
    new URL(request.url);

  const action =
    requestURL
      .searchParams
      .get("action") || "";

  try {
    if (action === 'assign' && request.method === 'POST') {
      const body = await request.json();
      const id = clean(body?.id, 100);
      const assignedTo = clean(body?.assignedTo, 100);
      if (!id || typeof body?.assignedTo !== 'string' || (assignedTo && !TEAM.includes(assignedTo))) {
        return reply({ error: 'Choose Jonathan, Juan, Missy, or Unassigned.' }, 400);
      }
      const store = getBookingStore();
      const existing = await store.get(`requests/${id}`, { type: 'json' });
      if (!existing) return reply({ error: 'Appointment request not found.' }, 404);
      if (existing.status === 'declined') return reply({ error: 'A declined request cannot be assigned.' }, 409);
      const updated = { ...existing, assignedTo, updatedAt: new Date().toISOString() };
      if (assignedTo) {
        const [requests, rules] = await Promise.all([getRequests(), getRules()]);
        const active = requests.filter(item => item.id !== id && item.date === existing.date && item.status !== 'declined');
        if (!assignAppointments([...active, updated], rules, existing.date)) {
          return reply({ error: 'That assignment conflicts with appointments, time off, a meeting, Virtual Only restrictions, or front-desk coverage. Choose another consultant.' }, 409);
        }
      }
      assertLease();
      await store.setJSON(`requests/${id}`, updated);
      return reply({ success: true, request: updated });
    }

    // =====================================================
    // AVAILABILITY
    // =====================================================

    if (action === "availability") {
      const type =
        clean(
          requestURL
            .searchParams
            .get("type"),
          50
        );

      const date =
        clean(
          requestURL
            .searchParams
            .get("date"),
          20
        );

      if (!TYPES[type]) {
        return reply(
          {
            error:
              "Invalid appointment type."
          },
          400
        );
      }

      if (!date) {
        return reply(
          {
            error:
              "A date is required."
          },
          400
        );
      }

      return reply({
        success: true,
        type,
        date,
        slots:
          await calculateAvailability(
            type,
            date
          )
      });
    }


    // =====================================================
    // CREATE APPOINTMENT REQUEST
    // =====================================================

    if (
      action === "request" &&
      request.method === "POST"
    ) {
      const body =
        await request.json();

      const type =
        clean(body?.type, 50);

      const date =
        clean(body?.date, 20);

      const time =
        clean(body?.time, 20);

      const name =
        clean(body?.name, 150);

      const email =
        clean(body?.email, 200);

      const phone =
        clean(body?.phone, 80);

      const community =
        clean(body?.community, 150);

      const address =
        clean(body?.address, 250);

      const notes =
        clean(body?.notes, 1000);

      if (!TYPES[type]) {
        return reply(
          {
            error:
              "Invalid appointment type."
          },
          400
        );
      }

      if (
        !name ||
        !email ||
        !phone ||
        !date ||
        !time
      ) {
        return reply(
          {
            error:
              "Name, email, phone, date, and time are required."
          },
          400
        );
      }

      const available =
        await calculateAvailability(
          type,
          date
        );

      const selected =
        available.find(
          slot =>
            slot.time === time
        );

      if (
        !selected ||
        selected.remaining < 1
      ) {
        return reply(
          {
            error:
              "That appointment time is no longer available. Please choose another time."
          },
          409
        );
      }

      const id = randomUUID();
      const now =
        new Date().toISOString();

      const appointment = {
        id,

        type,

        typeLabel:
          TYPES[type].label,

        name,
        email,
        phone,
        community,
        address,
        notes,

        date,

        dateLabel:
          dateLabel(date),

        time,

        timeLabel:
          timeLabel(time),

        status:
          "requested",

        assignedTo:
          "",

        createdAt:
          now,

        updatedAt:
          now
      };

      assertLease();
      await getBookingStore()
        .setJSON(
          `requests/${id}`,
          appointment
        );

      return reply(
        {
          success: true,
          id,
          status: "requested",
          dateLabel:
            appointment.dateLabel,
          timeLabel:
            appointment.timeLabel
        },
        201
      );
    }


    // =====================================================
    // LIST REQUESTS
    // =====================================================

    if (action === "requests") {
      return reply({
        success: true,
        requests:
          await getRequests()
      });
    }


    // =====================================================
    // UPDATE REQUEST STATUS
    // =====================================================

    if (
      action === "status" &&
      request.method === "POST"
    ) {
      const body =
        await request.json();

      const id =
        clean(body?.id, 100);

      const status =
        clean(body?.status, 30);

      if (
        !id ||
        ![
          "requested",
          "confirmed",
          "declined"
        ].includes(status)
      ) {
        return reply(
          {
            error:
              "Invalid request status update."
          },
          400
        );
      }

      const bookingStore =
        getBookingStore();

      const key =
        `requests/${id}`;

      const existing =
        await bookingStore.get(
          key,
          { type: "json" }
        );

      if (!existing) {
        return reply(
          {
            error:
              "Appointment request not found."
          },
          404
        );
      }

      if (existing.status === 'declined' && status !== 'declined') {
        const slots = await calculateAvailability(existing.type, existing.date);
        if (!slots.some(slot => slot.time === existing.time && slot.remaining > 0)) {
          return reply({ error: 'That time no longer has capacity. Keep this request declined and select another time.' }, 409);
        }
        const [requests, rules] = await Promise.all([getRequests(), getRules()]);
        const active = requests.filter(item => item.id !== id && item.date === existing.date && item.status !== 'declined');
        if (!assignAppointments([...active, { ...existing, status }], rules, existing.date)) {
          return reply({ error: 'The assigned consultant is no longer available for this appointment.' }, 409);
        }
      }

      existing.status =
        status;

      existing.updatedAt =
        new Date().toISOString();

      assertLease();
      await bookingStore.setJSON(
        key,
        existing
      );

      return reply({
        success: true,
        request: existing
      });
    }


    // =====================================================
    // LIST RULES
    // =====================================================

    if (action === "rules") {
      return reply({
        success: true,
        rules:
          await getRules()
      });
    }


    // =====================================================
    // CREATE RULE
    // =====================================================

    if (
      action === "rule" &&
      request.method === "POST"
    ) {
      const body =
        await request.json();

      const kind =
        clean(body?.kind, 50);

      const person =
        clean(body?.person, 100);

      const recurrence =
        clean(
          body?.recurrence,
          30
        ) || "weekly";

      const startTime =
        clean(
          body?.startTime,
          20
        );

      const endTime =
        clean(
          body?.endTime,
          20
        );

      const startDate =
        clean(
          body?.startDate,
          20
        );

      const endDate =
        clean(
          body?.endDate,
          20
        );

      const label =
        clean(
          body?.label,
          200
        );

      let ruleWeekday =
        Number(
          body?.weekday
        );

      if (
        ![
          "off",
          "virtual",
          "meeting"
        ].includes(kind)
      ) {
        return reply(
          {
            error:
              "Invalid rule type."
          },
          400
        );
      }

      if (
        ![
          "weekly",
          "once"
        ].includes(recurrence)
      ) {
        return reply(
          {
            error:
              "Invalid recurrence type."
          },
          400
        );
      }

      if (
        person &&
        !TEAM.includes(person)
      ) {
        return reply(
          {
            error:
              "Invalid team member."
          },
          400
        );
      }

      if (
        (startTime && !endTime) ||
        (!startTime && endTime)
      ) {
        return reply(
          {
            error:
              "Enter both Start Time and End Time, or leave both blank for an all-day rule."
          },
          400
        );
      }

      if ([startTime, endTime].some(time => time && !/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(time))) {
        return reply({ error: "Choose times in 30-minute increments." }, 400);
      }

      if (
        startTime &&
        endTime &&
        startTime >= endTime
      ) {
        return reply(
          {
            error:
              "End Time must be later than Start Time."
          },
          400
        );
      }

      if (
        startDate &&
        endDate &&
        startDate > endDate
      ) {
        return reply(
          {
            error:
              "End Date must be on or after Start Date."
          },
          400
        );
      }

      if (
        recurrence === "once"
      ) {
        if (!startDate) {
          return reply(
            {
              error:
                "A date is required for a one-time rule."
            },
            400
          );
        }

        ruleWeekday =
          weekday(startDate);
      }

      if (
        !Number.isInteger(
          ruleWeekday
        ) ||
        ruleWeekday < 0 ||
        ruleWeekday > 6
      ) {
        return reply(
          {
            error:
              "A valid weekday is required."
          },
          400
        );
      }

      const id =
        randomUUID();

      const now =
        new Date()
          .toISOString();

      const rule = {
        id,
        kind,
        person,

        weekday:
          ruleWeekday,

        weekdayLabel:
          DAYS[
            ruleWeekday
          ] || "",

        recurrence,
        startTime,
        endTime,
        startDate,
        endDate,

        label:
          label ||
          `${person || "Studio"} ${kind}`,

        createdAt:
          now,

        updatedAt:
          now
      };

      assertLease();
      await getBookingStore()
        .setJSON(
          `rules/${id}`,
          rule
        );

      return reply(
        {
          success: true,
          rule
        },
        201
      );
    }


    // =====================================================
    // DELETE RULE
    // =====================================================

    if (
      action === "delete-rule" &&
      request.method === "POST"
    ) {
      const body =
        await request.json();

      const id =
        clean(
          body?.id,
          100
        );

      if (!id) {
        return reply(
          {
            error:
              "Rule ID is required."
          },
          400
        );
      }

      assertLease();
      await getBookingStore()
        .delete(
          `rules/${id}`
        );

      return reply({
        success: true
      });
    }


    // =====================================================
    // CALENDAR DAY
    // =====================================================

    if (
      action === "calendar-day"
    ) {
      const date =
        clean(
          requestURL
            .searchParams
            .get("date"),
          20
        );

      if (!date) {
        return reply(
          {
            error:
              "A date is required."
          },
          400
        );
      }

      const [
        requests,
        rules,
        discovery,
        virtual,
        final
      ] =
        await Promise.all([
          getRequests(),
          getRules(),

          calculateAvailability(
            "discovery"
                       ,
            date
          ),

          calculateAvailability(
            "virtual",
            date
          ),

          calculateAvailability(
            "final",
            date
          )

        ]);


      const dateObject =
        new Date(
          `${date}T12:00:00`
        );


      const dayNumber =
        dateObject.getDay();


      return reply({

        success: true,

        date,

        dateLabel:
          dateLabel(date),

        weekday:
          dayNumber,

        weekdayLabel:
          DAYS[
            dayNumber
          ] || "",


        requests:
          requests.filter(
            item =>
              item.date === date &&
              item.status !== "declined"
          ),


        rules:
          rules.filter(
            rule =>
              ruleMatchesDate(
                rule,
                date
              )
          ),


        availability: {

          discovery,

          virtual,

          final

        }

      });

    }


    // =====================================================
    // UNKNOWN ACTION
    // =====================================================

    return reply(
      {
        error:
          "Unknown booking action."
      },
      404
    );


  } catch (error) {

    console.error(
      "BOOKING API ERROR:",
      error
    );


    return reply(
      {
        error:
          error.message ||
          "Something went wrong with the booking system."
      },
      500
    );

  }

}


/* =========================================================
   END OF booking-api.mjs
   ========================================================= */
