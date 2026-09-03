import { getStore } from "@netlify/blobs";


/* =========================================================
   AUSTIN STUDIO LOOKBOOK
   GET SAVED CUSTOMER LOOKBOOK
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

  /* -------------------------------------------------------
     ONLY ALLOW GET
     ------------------------------------------------------- */

  if (request.method !== "GET") {

    return jsonResponse(
      {
        error: "Method not allowed."
      },
      405
    );

  }


  try {

    /* -----------------------------------------------------
       READ LOOKBOOK ID FROM URL

       Example:
       /customer.html?id=81f959ed-aa6a...
       ----------------------------------------------------- */

    const url =
      new URL(
        request.url
      );


    const id =
      String(
        url.searchParams.get("id") || ""
      )
      .trim();


    /* -----------------------------------------------------
       VALIDATE PRIVATE LOOKBOOK ID
       ----------------------------------------------------- */

    if (!validLookbookId(id)) {

      return jsonResponse(
        {
          error:
            "This Lookbook link is invalid."
        },
        400
      );

    }


    /* -----------------------------------------------------
       OPEN SAME NETLIFY BLOB STORE USED WHEN CREATING
       ----------------------------------------------------- */

    const store =
      getStore({
        name:
          "austin-studio-lookbooks",

        consistency:
          "strong"
      });


    /* -----------------------------------------------------
       EACH CUSTOMER LOOKBOOK IS STORED UNDER:

       lookbooks/<private-id>
       ----------------------------------------------------- */

    const key =
      `lookbooks/${id}`;


    /* -----------------------------------------------------
       LOAD SAVED LOOKBOOK
       ----------------------------------------------------- */

    const lookbook =
      await store.get(
        key,
        {
          type: "json"
        }
      );


    /* -----------------------------------------------------
       NOT FOUND
       ----------------------------------------------------- */

    if (!lookbook) {

      return jsonResponse(
        {
          error:
            "This Lookbook could not be found."
        },
        404
      );

    }


    /* -----------------------------------------------------
       SUCCESS

       Sends customer.html:
       - id
       - name
       - workbook
       - selections
       - createdAt
       - updatedAt
       ----------------------------------------------------- */

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
          "Something went wrong while loading this Lookbook."
      },
      500
    );

  }

}
