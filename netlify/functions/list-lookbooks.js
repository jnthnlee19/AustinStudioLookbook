import { getStore } from "@netlify/blobs";


/* =========================================================
   AUSTIN STUDIO LOOKBOOK
   LIST SAVED LOOKBOOKS FOR DASHBOARD
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


export default async function handler(
  request
) {

  if (request.method !== "GET") {

    return jsonResponse(
      {
        error: "Method not allowed."
      },
      405
    );

  }


  try {

    const store =
      getStore({
        name:
          "austin-studio-lookbooks",

        consistency:
          "strong"
      });


    const result =
      await store.list({
        prefix: "lookbooks/"
      });


    const records =
      await Promise.all(
        (result.blobs || []).map(
          async blob => {

            const lookbook =
              await store.get(
                blob.key,
                {
                  type: "json"
                }
              );


            if (!lookbook) {
              return null;
            }


            return {
              id:
                lookbook.id,

              name:
                lookbook.name || "Untitled Lookbook",

              createdAt:
                lookbook.createdAt || "",

              updatedAt:
                lookbook.updatedAt ||
                lookbook.createdAt ||
                "",

              url:
                `/customer.html?id=${encodeURIComponent(
                  lookbook.id
                )}`
            };

          }
        )
      );


    const lookbooks =
      records
        .filter(Boolean)
        .sort(
          (a, b) =>
            new Date(b.updatedAt || 0) -
            new Date(a.updatedAt || 0)
        );


    return jsonResponse(
      {
        success: true,
        lookbooks
      }
    );


  } catch (error) {

    console.error(
      "LIST LOOKBOOKS ERROR:",
      error
    );


    return jsonResponse(
      {
        error:
          "Something went wrong while loading saved Lookbooks."
      },
      500
    );

  }

}
