import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

const STORE_NAME =
  "austin-preview-event-signins";


const clean = (
  value,
  max = 250
) =>
  String(
    value ?? ""
  )
    .trim()
    .slice(
      0,
      max
    );


export default async (
  request
) => {

  if (
    request.method !==
    "POST"
  ) {

    return new Response(
      JSON.stringify({
        error:
          "Method not allowed."
      }),
      {
        status: 405,
        headers: {
          "Content-Type":
            "application/json"
        }
      }
    );

  }


  try {

    const body =
      await request.json();


    /*
      BOT TRAP
    */
    if (
      clean(
        body.website,
        200
      )
    ) {

      return new Response(
        JSON.stringify({
          ok: true
        }),
        {
          status: 200,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );

    }


    const submission = {

      id:
        crypto.randomUUID(),

      name:
        clean(
          body.name,
          120
        ),

      phone:
        clean(
          body.phone,
          40
        ),

      email:
        clean(
          body.email,
          180
        ),

      underContract:
        clean(
          body.underContract,
          20
        ),

      homeType:
        clean(
          body.homeType,
          120
        ),

      futureAddress:
        clean(
          body.futureAddress,
          220
        ),

      community:
        clean(
          body.community,
          120
        ),

      salesCounselor:
        clean(
          body.salesCounselor,
          120
        ),

      homePlan:
        clean(
          body.homePlan,
          100
        ),

      elevation:
        clean(
          body.elevation,
          80
        ),

      createdAt:
        new Date()
          .toISOString()

    };


    /*
      REQUIRED FOR EVERYONE
    */
    if (
      !submission.name ||
      !submission.phone ||
      !submission.email ||
      !submission.underContract ||
      !submission.homeType ||
      !submission.community
    ) {

      return new Response(
        JSON.stringify({
          error:
            "Please complete all required fields."
        }),
        {
          status: 400,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );

    }


    /*
      VALID HOME TYPES
    */
    if (
      ![
        "Personalized",
        "Move-in Ready"
      ]
        .includes(
          submission.homeType
        )
    ) {

      return new Response(
        JSON.stringify({
          error:
            "Please choose Personalized or Move-in Ready."
        }),
        {
          status: 400,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );

    }


    /*
      IF UNDER CONTRACT:
      ADDRESS, PLAN, AND ELEVATION
      ARE REQUIRED
    */
    if (
      submission
        .underContract ===
        "Yes" &&
      (
        !submission
          .futureAddress ||
        !submission
          .homePlan ||
        !submission
          .elevation
      )
    ) {

      return new Response(
        JSON.stringify({
          error:
            "Future address, home plan, and elevation are required when you are under contract."
        }),
        {
          status: 400,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );

    }


    /*
      EMAIL VALIDATION
    */
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(
          submission.email
        )
    ) {

      return new Response(
        JSON.stringify({
          error:
            "Please enter a valid email address."
        }),
        {
          status: 400,
          headers: {
            "Content-Type":
              "application/json"
          }
        }
      );

    }


    /*
      SUBJECT FORMAT:

      Preview Event
      Community
      Customer Full Name

      Example:
      Preview Event Stoney Chase Jonathan Rice
    */
    submission.subject =
      `Preview Event ${
        submission.community
      } ${
        submission.name
      }`
        .replace(
          /\s+/g,
          " "
        )
        .trim();


    const store =
      getStore(
        STORE_NAME
      );


    const key =
      `submissions/${
        submission
          .createdAt
          .replace(
            /[:.]/g,
            "-"
          )
      }-${
        submission.id
      }`;


    await store.setJSON(
      key,
      submission
    );


    return new Response(
      JSON.stringify({
        ok: true,
        id:
          submission.id
      }),
      {
        status: 201,
        headers: {
          "Content-Type":
            "application/json",

          "Cache-Control":
            "no-store"
        }
      }
    );


  } catch (
    error
  ) {

    console.error(
      "PREVIEW SIGN-IN SUBMIT ERROR:",
      error
    );


    return new Response(
      JSON.stringify({
        error:
          "Unable to submit the sign-in right now."
      }),
      {
        status: 500,
        headers: {
          "Content-Type":
            "application/json"
        }
      }
    );

  }

};
