import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";


/* =========================================================
   AUSTIN DESIGN STUDIO
   BOOKING / APPOINTMENT REQUEST API
   ========================================================= */


/* ---------------------------------------------------------
   BASIC CONFIGURATION
   --------------------------------------------------------- */

const APPOINTMENT_TYPES = {

  discovery: {
    label: "Discovery",
    capacity: 1
  },

  virtual: {
    label: "Virtual Selection",
    capacity: 2
  },

  final: {
    label: "Final",
    capacity: 2
  }

};


const TEAM_MEMBERS = [
  "Jonathan",
  "Juan",
  "Missy"
];


const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];



/* =========================================================
   JSON RESPONSE
   ========================================================= */

function jsonResponse(
  data,
  status = 200
) {

  return new Response(
    JSON.stringify(
      data
    ),
    {
      status,

      headers: {

        "Content-Type":
          "application/json",

        "Cache-Control":
          "no-store"

      }
    }
  );

}



/* =========================================================
   NETLIFY BLOB STORE
   ========================================================= */

function getBookingStore() {

  return getStore({
    name:
      "austin-studio-booking",

    consistency:
      "strong"
  });

}



/* =========================================================
   CLEAN TEXT
   ========================================================= */

function cleanText(
  value,
  maxLength = 300
) {

  return String(
    value ?? ""
  )
    .trim()
    .slice(
      0,
      maxLength
    );

}



/* =========================================================
   TIME FORMATTING
   ========================================================= */

function formatTimeLabel(
  value
) {

  if (!value) {
    return "";
  }


  const [
    hourText,
    minuteText
  ] =
    String(value)
      .split(":");


  const hour =
    Number(
      hourText
    );


  const minute =
    Number(
      minuteText
    );


  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {

    return value;

  }


  const suffix =
    hour >= 12
      ? "PM"
      : "AM";


  const displayHour =
    hour % 12 || 12;


  return (
    `${displayHour}:` +
    `${String(minute).padStart(2, "0")} ` +
    suffix
  );

}



/* =========================================================
   DATE FORMATTING
   ========================================================= */

function formatDateLabel(
  value
) {

  if (!value) {
    return "";
  }


  const date =
    new Date(
      `${value}T12:00:00`
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return value;

  }


  return date.toLocaleDateString(
    "en-US",
    {
      weekday:
        "long",

      month:
        "long",

      day:
        "numeric",

      year:
        "numeric"
    }
  );

}



/* =========================================================
   BASE APPOINTMENT TIMES

   CURRENT RULES:

   CLOSED:
   Sunday
   Monday

   DISCOVERY:
   Tuesday-Friday
   30-minute appointments
   1-hour break between appointments

   VIRTUAL:
   Tuesday-Friday
   10 AM / 3 PM

   FINAL:
   Tuesday-Friday
   10 AM / 3 PM

   Saturday:
   Final only
   9 AM / 2 PM
   ========================================================= */

function getBaseSlots(
  appointmentType,
  dateValue
) {

  const date =
    new Date(
      `${dateValue}T12:00:00`
    );


  const day =
    date.getDay();


  /*
    Sunday / Monday
  */

  if (
    day === 0 ||
    day === 1
  ) {

    return [];

  }


  /*
    DISCOVERY

    30-minute appointment followed by
    a 1-hour buffer before the next
    Discovery starts.

    Start times:
    11:00
    12:30
    2:00
    3:30
    5:00
  */

  if (
    appointmentType ===
    "discovery"
  ) {

    if (
      day === 6
    ) {

      return [];

    }


    return [
      "11:00",
      "12:30",
      "14:00",
      "15:30",
      "17:00"
    ];

  }


  /*
    VIRTUAL SELECTION
  */

  if (
    appointmentType ===
    "virtual"
  ) {

    if (
      day === 6
    ) {

      return [];

    }


    return [
      "10:00",
      "15:00"
    ];

  }


  /*
    FINAL
  */

  if (
    appointmentType ===
    "final"
  ) {

    if (
      day === 6
    ) {

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



/* =========================================================
   READ ALL BLOB RECORDS
   ========================================================= */

async function listRecords(
  prefix
) {

  const store =
    getBookingStore();


  const records = [];


  let cursor =
    undefined;


  do {

    const result =
      await store.list({
        prefix,
        cursor
      });


    for (
      const blob
      of result.blobs
    ) {

      const record =
        await store.get(
          blob.key,
          {
            type:
              "json"
          }
        );


      if (record) {

        records.push(
          record
        );

      }

    }


    cursor =
      result.cursor;


  } while (cursor);


  return records;

}



/* =========================================================
   RULE DATE CHECK
   ========================================================= */

function ruleMatchesDate(
  rule,
  dateValue
) {

  const date =
    new Date(
      `${dateValue}T12:00:00`
    );


  if (
    Number.isNaN(
      date.getTime()
    )
  ) {

    return false;

  }


  const weekday =
    date.getDay();


  /*
    Correct weekday?
  */

  if (
    Number(
      rule.weekday
    ) !==
    weekday
  ) {

    return false;

  }


  /*
    Before rule start date?
  */

  if (
    rule.startDate &&
    dateValue <
    rule.startDate
  ) {

    return false;

  }


  /*
    After rule end date?
  */

  if (
    rule.endDate &&
    dateValue >
    rule.endDate
  ) {

    return false;

  }


  /*
    One-time rule
  */

  if (
    rule.recurrence ===
      "once" &&
    rule.startDate &&
    dateValue !==
      rule.startDate
  ) {

    return false;

  }


  return true;

}



/* =========================================================
   RULE TIME CHECK
   ========================================================= */

function ruleMatchesTime(
  rule,
  timeValue
) {

  /*
    No times means all-day rule.
  */

  if (
    !rule.startTime &&
    !rule.endTime
  ) {

    return true;

  }


  /*
    If only one time was accidentally
    entered, don't apply the partial block.
  */

  if (
    !rule.startTime ||
    !rule.endTime
  ) {

    return false;

  }


  return (
    timeValue >=
      rule.startTime &&

    timeValue <
      rule.endTime
  );

}



/* =========================================================
   COMPLETE RULE CHECK
   ========================================================= */

function ruleApplies(
  rule,
  dateValue,
  timeValue
) {

  return (
    ruleMatchesDate(
      rule,
      dateValue
    ) &&

    ruleMatchesTime(
      rule,
      timeValue
    )
  );

}



/* =========================================================
   CALCULATE AVAILABILITY
   ========================================================= */

async function calculateAvailability(
  appointmentType,
  dateValue
) {

  const typeConfig =
    APPOINTMENT_TYPES[
      appointmentType
    ];


  if (!typeConfig) {

    return [];

  }


  const baseSlots =
    getBaseSlots(
      appointmentType,
      dateValue
    );


  if (
    baseSlots.length === 0
  ) {

    return [];

  }


  const [
    requests,
    rules
  ] =
    await Promise.all([
      listRecords(
        "requests/"
      ),

      listRecords(
        "rules/"
      )
    ]);


  const availableSlots = [];


  for (
    const time
    of baseSlots
  ) {

    let capacity =
      typeConfig.capacity;


    /*
      -----------------------------------------
      STAFF OFF
      -----------------------------------------
    */

    const peopleOff =
      new Set();


    TEAM_MEMBERS.forEach(
      person => {

        const off =
          rules.some(
            rule =>

              rule.kind ===
                "off" &&

              rule.person ===
                person &&

              ruleApplies(
                rule,
                dateValue,
                time
              )
          );


        if (off) {

          peopleOff.add(
            person
          );

        }

      }
    );


    let availableStaff =
      TEAM_MEMBERS.length -
      peopleOff.size;



    /*
      -----------------------------------------
      ENTIRE STUDIO BLOCK

      Example:
      Tuesday Team Meeting
      -----------------------------------------
    */

    const studioBlocked =
      rules.some(
        rule =>

          rule.kind ===
            "meeting" &&

          !rule.person &&

          ruleApplies(
            rule,
            dateValue,
            time
          )
      );


    if (studioBlocked) {

      availableStaff = 0;

    }



    /*
      -----------------------------------------
      INDIVIDUAL MEETING / BLOCK

      Person isn't OFF all day, but isn't
      available during this particular time.
      -----------------------------------------
    */

    const peopleInMeetings =
      new Set();


    TEAM_MEMBERS.forEach(
      person => {

        const blocked =
          rules.some(
            rule =>

              rule.kind ===
                "meeting" &&

              rule.person ===
                person &&

              ruleApplies(
                rule,
                dateValue,
                time
              )
          );


        if (blocked) {

          peopleInMeetings.add(
            person
          );

        }

      }
    );


    availableStaff =
      Math.max(
        0,

        availableStaff -
        peopleInMeetings.size
      );



    /*
      -----------------------------------------
      VIRTUAL ONLY

      Virtual-only employees can take:

      Discovery
      Virtual Selection

      They cannot take:
      Final / In-person
      -----------------------------------------
    */

    if (
      appointmentType ===
      "final"
    ) {

      const virtualOnly =
        new Set();


      TEAM_MEMBERS.forEach(
        person => {

          const virtual =
            rules.some(
              rule =>

                rule.kind ===
                  "virtual" &&

                rule.person ===
                  person &&

                ruleApplies(
                  rule,
                  dateValue,
                  time
                )
            );


          if (virtual) {

            virtualOnly.add(
              person
            );

          }

        }
      );


      availableStaff =
        Math.max(
          0,

          availableStaff -
          virtualOnly.size
        );

    }



    /*
      Capacity can never exceed
      available staff.
    */

    capacity =
      Math.min(
        capacity,
        availableStaff
      );



    /*
      -----------------------------------------
      CURRENT REQUESTS

      Requested AND confirmed appointments
      consume capacity.

      Declined appointments release capacity.
      -----------------------------------------
    */

    const usedCapacity =
      requests.filter(
        item =>

          item.type ===
            appointmentType &&

          item.date ===
            dateValue &&

          item.time ===
            time &&

          item.status !==
            "declined"
      )
      .length;



    const remaining =
      Math.max(
        0,

        capacity -
        usedCapacity
      );


    if (
      remaining > 0
    ) {

      availableSlots.push({

        time,

        label:
          formatTimeLabel(
            time
          ),

        remaining

      });

    }

  }


  return availableSlots;

}



/* =========================================================
   GET REQUESTS
   ========================================================= */

async function getRequests() {

  const requests =
    await listRecords(
      "requests/"
    );


  return requests.sort(
    (
      a,
      b
    ) => {

      const aDate =
        `${a.date || ""}T${a.time || "00:00"}`;

      const bDate =
        `${b.date || ""}T${b.time || "00:00"}`;


      return (
        new Date(aDate) -
        new Date(bDate)
      );

    }
  );

}



/* =========================================================
   GET RULES
   ========================================================= */

async function getRules() {

  const rules =
    await listRecords(
      "rules/"
    );


  return rules.sort(
    (
      a,
      b
    ) => {

      const dayDifference =
        Number(
          a.weekday || 0
        ) -
        Number(
          b.weekday || 0
        );


      if (
        dayDifference !== 0
      ) {

        return dayDifference;

      }


      return String(
        a.startTime || ""
      )
        .localeCompare(
          String(
            b.startTime || ""
          )
        );

    }
  );

}



/* =========================================================
   MAIN NETLIFY FUNCTION
   ========================================================= */

export default async function handler(
  request
) {

  const requestURL =
    new URL(
      request.url
    );


  const action =
    requestURL
      .searchParams
      .get(
        "action"
      ) || "";


  try {


    /* =====================================================
       AVAILABILITY
       ===================================================== */

    if (
      action ===
      "availability"
    ) {

      const type =
        cleanText(
          requestURL
            .searchParams
            .get(
              "type"
            ),
          50
        );


      const date =
        cleanText(
          requestURL
            .searchParams
            .get(
              "date"
            ),
          20
        );


      if (
        !APPOINTMENT_TYPES[
          type
        ]
      ) {

        return jsonResponse(
          {
            error:
              "Invalid appointment type."
          },
          400
        );

      }


      if (!date) {

        return jsonResponse(
          {
            error:
              "A date is required."
          },
          400
        );

      }


      const slots =
        await calculateAvailability(
          type,
          date
        );


      return jsonResponse({
        success:
          true,

        type,

        date,

        slots
      });

    }



    /* =====================================================
       CREATE APPOINTMENT REQUEST
       ===================================================== */

    if (
      action ===
        "request" &&
      request.method ===
        "POST"
    ) {

      const payload =
        await request.json();


      const type =
        cleanText(
          payload?.type,
          50
        );


      const date =
        cleanText(
          payload?.date,
          20
        );


      const time =
        cleanText(
          payload?.time,
          20
        );


      const name =
        cleanText(
          payload?.name,
          150
        );


      const email =
        cleanText(
          payload?.email,
          200
        );


      const phone =
        cleanText(
          payload?.phone,
          80
        );


      const community =
        cleanText(
          payload?.community,
          150
        );


      const address =
        cleanText(
          payload?.address,
          250
        );


      const notes =
        cleanText(
          payload?.notes,
          1000
        );


      if (
        !APPOINTMENT_TYPES[
          type
        ]
      ) {

        return jsonResponse(
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

        return jsonResponse(
          {
            error:
              "Name, email, phone, date, and time are required."
          },
          400
        );

      }



      /*
        Re-check availability immediately
        before saving.

        This prevents two customers from
        taking the last available request
        spot at the same time.
      */

      const available =
        await calculateAvailability(
          type,
          date
        );


      const selectedSlot =
        available.find(
          slot =>
            slot.time ===
            time
        );


      if (
        !selectedSlot ||
        selectedSlot.remaining < 1
      ) {

        return jsonResponse(
          {
            error:
              "That appointment time is no longer available. Please choose another time."
          },
          409
        );

      }



      const id =
        randomUUID();


      const now =
        new Date()
          .toISOString();


      const appointment =
        {

          id,

          type,

          typeLabel:
            APPOINTMENT_TYPES[
              type
            ].label,

          name,

          email,

          phone,

          community,

          address,

          notes,

          date,

          dateLabel:
            formatDateLabel(
              date
            ),

          time,

          timeLabel:
            formatTimeLabel(
              time
            ),

          /*
            REQUESTED
            CONFIRMED
            DECLINED
          */

          status:
            "requested",

          createdAt:
            now,

          updatedAt:
            now

        };


      const store =
        getBookingStore();


      await store.setJSON(
        `requests/${id}`,
        appointment
      );


      return jsonResponse(
        {
          success:
            true,

          id,

          status:
            appointment.status,

          dateLabel:
            appointment.dateLabel,

          timeLabel:
            appointment.timeLabel
        },
        201
      );

    }



    /* =====================================================
       LIST APPOINTMENT REQUESTS
       ===================================================== */

    if (
      action ===
      "requests"
    ) {

      const requests =
        await getRequests();


      return jsonResponse({
        success:
          true,

        requests
      });

    }



    if (
      action ===
      "requests"
    ) {

      const requests =
        await getRequests();


      return jsonResponse({
        success:
          true,

        requests
      });

    }

      
