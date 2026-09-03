import { getStore } from "@netlify/blobs";


/* =========================================================
   AUSTIN STUDIO LOOKBOOK
   GET CUSTOMER LOOKBOOK
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
    request.method !== "GET"
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

    const url =
      new URL(
        request.url
      );


    const id =
      String(
        url.searchParams.get("id") ||
        ""
      )
      .trim();


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


    const store =
      getStore({
        name:
          "austin-studio-lookbooks",

        consistency:
          "strong"
      });


    const key =
      `lookbooks/${id}`;


    const lookbook =
      await store.get(
        key,
        {
          type: "json"
        }
      );


    if (!lookbook) {

      return jsonResponse(
        {
          error:
            "This Lookbook could not be found."
        },
        404
      );

    }


    /* =====================================================
       DISABLED LOOKBOOK CHECK

       Existing Lookbooks without an "active" property
       are treated as active.

       Only:
         active: false

       blocks access.

       The Lookbook remains safely stored in Netlify Blobs.
       ===================================================== */

    if (
      lookbook.active === false
    ) {

      return jsonResponse(
        {
          success: false,

          code:
            "LOOKBOOK_DISABLED",

          error:
            "This Lookbook is no longer active. Please contact your Austin Design Studio representative if you need assistance."
        },
        403
      );

    }


    return jsonResponse(
      {
        success: true,
        lookbook
      }
    );


  } catch (error) {

    console.error(
      "GET LOOKBOOK ERROR:",
      error
    );


    return jsonResponse(
      {
        error:
          "Unable to load this Lookbook."
      },
      500
    );

  }

}
