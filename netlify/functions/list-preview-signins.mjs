import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";


const STORE_NAME =
  "austin-preview-event-signins";


const COOKIE_NAME =
  "austin_studio_dashboard_auth";


function parseCookies(
  header = ""
) {

  return Object.fromEntries(

    header
      .split(";")
      .map(
        part =>
          part.trim()
      )
      .filter(Boolean)
      .map(
        part => {

          const index =
            part.indexOf(
              "="
            );


          return (
            index === -1
          )
            ? [
                part,
                ""
              ]
            : [
                part.slice(
                  0,
                  index
                ),

                part.slice(
                  index + 1
                )
              ];

        }
      )

  );

}


function sha256(
  value
) {

  return crypto
    .createHash(
      "sha256"
    )
    .update(
      value
    )
    .digest(
      "hex"
    );

}


export default async (
  request
) => {

  if (
    request.method !==
    "GET"
  ) {

    return new Response(
      JSON.stringify({
        error:
          "Method not allowed."
      }),
      {
        status: 405,
        headers: {
          "Content-Type":
            "application/json"
        }
      }
    );

  }


  /*
    Uses the SAME password and cookie
    as your Austin Studio Hub.

    This keeps customer phone numbers
    and emails from being exposed through
    a public endpoint.
  */

  const password =
    process.env
      .PROTECTED_PAGE_PASSWORD;


  if (
    !password
  ) {

    return new Response(
      JSON.stringify({
        error:
          "Dashboard authentication is not configured."
      }),
      {
        status: 503,
        headers: {
          "Content-Type":
            "application/json"
        }
      }
    );

  }


  const cookies =
    parseCookies(
      request
        .headers
        .get(
          "cookie"
        ) || ""
    );


  const expectedHash =
    sha256(
      password
    );


  if (
    cookies[
      COOKIE_NAME
    ] !==
    expectedHash
  ) {

    return new Response(
      JSON.stringify({
        error:
          "Unauthorized."
      }),
      {
        status: 401,
        headers: {
          "Content-Type":
            "application/json"
        }
      }
    );

  }


  try {

    const store =
      getStore(
        STORE_NAME
      );


    const {
      blobs
    } =
      await store.list({
        prefix:
          "submissions/"
      });


    const submissions =
      [];


    for (
      const blob
      of blobs
    ) {

      try {

        const item =
          await store.get(
            blob.key,
            {
              type:
                "json"
            }
          );


        if (
          item
        ) {

          submissions.push(
            item
          );

        }


      } catch (
        error
      ) {

        console.error(
          "Unable to read preview sign-in:",
          blob.key,
          error
        );

      }

    }


    /*
      Newest submissions first.
    */
    submissions.sort(
      (
        a,
        b
      ) =>

        new Date(
          b.createdAt ||
          0
        )
        -
        new Date(
          a.createdAt ||
          0
        )

    );


    return new Response(
      JSON.stringify({
        submissions
      }),
      {
        status: 200,
        headers: {
          "Content-Type":
            "application/json",

          "Cache-Control":
            "no-store"
        }
      }
    );


  } catch (
    error
  ) {

    console.error(
      "PREVIEW SIGN-IN LIST ERROR:",
      error
    );


    return new Response(
      JSON.stringify({
        error:
          "Unable to load Preview Event sign-ins."
      }),
      {
        status: 500,
        headers: {
          "Content-Type":
            "application/json"
        }
      }
    );

  }

};
