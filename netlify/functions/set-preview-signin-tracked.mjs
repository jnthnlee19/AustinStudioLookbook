import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const STORE_NAME = "austin-preview-event-signins";
const COOKIE_NAME = "austin_studio_dashboard_auth";

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const index = part.indexOf("=");

        return index === -1
          ? [part, ""]
          : [
              part.slice(0, index),
              part.slice(index + 1)
            ];
      })
  );
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex");
}

function respond(body, status = 200) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      }
    }
  );
}

export default async (request) => {

  if (request.method !== "POST") {
    return respond(
      {
        error: "Method not allowed."
      },
      405
    );
  }


  /*
    USE THE SAME PASSWORD AUTHENTICATION
    AS THE AUSTIN STUDIO HUB
  */

  const password =
    process.env.PROTECTED_PAGE_PASSWORD;

  if (!password) {
    return respond(
      {
        error:
          "Dashboard authentication is not configured."
      },
      503
    );
  }


  const cookies =
    parseCookies(
      request.headers.get("cookie") || ""
    );


  if (
    cookies[COOKIE_NAME] !==
    sha256(password)
  ) {
    return respond(
      {
        error: "Unauthorized."
      },
      401
    );
  }


  try {

    const body =
      await request.json();


    const id =
      String(
        body.id || ""
      ).trim();


    const createdAt =
      String(
        body.createdAt || ""
      ).trim();


    const eventTracked =
      body.eventTracked === true;


    if (
      !id ||
      !createdAt
    ) {
      return respond(
        {
          error:
            "Missing Preview Event submission information."
        },
        400
      );
    }


    /*
      Rebuild the same Blob key that was
      created when the customer signed in.
    */

    const key =
      `submissions/${
        createdAt.replace(
          /[:.]/g,
          "-"
        )
      }-${id}`;


    const store =
      getStore(
        STORE_NAME
      );


    const submission =
      await store.get(
        key,
        {
          type: "json"
        }
      );


    if (!submission) {
      return respond(
        {
          error:
            "Preview Event submission not found."
        },
        404
      );
    }


    /*
      SAVE EVENT TRACKED STATUS
    */

    submission.eventTracked =
      eventTracked;


    submission.eventTrackedAt =
      eventTracked
        ? new Date().toISOString()
        : null;


    await store.setJSON(
      key,
      submission
    );


    return respond({
      ok: true,

      eventTracked:
        submission.eventTracked,

      eventTrackedAt:
        submission.eventTrackedAt
    });


  } catch (error) {

    console.error(
      "PREVIEW TRACKING UPDATE ERROR:",
      error
    );


    return respond(
      {
        error:
          "Unable to update Event Tracked status."
      },
      500
    );

  }

};
