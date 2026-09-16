import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

const TYPES = {
  discovery: { label: "Discovery", capacity: 1 },
  virtual: { label: "Virtual Selection", capacity: 2 },
  final: { label: "Final", capacity: 2 }
};

const TEAM = ["Jonathan", "Juan", "Missy"];

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

function weekday(dateValue) {
  const date =
    new Date(`${dateValue}T12:00:00`);

  return Number.isNaN(date.getTime())
    ? -1
    : date.getDay();
}

function baseSlots(type, dateValue) {
  const day = weekday(dateValue);

  // Sunday / Monday closed
  if (day === 0 || day === 1) {
    return [];
  }

  // Discovery: Tue-Fri only
  if (type === "discovery") {
    if (day === 6) return [];

    return [
      "11:00",
      "12:30",
      "14:00",
      "15:30",
      "17:00"
    ];
  }

  // Virtual: Tue-Fri only
  if (type === "virtual") {
    if (day === 6) return [];

    return [
      "10:00",
      "15:00"
    ];
  }

  // Final
  if (type === "final") {
    if (day === 6) {
      return [
        "09:00",
        "14:00"
      ];
    }

    return [
      "10:00",
      "15:00"
    ];
  }

  return [];
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

function ruleMatchesDate(rule, dateValue) {
  const day = weekday(dateValue);

  if (day < 0) return false;

  if (rule.recurrence === "once") {
    return (
      Boolean(rule.startDate) &&
      rule.startDate === dateValue
    );
  }

  if (Number(rule.weekday) !== day) {
    return false;
  }

  if (
    rule.startDate &&
    dateValue < rule.startDate
  ) {
    return false;
  }

  if (
    rule.endDate &&
    dateValue > rule.endDate
  ) {
    return false;
  }

  return true;
}

function ruleMatchesTime(rule, time) {
  // No times = all day
  if (!rule.startTime && !rule.endTime) {
    return true;
  }

  if (!rule.startTime || !rule.endTime) {
    return false;
  }

  return (
    time >= rule.startTime &&
    time < rule.endTime
  );
}

function ruleApplies(
  rule,
  dateValue,
  time
) {
  return (
    ruleMatchesDate(rule, dateValue) &&
    ruleMatchesTime(rule, time)
  );
}

function availableStaff(
  type,
  rules,
  dateValue,
  time
) {
  const studioBlocked =
    rules.some(
      rule =>
        rule.kind === "meeting" &&
        !rule.person &&
        ruleApplies(
          rule,
          dateValue,
          time
        )
    );

  if (studioBlocked) {
    return [];
  }

  return TEAM.filter(person => {
    const off =
      rules.some(
        rule =>
          rule.kind === "off" &&
          rule.person === person &&
          ruleApplies(
            rule,
            dateValue,
            time
          )
      );

    if (off) return false;

    const meeting =
      rules.some(
        rule =>
          rule.kind === "meeting" &&
          rule.person === person &&
          ruleApplies(
            rule,
            dateValue,
            time
          )
      );

    if (meeting) return false;

    if (type === "final") {
      const virtualOnly =
        rules.some(
          rule =>
            rule.kind === "virtual" &&
            rule.person === person &&
            ruleApplies(
              rule,
              dateValue,
              time
            )
        );

      if (virtualOnly) {
        return false;
      }
    }

    return true;
  });
}

async function calculateAvailability(
  type,
  dateValue
) {
  if (!TYPES[type]) {
    return [];
  }

  const times =
    baseSlots(type, dateValue);

  if (!times.length) {
    return [];
  }

  const [requests, rules] =
    await Promise.all([
      listRecords("requests/"),
      listRecords("rules/")
    ]);

  const output = [];

  for (const time of times) {
    const staff =
      availableStaff(
        type,
        rules,
        dateValue,
        time
      );

    const capacity =
      Math.min(
        TYPES[type].capacity,
        staff.length
      );

    const used =
      requests.filter(
        item =>
          item.type === type &&
          item.date === dateValue &&
          item.time === time &&
          item.status !== "declined"
      ).length;

    const remaining =
      Math.max(
        0,
        capacity - used
      );

    if (remaining > 0) {
      output.push({
        time,
        label: timeLabel(time),
        capacity,
        used,
        remaining,
        availablePeople: staff
      });
    }
  }

  return output;
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
  const requestURL =
    new URL(request.url);

  const action =
    requestURL
      .searchParams
      .get("action") || "";

  try {

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

      existing.status =
        status;

      existing.updatedAt =
        new Date().toISOString();

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
