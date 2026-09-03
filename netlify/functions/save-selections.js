import { getStore } from "@netlify/blobs";


/* =========================================================
   AUSTIN STUDIO LOOKBOOK
   SAVE CUSTOMER SELECTIONS
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


    const selections =
      Array.isArray(
        payload?.selections
      )
        ? payload.selections
        : [];


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


    /* =====================================================
       DISABLED LOOKBOOK CHECK

       Once Studio disables a Lookbook, customer changes
       should no longer be allowed to save.

       The saved Lookbook data remains untouched.
       ===================================================== */

    if (
      current.active === false
    ) {

      return jsonResponse(
        {
          success: false,

          code:
            "LOOKBOOK_DISABLED",

          error:
            "This Lookbook is no longer active."
        },
        403
      );

    }


    const updatedAt =
      new Date()
        .toISOString();


    const updatedLookbook = {
      ...current,

      selections,

      updatedAt
    };


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

          updatedAt,

          active:
            current.active !== false
        }
      }
    );


    return jsonResponse(
      {
        success: true,

        id,

        updatedAt
      }
    );


  } catch (error) {

    console.error(
      "SAVE SELECTIONS ERROR:",
      error
    );


    return jsonResponse(
      {
        error:
          "Unable to save selections."
      },
      500
    );

  }

}
