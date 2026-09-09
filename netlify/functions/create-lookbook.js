import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";


/* =========================================================
   AUSTIN STUDIO LOOKBOOK
   CREATE CUSTOMER LOOKBOOK
   ========================================================= */


/* ---------------------------------------------------------
   JSON RESPONSE HELPER
   --------------------------------------------------------- */

function jsonResponse(data, status = 200) {

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


/* ---------------------------------------------------------
   CLEAN / VALIDATE CUSTOMER NAME
   --------------------------------------------------------- */

function cleanName(value) {

  return String(value || "")
    .trim()
    .slice(0, 200);

}


/* ---------------------------------------------------------
   CLEAN PRICE OVERRIDES

   Stored as:
   {
     "2004315": "$1,250",
     "2021067": "Pricing to be determined"
   }

   Only simple Option # -> text pairs are accepted.
   --------------------------------------------------------- */

function cleanPriceOverrides(value) {

  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return {};
  }


  const cleaned = {};


  Object
    .entries(value)
    .slice(0, 5000)
    .forEach(
      ([optionNumber, priceText]) => {

        const option =
          String(optionNumber || "")
            .trim()
            .slice(0, 100);


        const text =
          String(priceText ?? "")
            .trim()
            .slice(0, 300);


        if (
          option &&
          text
        ) {

          cleaned[option] =
            text;

        }

      }
    );


  return cleaned;

}


/* =========================================================
   NETLIFY FUNCTION
   ========================================================= */

export default async function handler(request) {

  /* -------------------------------------------------------
     ONLY ALLOW POST
     ------------------------------------------------------- */

  if (request.method !== "POST") {

    return jsonResponse(
      {
        error: "Method not allowed."
      },
      405
    );

  }


  try {

    /* -----------------------------------------------------
       READ REQUEST
       ----------------------------------------------------- */

    let payload;

    try {

      payload =
        await request.json();

    } catch (error) {

      return jsonResponse(
        {
          error: "Invalid request data."
        },
        400
      );

    }


    /* -----------------------------------------------------
       READ VALUES SENT BY lookbook.html
       ----------------------------------------------------- */

    const name =
      cleanName(
        payload?.name
      );


    const workbook =
      payload?.workbook;


    const selections =
      Array.isArray(
        payload?.selections
      )
        ? payload.selections
        : [];


    const priceOverrides =
      cleanPriceOverrides(
        payload?.priceOverrides
      );


    /* -----------------------------------------------------
       VALIDATION
       ----------------------------------------------------- */

    if (!name) {

      return jsonResponse(
        {
          error:
            "A Customer / Lookbook Name is required."
        },
        400
      );

    }


    if (
      !workbook ||
      typeof workbook !== "string"
    ) {

      return jsonResponse(
        {
          error:
            "Workbook data is missing."
        },
        400
      );

    }


    /* -----------------------------------------------------
       CREATE PRIVATE RANDOM ID

       The customer's name/address is NOT placed in the URL.
       ----------------------------------------------------- */

    const id =
      randomUUID();


    /* -----------------------------------------------------
       TIMESTAMPS
       ----------------------------------------------------- */

    const now =
      new Date().toISOString();


    /* -----------------------------------------------------
       COMPLETE LOOKBOOK RECORD
       ----------------------------------------------------- */

    const lookbook = {

      id,

      name,

      createdAt: now,

      updatedAt: now,

      workbook,

      selections,

      priceOverrides

    };


    /* -----------------------------------------------------
       OPEN NETLIFY BLOB STORE
       ----------------------------------------------------- */

    const store =
      getStore({
        name: "austin-studio-lookbooks",
        consistency: "strong"
      });


    /* -----------------------------------------------------
       SAVE LOOKBOOK

       Each customer gets their own Blob key:

       lookbooks/<private-id>
       ----------------------------------------------------- */

    const key =
      `lookbooks/${id}`;


    const result =
      await store.setJSON(
        key,
        lookbook,
        {
          onlyIfNew: true,

          metadata: {

            id,

            name,

            createdAt: now,

            updatedAt: now

          }

        }
      );


    /* -----------------------------------------------------
       VERIFY SAVE
       ----------------------------------------------------- */

    if (!result.modified) {

      return jsonResponse(
        {
          error:
            "The Lookbook could not be created. Please try again."
        },
        409
      );

    }


    /* -----------------------------------------------------
       BUILD CUSTOMER URL
       ----------------------------------------------------- */

    const requestURL =
      new URL(
        request.url
      );


    const customerURL =
      `${requestURL.origin}/customer.html?id=${encodeURIComponent(id)}`;


    /* -----------------------------------------------------
       SUCCESS
       ----------------------------------------------------- */

    return jsonResponse(
      {

        success: true,

        id,

        name,

        createdAt: now,

        updatedAt: now,

        url: customerURL

      },
      201
    );


  } catch (error) {

    console.error(
      "CREATE LOOKBOOK ERROR:",
      error
    );


    return jsonResponse(
      {
        error:
          "Something went wrong while creating the Lookbook."
      },
      500
    );

  }

}
