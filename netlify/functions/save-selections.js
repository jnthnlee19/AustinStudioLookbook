import { getStore } from "@netlify/blobs";


/* =========================================================
   AUSTIN STUDIO LOOKBOOK
   SAVE CUSTOMER SELECTIONS
   SAFE LIVE-SYNC / OPTION-LEVEL MERGE
   ========================================================= */


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


function validLookbookId(value) {

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(
      String(value || "")
    );

}


/* =========================================================
   NORMALIZE ONE SELECTION
   ========================================================= */

function normalizeSelection(selection) {

  if (
    !selection ||
    typeof selection !== "object"
  ) {
    return null;
  }


  const option =
    String(
      selection.option || ""
    )
    .trim();


  if (!option) {
    return null;
  }


  return {

    option,

    qty:
      Math.max(
        1,
        parseInt(
          selection.qty || 1
        ) || 1
      ),

    comment:
      String(
        selection.comment || ""
      ),

    variation1:
      String(
        selection.variation1 || ""
      ),

    variation2:
      String(
        selection.variation2 || ""
      )

  };

}


/* =========================================================
   MAIN HANDLER
   ========================================================= */

export default async function handler(request) {

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


    const sessionId =
      String(
        payload?.sessionId || ""
      )
      .trim();


    const changes =
      Array.isArray(
        payload?.changes
      )
        ? payload.changes
        : [];


    /* =====================================================
       VALIDATE LOOKBOOK ID
       ===================================================== */

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


    /* =====================================================
       REQUIRE AT LEAST ONE CHANGE
       ===================================================== */

    if (
      changes.length === 0
    ) {

      return jsonResponse(
        {
          error:
            "No selection changes were provided."
        },
        400
      );

    }


    /* =====================================================
       OPEN NETLIFY BLOB STORE
       ===================================================== */

    const store =
      getStore({
        name:
          "austin-studio-lookbooks",

        consistency:
          "strong"
      });


    const key =
      `lookbooks/${id}`;


    /* =====================================================
       GET CURRENT SERVER VERSION
       ===================================================== */

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


    /* =====================================================
       BUILD MAP OF CURRENT SAVED OPTIONS

       OPTION NUMBER = UNIQUE KEY

       We are NOT replacing the entire selections array.

       We start with everything currently saved on the
       server and only modify the options included in this
       request.
       ===================================================== */

    const selectionMap =
      new Map();


    const existingSelections =
      Array.isArray(
        current.selections
      )
        ? current.selections
        : [];


    existingSelections.forEach(
      selection => {

        const normalized =
          normalizeSelection(
            selection
          );


        if (!normalized) {
          return;
        }


        selectionMap.set(
          normalized.option,
          normalized
        );

      }
    );


    /* =====================================================
       MERGE THIS SESSION'S CHANGES

       selected: true
       Add or update that option.

       selected: false
       Remove that option.

       Anything NOT included in this request stays exactly
       as it currently exists on the server.
       ===================================================== */

    changes.forEach(
      change => {

        if (
          !change ||
          typeof change !== "object"
        ) {
          return;
        }


        const option =
          String(
            change.option || ""
          )
          .trim();


        if (!option) {
          return;
        }


        /* -----------------------------------------
           OPTION WAS UNSELECTED
           ----------------------------------------- */

        if (
          change.selected === false
        ) {

          selectionMap.delete(
            option
          );

          return;
        }


        /* -----------------------------------------
           OPTION WAS SELECTED / UPDATED
           ----------------------------------------- */

        const normalized =
          normalizeSelection(
            {
              option,

              qty:
                change.qty,

              comment:
                change.comment,

              variation1:
                change.variation1,

              variation2:
                change.variation2
            }
          );


        if (!normalized) {
          return;
        }


        selectionMap.set(
          option,
          normalized
        );

      }
    );


    /* =====================================================
       BUILD FINAL SELECTION ARRAY
       ===================================================== */

    const selections =
      Array.from(
        selectionMap.values()
      );


    const updatedAt =
      new Date()
        .toISOString();


    /* =====================================================
       STORE SESSION INFORMATION

       This allows customer.html to recognize which open
       browser/tab made the most recent save.

       It does NOT identify the customer personally.
       It is simply a temporary random browser-session ID.
       ===================================================== */

    const updatedLookbook = {
      ...current,

      selections,

      updatedAt,

      lastSessionId:
        sessionId || null
    };


    /* =====================================================
       SAVE MERGED LOOKBOOK
       ===================================================== */

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
            current.active !== false,

          lastSessionId:
            sessionId || ""

        }
      }
    );


    /* =====================================================
       RETURN AUTHORITATIVE SERVER STATE
       ===================================================== */

    return jsonResponse(
      {
        success: true,

        id,

        updatedAt,

        lastSessionId:
          sessionId || null,

        selections
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
