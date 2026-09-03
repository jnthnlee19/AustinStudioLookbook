import { getStore } from "@netlify/blobs";
import * as XLSX from "xlsx";


/* =========================================================
   AUSTIN STUDIO LOOKBOOK
   LIST SAVED LOOKBOOKS
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


/* =========================================================
   MONEY / PRICE HELPERS
   ========================================================= */

function parsePrice(
  value
) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return 0;
  }


  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    return value;
  }


  const cleaned =
    String(value)
      .replace(
        /[$,\s]/g,
        ""
      );


  const number =
    Number(cleaned);


  return Number.isFinite(number)
    ? number
    : 0;

}



/* =========================================================
   CALCULATE CURRENT SELECTED TOTAL

   The workbook is stored inside each Lookbook.

   We read Sheet2 and recreate the option-number → price
   relationship using the same columns as the Lookbook:

   A = Option Number
   C = Description
   N = Amount

   Then we total the customer's currently saved selections.
   ========================================================= */

function calculateSelectedTotal(
  lookbook
) {

  /*
    Future-friendly:

    If we later decide to save selectedTotal directly
    into the Lookbook record, this function will use it
    automatically.
  */

  if (
    typeof lookbook?.selectedTotal ===
      "number" &&
    Number.isFinite(
      lookbook.selectedTotal
    )
  ) {

    return lookbook.selectedTotal;

  }


  const workbookBase64 =
    lookbook?.workbook;


  if (
    !workbookBase64 ||
    typeof workbookBase64 !==
      "string"
  ) {

    return 0;

  }


  const selections =
    Array.isArray(
      lookbook?.selections
    )
      ? lookbook.selections
      : [];


  if (
    selections.length === 0
  ) {

    return 0;

  }


  try {

    const workbook =
      XLSX.read(
        workbookBase64,
        {
          type: "base64"
        }
      );


    const sheetObject =
      workbook.Sheets["Sheet2"];


    if (!sheetObject) {

      return 0;

    }


    const sheet =
      XLSX.utils.sheet_to_json(
        sheetObject,
        {
          header: 1
        }
      );


    const pricesByOption =
      new Map();


    /*
      This matches the Lookbook's
      existing workbook parsing.

      Data begins at row index 14.
    */

    for (
      let i = 14;
      i < sheet.length;
      i++
    ) {

      const row =
        sheet[i] || [];


      const optionNumber =
        row[0];


      const description =
        row[2];


      /*
        Category/header rows do not
        have a description in column C,
        so only actual option rows are
        added to the price map.
      */

      if (
        optionNumber &&
        description
      ) {

        pricesByOption.set(
          String(
            optionNumber
          ),
          parsePrice(
            row[13]
          )
        );

      }

    }


    let total = 0;


    selections.forEach(
      selection => {

        const option =
          String(
            selection?.option ?? ""
          );


        if (!option) {
          return;
        }


        const price =
          pricesByOption.get(
            option
          ) || 0;


        const qty =
          Math.max(
            1,
            parseInt(
              selection?.qty || 1
            ) || 1
          );


        total +=
          price * qty;

      }
    );


    return total;


  } catch (error) {

    console.error(
      "LOOKBOOK TOTAL ERROR:",
      lookbook?.id,
      error
    );


    /*
      A damaged workbook should not
      prevent the dashboard from
      loading the Lookbook list.
    */

    return 0;

  }

}



/* =========================================================
   MAIN FUNCTION
   ========================================================= */

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

    const store =
      getStore({
        name:
          "austin-studio-lookbooks",

        consistency:
          "strong"
      });


    /*
      List every customer Lookbook
      stored under:

      lookbooks/<UUID>
    */

    const listed =
      await store.list({
        prefix:
          "lookbooks/"
      });


    const blobs =
      Array.isArray(
        listed?.blobs
      )
        ? listed.blobs
        : [];


    const lookbooks =
      await Promise.all(

        blobs.map(
          async blob => {

            try {

              const lookbook =
                await store.get(
                  blob.key,
                  {
                    type:
                      "json"
                  }
                );


              if (
                !lookbook ||
                !lookbook.id
              ) {

                return null;

              }


              const selectedTotal =
                calculateSelectedTotal(
                  lookbook
                );


              return {

                id:
                  lookbook.id,

                name:
                  lookbook.name ||
                  "Untitled Lookbook",

                createdAt:
                  lookbook.createdAt ||
                  "",

                updatedAt:
                  lookbook.updatedAt ||
                  lookbook.createdAt ||
                  "",

                selectedTotal,

                /*
                  EXISTING LOOKBOOKS:

                  Any Lookbook that does not
                  already have an active field
                  is treated as ACTIVE.

                  Only an explicit:
                  active: false

                  means the Lookbook is disabled.
                */
                active:
                  lookbook.active !== false,

                url:
                  `/customer.html?id=${encodeURIComponent(
                    lookbook.id
                  )}`

              };


            } catch (error) {

              console.error(
                "LOOKBOOK LIST ITEM ERROR:",
                blob.key,
                error
              );


              return null;

            }

          }
        )

      );


    const cleaned =
      lookbooks
        .filter(Boolean)
        .sort(
          (
            a,
            b
          ) => {

            const aTime =
              new Date(
                a.updatedAt ||
                a.createdAt ||
                0
              )
              .getTime();


            const bTime =
              new Date(
                b.updatedAt ||
                b.createdAt ||
                0
              )
              .getTime();


            return (
              bTime -
              aTime
            );

          }
        );


    return jsonResponse(
      {
        success: true,
        lookbooks:
          cleaned
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
          "Unable to load saved Lookbooks."
      },
      500
    );

  }

}
