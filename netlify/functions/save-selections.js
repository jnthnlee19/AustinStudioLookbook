import { getStore } from "@netlify/blobs";


/* =========================================================
   AUSTIN STUDIO LOOKBOOK
   SAVE CUSTOMER SELECTIONS
   OPTION-LEVEL MERGE / LIVE SYNC VERSION
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


/* =========================================================
   NORMALIZE ONE OPTION RECORD
   ========================================================= */

function normalizeSelection(
  selection
) {

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


    /*
      NEW FORMAT:

      changes: [
        {
          option: "2001428",
          selected: true,
          qty: 1,
          comment: "",
          variation1: "Black Fox",
          variation2: "Alabaster"
        }
      ]

      Only options included in "changes" are modified.
      Everything else already saved remains untouched.
    */

    const changes =
      Array.isArray(
        payload?.changes
      )
        ? payload.changes
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
       BUILD CURRENT SELECTION MAP

       Option number is the unique key.
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
       MERGE ONLY THE OPTIONS THAT CHANGED

       selected: true
         = add/update this option

       selected: false
         = remove this option

       Options NOT included in this request remain untouched.
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


        if (
          change.selected === false
        ) {

          selectionMap.delete(
            option
          );

          return;
        }


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
       TURN MAP BACK INTO SAVED ARRAY
       ===================================================== */

    const selections =
      Array.from(
        selectionMap.values()
      );


    const updatedAt =
      new Date()
        .toISOString();


    const updatedLookbook = {
      ...current,

      selections,

      updatedAt
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
            current.active !== false

        }
      }
    );


    /* =====================================================
       RETURN CURRENT SERVER STATE

       customer.html can use this for live-sync/version tracking.
       ===================================================== */

    return jsonResponse(
      {
        success: true,

        id,

        updatedAt,

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
