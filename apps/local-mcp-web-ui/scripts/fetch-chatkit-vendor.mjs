import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHATKIT_CDN_URL =
  "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";
const CDN_ORIGIN = "https://cdn.platform.openai.com";
const ASSET_PATH_RE =
  /(?:src|href)=["']([^"']+)["']|\b(\/assets\/ck1\/[^"'`\s)><]+)\b/g;
const FRAME_HTML_RE = /ht="([^"]+\.html)"/;
const CLOUDFLARE_CHALLENGE_RE =
  /<script>\(function\(\)\{function c\(\)[\s\S]*?<\/script>/i;

const currentFile = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(currentFile);
const appRoot = path.resolve(scriptDir, "..");
const publicDir = path.join(appRoot, "public");
const vendorDir = path.join(publicDir, "vendor");
const bundleOutputPath = path.join(vendorDir, "chatkit.js");

function toCdnUrl(assetPath) {
  const normalized = String(assetPath || "");
  if (normalized.startsWith("/vendor/")) {
    return new URL(
      normalized.replace(/^\/vendor\//, "/deployments/chatkit/"),
      CDN_ORIGIN,
    ).toString();
  }

  return new URL(normalized, CDN_ORIGIN).toString();
}

function toPublicPath(assetPath) {
  const normalized = String(assetPath || "").replace(/^\/+/, "");
  if (!normalized) {
    throw new Error(`Invalid asset path: ${assetPath}`);
  }

  return path.join(publicDir, normalized);
}

async function fetchText(url, accept) {
  const response = await fetch(url, {
    headers: {
      accept,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  return response.text();
}

async function fetchBinary(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
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

async function writeTextAsset(assetPath, body) {
  const outputPath = toPublicPath(assetPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, body, "utf8");
  return outputPath;
}

async function writeBinaryAsset(assetPath, body) {
  const outputPath = toPublicPath(assetPath);
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, body);
  return outputPath;
}

async function fetchAssetGraph(seedPaths) {
  const queue = [...seedPaths];
  const visited = new Set();
  const downloaded = [];

  while (queue.length > 0) {
    const assetPath = queue.shift();
    if (!assetPath || visited.has(assetPath)) {
      continue;
    }

    visited.add(assetPath);
    const url = toCdnUrl(assetPath);
    const ext = path.extname(assetPath).toLowerCase();

    if ([".html", ".js", ".css", ".svg"].includes(ext)) {
      let body = await fetchText(
        url,
        "text/html, text/javascript, text/css, image/svg+xml, */*",
      );
      if (ext === ".html") {
        body = body.replace(CLOUDFLARE_CHALLENGE_RE, "");
      }

      const outputPath = await writeTextAsset(assetPath, body);
      downloaded.push({
        assetPath,
        outputPath,
        bytes: Buffer.byteLength(body, "utf8"),
      });

      for (const nestedPath of extractAssetPaths(body)) {
        if (!visited.has(nestedPath)) {
          queue.push(nestedPath);
        }
      }

      continue;
    }

    const body = await fetchBinary(url);
    const outputPath = await writeBinaryAsset(assetPath, body);
    downloaded.push({
      assetPath,
      outputPath,
      bytes: body.byteLength,
    });
  }

  return downloaded;
}

async function main() {
  const bundleBody = await fetchText(
    CHATKIT_CDN_URL,
    "text/javascript, application/javascript, */*",
  );
  if (!bundleBody.trim()) {
    throw new Error("Downloaded ChatKit bundle is empty");
  }

  const frameHtmlMatch = bundleBody.match(FRAME_HTML_RE);
  if (!frameHtmlMatch) {
    throw new Error("Unable to extract ChatKit frame HTML path from bundle");
  }

  await fs.mkdir(vendorDir, { recursive: true });
  await fs.writeFile(bundleOutputPath, bundleBody, "utf8");

  const frameHtmlPath = `/vendor/${frameHtmlMatch[1]}`;
  const downloadedAssets = await fetchAssetGraph([frameHtmlPath]);

  console.log(
    JSON.stringify(
      {
        ok: true,
        source: CHATKIT_CDN_URL,
        outputPath: bundleOutputPath,
        bytes: Buffer.byteLength(bundleBody, "utf8"),
        frameHtmlPath,
        downloadedAssets,
      },
      null,
      2,
    ),
  );
}

await main();
