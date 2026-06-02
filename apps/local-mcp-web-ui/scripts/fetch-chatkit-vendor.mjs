import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHATKIT_CDN_URL =
  "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";

const currentFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(currentFile);
const appRoot = path.resolve(scriptDir, "..");
const vendorDir = path.join(appRoot, "public", "vendor");
const outputPath = path.join(vendorDir, "chatkit.js");

async function main() {
  const response = await fetch(CHATKIT_CDN_URL, {
    headers: {
      accept: "text/javascript, application/javascript, */*",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ChatKit bundle: ${response.status} ${response.statusText}`);
  }

  const body = await response.text();
  if (!body.trim()) {
    throw new Error("Downloaded ChatKit bundle is empty");
  }

  await fs.mkdir(vendorDir, { recursive: true });
  await fs.writeFile(outputPath, body, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: CHATKIT_CDN_URL,
        outputPath,
        bytes: Buffer.byteLength(body, "utf8"),
      },
      null,
      2,
    ),
  );
}

await main();
