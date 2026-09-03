const COOKIE_NAME =
  "austin_studio_dashboard_auth";

const COOKIE_MAX_AGE =
  60 * 60 * 24 * 365;


function htmlResponse(
  html,
  status = 200,
  headers = {}
) {

  return new Response(
    html,
    {
      status,
      headers: {
        "Content-Type":
          "text/html; charset=utf-8",

        "Cache-Control":
          "no-store",

        ...headers
      }
    }
  );

}


async function hashValue(
  value
) {

  const data =
    new TextEncoder()
      .encode(value);


  const hash =
    await crypto.subtle.digest(
      "SHA-256",
      data
    );


  return Array.from(
    new Uint8Array(hash)
  )
  .map(
    byte =>
      byte
        .toString(16)
        .padStart(2, "0")
  )
  .join("");

}


function loginPage(
  error = ""
) {

  return `
<!DOCTYPE html>

<html lang="en">

<head>

  <meta charset="UTF-8">

  <meta
    name="viewport"
    content="width=device-width, initial-scale=1.0"
  >

  <title>
    Austin Studio Lookbook
  </title>

  <style>

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;

      min-height: 100vh;

      display: flex;
      align-items: center;
      justify-content: center;

      padding: 24px;

      background:
        #f7f3eb;

      font-family:
        "Segoe UI",
        Arial,
        sans-serif;

      color:
        #292d32;
    }


    .login-card {
      width: 100%;
      max-width: 430px;

      background: white;

      border-radius: 16px;

      border:
        1px solid #e2e2df;

      border-top:
        5px solid #f3c63f;

      box-shadow:
        0 18px 50px
        rgba(30, 35, 40, 0.12);

      padding:
        34px 32px;
    }


    .kicker {
      color:
        #8c9197;

      font-size:
        0.74rem;

      font-weight:
        800;

      letter-spacing:
        0.12em;

      text-transform:
        uppercase;

      margin-bottom:
        7px;
    }


    h1 {
      margin:
        0 0 8px;

      font-size:
        1.7rem;
    }


    p {
      margin:
        0 0 24px;

      color:
        #6f757b;

      line-height:
        1.55;

      font-size:
        0.93rem;
    }


    label {
      display:
        block;

      margin-bottom:
        7px;

      font-size:
        0.82rem;

      font-weight:
        700;
    }


    input {
      width:
        100%;

      padding:
        12px 13px;

      border:
        1px solid #cfd3d7;

      border-radius:
        8px;

      font-size:
        1rem;

      outline:
        none;
    }


    input:focus {
      border-color:
        #b79830;

      box-shadow:
        0 0 0 3px
        rgba(
          243,
          198,
          63,
          0.18
        );
    }


    button {
      width:
        100%;

      margin-top:
        14px;

      padding:
        12px;

      border:
        none;

      border-radius:
        8px;

      background:
        #f3c63f;

      color:
        #24272a;

      font-size:
        0.95rem;

      font-weight:
        800;

      cursor:
        pointer;
    }


    button:hover {
      filter:
        brightness(0.97);
    }


    .error {
      margin-bottom:
        16px;

      padding:
        10px 12px;

      border-radius:
        8px;

      background:
        #fff0ef;

      color:
        #a33b34;

      font-size:
        0.82rem;

      font-weight:
        700;
    }


    .footer {
      margin-top:
        22px;

      text-align:
        center;

      color:
        #999da2;

      font-size:
        0.72rem;
    }

  </style>

</head>


<body>

  <div class="login-card">

    <div class="kicker">
      Austin Design Studio
    </div>

    <h1>
      Lookbook Dashboard
    </h1>

    <p>
      Enter the Studio password
      to access the Lookbook dashboard.
    </p>


    ${
      error
        ? `
          <div class="error">
            ${error}
          </div>
        `
        : ""
    }


    <form
      method="POST"
      action="/"
    >

      <label for="password">
        Password
      </label>

      <input
        id="password"
        name="password"
        type="password"
        autocomplete="current-password"
        autofocus
        required
      >

      <button type="submit">
        Access Dashboard
      </button>

    </form>


    <div class="footer">
      Austin Design Studio
    </div>

  </div>

</body>

</html>
  `;

}


export default async function handler(
  request,
  context
) {

  const password =
    Netlify.env.get(
      "PROTECTED_PAGE_PASSWORD"
    );


  if (!password) {

    return htmlResponse(
      loginPage(
        "This page is not yet configured. The site owner needs to set the dashboard password."
      ),
      503
    );

  }


  const expectedHash =
    await hashValue(
      password
    );


  const cookieHeader =
    request.headers.get(
      "cookie"
    ) || "";


  const cookies =
    Object.fromEntries(
      cookieHeader
        .split(";")
        .map(
          part =>
            part
              .trim()
              .split("=")
        )
        .filter(
          item =>
            item.length === 2
        )
    );


  if (
    cookies[
      COOKIE_NAME
    ] === expectedHash
  ) {

    return context.next();

  }


  if (
    request.method === "POST"
  ) {

    const form =
      await request.formData();


    const submittedPassword =
      String(
        form.get(
          "password"
        ) || ""
      );


    const submittedHash =
      await hashValue(
        submittedPassword
      );


    if (
      submittedHash ===
      expectedHash
    ) {

      return new Response(
        null,
        {
          status:
            303,

          headers: {

            Location:
              "/",

            "Set-Cookie":
              `${COOKIE_NAME}=${expectedHash}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}`,

            "Cache-Control":
              "no-store"
          }
        }
      );

    }


    return htmlResponse(
      loginPage(
        "Incorrect password. Please try again."
      ),
      401
    );

  }


  return htmlResponse(
    loginPage()
  );

}
