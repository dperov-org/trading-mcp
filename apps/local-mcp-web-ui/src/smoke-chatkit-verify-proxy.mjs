import http from "node:http";

import { startWebUiServer } from "./server.mjs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve test server address"));
        return;
      }

      resolve(address);
    });
  });
}

async function main() {
  let seenRequest = null;
  const upstreamServer = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    seenRequest = {
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: Buffer.concat(chunks).toString("utf8"),
    };

    response.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "x-test-upstream": "chatkit-verify",
    });
    response.end(
      JSON.stringify({
        ok: true,
        proxied: true,
      }),
    );
  });

  const address = await listen(upstreamServer);
  const previous = {
    WEB_UI_PORT: process.env.WEB_UI_PORT,
    WEB_UI_AUTH_MODE: process.env.WEB_UI_AUTH_MODE,
    WEB_UI_CHATKIT_VERIFY_URL: process.env.WEB_UI_CHATKIT_VERIFY_URL,
  };

  process.env.WEB_UI_PORT = process.env.WEB_UI_PORT || "8801";
  process.env.WEB_UI_AUTH_MODE = "none";
  process.env.WEB_UI_CHATKIT_VERIFY_URL = `http://127.0.0.1:${address.port}/v1/chatkit/domain_keys/verify`;

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
        "x-test-header": "chatkit-proxy-smoke",
      },
      body: JSON.stringify(payload),
    });

    assert(response.ok, `Proxy response failed with ${response.status}`);
    const body = await response.json();
    assert(body?.ok === true, "Proxy response body missing ok=true");
    assert(body?.proxied === true, "Proxy response body missing proxied=true");

    assert(seenRequest, "Upstream verify endpoint was not called");
    assert(seenRequest.method === "POST", `Unexpected upstream method: ${seenRequest.method}`);
    assert(
      seenRequest.url === "/v1/chatkit/domain_keys/verify",
      `Unexpected upstream path: ${seenRequest.url}`,
    );
    assert(
      seenRequest.headers["content-type"]?.includes("application/json"),
      "Upstream content-type was not forwarded",
    );
    assert(
      seenRequest.headers.origin === "https://singapur.tail3e0cf.ts.net",
      `Unexpected forwarded origin: ${seenRequest.headers.origin}`,
    );
    assert(
      seenRequest.headers["x-test-header"] === "chatkit-proxy-smoke",
      "Custom proxy header was not forwarded",
    );
    assert(
      seenRequest.body === JSON.stringify(payload),
      `Unexpected upstream body: ${seenRequest.body}`,
    );

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl: runtime.url,
          upstreamUrl: process.env.WEB_UI_CHATKIT_VERIFY_URL,
          forwardedOrigin: seenRequest.headers.origin,
          upstreamPath: seenRequest.url,
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.close();
    await new Promise((resolve, reject) => {
      upstreamServer.close((error) => (error ? reject(error) : resolve()));
    });

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
