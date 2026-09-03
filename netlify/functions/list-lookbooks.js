import { getStore } from "@netlify/blobs";
import * as XLSX from "xlsx";


/* =========================================================
   AUSTIN STUDIO LOOKBOOK
   LIST SAVED LOOKBOOKS FOR DASHBOARD
   Includes current Selected Total
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


  const cleaned =
    String(value)
      .replace(/[$,\s]/g, "");


  const number =
    Number.parseFloat(cleaned);


  return Number.isFinite(number)
    ? number
    : 0;

}


function calculateSelectedTotal(
  lookbook
) {

  if (
    Number.isFinite(
      Number(
        lookbook?.selectedTotal
      )
    )
  ) {

    return Number(
      lookbook.selectedTotal
    );

  }


  const workbookBase64 =
    lookbook?.workbook;


  const selections =
    Array.isArray(
      lookbook?.selections
    )
      ? lookbook.selections
      : [];


  if (
    !workbookBase64 ||
    !selections.length
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


    const priceByOption =
      new Map();


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


      if (
        !optionNumber ||
        !description
      ) {
        continue;
      }


      priceByOption.set(
        String(optionNumber).trim(),
        parsePrice(
          row[13]
        )
      );

    }


    return selections.reduce(
      (
        total,
        selection
      ) => {

        const option =
          String(
            selection?.option ?? ""
          );


        const qty =
          Math.max(
            1,
            Number.parseInt(
              selection?.qty || 1
            ) || 1
          );


        const unitPrice =
          priceByOption.get(option)
          || 0;


        return total +
          unitPrice * qty;

      },
      0
    );


  } catch (error) {

    console.error(
      "TOTAL CALCULATION ERROR:",
      error
    );


    return 0;

  }

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
                lookbook.createdAt || "",

              updatedAt:
                lookbook.updatedAt ||
                lookbook.createdAt ||
                "",

              selectedTotal,

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
            new Date(
              b.updatedAt || 0
            ) -
            new Date(
              a.updatedAt || 0
            )
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
