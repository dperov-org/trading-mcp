import { startWebUiServer } from "./server.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const previous = {
    WEB_UI_PORT: process.env.WEB_UI_PORT,
    WEB_UI_AUTH_MODE: process.env.WEB_UI_AUTH_MODE,
    WEB_UI_CHATKIT_VERIFY_URL: process.env.WEB_UI_CHATKIT_VERIFY_URL,
  };

  process.env.WEB_UI_PORT = process.env.WEB_UI_PORT || "8801";
  process.env.WEB_UI_AUTH_MODE = "none";
  process.env.WEB_UI_CHATKIT_VERIFY_URL = "http://127.0.0.1:9/should-not-be-called";

  const runtime = await startWebUiServer();

  try {
    const payload = {
      domain_key: "domain_pk_test",
      domain: "https://singapur.tail3e0cf.ts.net",
    };

    const response = await fetch(`${runtime.url}/chatkit/domain_keys/verify`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://singapur.tail3e0cf.ts.net",
        referer: "https://singapur.tail3e0cf.ts.net/",
      },
      body: JSON.stringify(payload),
    });

    assert(response.ok, `Verify response failed with ${response.status}`);
    const body = await response.json();
    assert(body?.ok === true, "Verify response body missing ok=true");
    assert(body?.valid === true, "Verify response body missing valid=true");
    assert(body?.verified === true, "Verify response body missing verified=true");
    assert(body?.local === true, "Verify response body missing local=true");

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl: runtime.url,
          localVerify: true,
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.close();

    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

await main();
