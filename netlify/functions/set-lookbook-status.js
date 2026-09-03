import { getStore } from "@netlify/blobs";


/* =========================================================
   AUSTIN STUDIO LOOKBOOK
   ENABLE / DISABLE CUSTOMER LOOKBOOK
   ========================================================= */


function jsonResponse(
  data,
  status = 200
) {

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


function validLookbookId(
  value
) {

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(
      String(value || "")
    );

}


export default async function handler(
  request
) {

  if (
    request.method !== "POST"
  ) {

    return jsonResponse(
      {
        error:
          "Method not allowed."
      },
      405
    );

  }


  try {

    const payload =
      await request.json();


    const id =
      String(
        payload?.id || ""
      )
      .trim();


    const active =
      payload?.active;


    if (
      !validLookbookId(id)
    ) {

      return jsonResponse(
        {
          error:
            "This Lookbook ID is invalid."
        },
        400
      );

    }


    if (
      typeof active !== "boolean"
    ) {

      return jsonResponse(
        {
          error:
            "The Lookbook status is invalid."
        },
        400
      );

    }


    const store =
      getStore({
        name:
          "austin-studio-lookbooks",

        consistency:
          "strong"
      });


    const key =
      `lookbooks/${id}`;


    const current =
      await store.get(
        key,
        {
          type: "json"
        }
      );


    if (!current) {

      return jsonResponse(
        {
          error:
            "This Lookbook could not be found."
        },
        404
      );

    }


    /*
      This timestamp tracks when Studio
      enabled or disabled the Lookbook.

      IMPORTANT:
      We intentionally do NOT change updatedAt.

      That way "Last Updated" on the dashboard
      continues to mean the last time the
      customer's selections were updated.
    */

    const statusChangedAt =
      new Date()
        .toISOString();


    const updatedLookbook = {
      ...current,

      active,

      statusChangedAt
    };


    /*
      Nothing is deleted here.

      The workbook, selections, comments,
      quantities, customer name, created date,
      and previous updated date are preserved.
    */

    await store.setJSON(
      key,
      updatedLookbook,
      {
        metadata: {

          id,

          name:
            current.name ||
            "",

          createdAt:
            current.createdAt ||
            "",

          updatedAt:
            current.updatedAt ||
            current.createdAt ||
            "",

          active

        }
      }
    );


    return jsonResponse(
      {
        success: true,

        id,

        active,

        statusChangedAt
      }
    );


  } catch (error) {

    console.error(
      "SET LOOKBOOK STATUS ERROR:",
      error
    );


    return jsonResponse(
      {
        error:
          "Something went wrong while updating this Lookbook."
      },
      500
    );

  }

}
