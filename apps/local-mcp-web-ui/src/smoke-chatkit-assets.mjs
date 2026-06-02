import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startWebUiServer } from "./server.mjs";

const currentFile = fileURLToPath(import.meta.url);
const srcDir = path.dirname(currentFile);
const appRoot = path.resolve(srcDir, "..");
const publicDir = path.join(appRoot, "public");

const FRAME_HTML_RE = /ht="([^"]+\.html)"/;
const ASSET_PATH_RE =
  /(?:src|href)=["']([^"']+)["']|\b(\/assets\/ck1\/[^"'`\s)><]+)\b/g;

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractAssetPaths(text) {
  const result = new Set();
  for (const match of text.matchAll(ASSET_PATH_RE)) {
    const candidate = match[1] || match[2];
    if (!candidate) {
      continue;
    }

    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      continue;
    }

    if (!candidate.startsWith("/assets/") && !candidate.startsWith("/vendor/")) {
      continue;
    }

    result.add(candidate);
  }

  return result;
}

async function readLocalAsset(assetPath) {
  const filePath = path.join(publicDir, assetPath.replace(/^\/+/, ""));
  return fs.readFile(filePath, "utf8");
}

async function main() {
  const previousPort = process.env.WEB_UI_PORT;
  const previousAuthMode = process.env.WEB_UI_AUTH_MODE;
  process.env.WEB_UI_PORT = process.env.WEB_UI_PORT || "8799";
  process.env.WEB_UI_AUTH_MODE = "none";

  const runtime = await startWebUiServer();
  const baseUrl = runtime.url;

  try {
    const bundlePath = "/vendor/chatkit.js";
    const bundleResponse = await fetch(`${baseUrl}${bundlePath}`);
    assert(bundleResponse.ok, `GET ${bundlePath} failed with ${bundleResponse.status}`);
    const bundleText = await bundleResponse.text();

    const frameHtmlMatch = bundleText.match(FRAME_HTML_RE);
    assert(frameHtmlMatch, "Unable to extract ChatKit frame HTML path from local bundle");

    const queue = [`/vendor/${frameHtmlMatch[1]}`];
    const visited = new Set();
    const checked = [];

    while (queue.length > 0) {
      const assetPath = queue.shift();
      if (!assetPath || visited.has(assetPath)) {
        continue;
      }

      visited.add(assetPath);
      const response = await fetch(`${baseUrl}${assetPath}`);
      assert(response.ok, `GET ${assetPath} failed with ${response.status}`);
      checked.push(assetPath);

      const ext = path.extname(assetPath).toLowerCase();
      if (![".html", ".js", ".css", ".svg"].includes(ext)) {
        continue;
      }

      const localText = await readLocalAsset(assetPath);
      for (const nestedPath of extractAssetPaths(localText)) {
        if (!visited.has(nestedPath)) {
          queue.push(nestedPath);
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          baseUrl,
          checkedAssets: checked,
          checkedCount: checked.length,
        },
        null,
        2,
      ),
    );
  } finally {
    await runtime.close();
    if (previousPort === undefined) {
      delete process.env.WEB_UI_PORT;
    } else {
      process.env.WEB_UI_PORT = previousPort;
    }

    if (previousAuthMode === undefined) {
      delete process.env.WEB_UI_AUTH_MODE;
    } else {
      process.env.WEB_UI_AUTH_MODE = previousAuthMode;
    }
  }
}

await main();
