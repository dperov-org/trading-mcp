import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CHATKIT_CDN_URL =
  "https://cdn.platform.openai.com/deployments/chatkit/chatkit.js";
const CDN_ORIGIN = "https://cdn.platform.openai.com";
const ABSOLUTE_ASSET_PATH_RE =
  /(?:src|href)=["']([^"']+)["']|\b(\/assets\/ck1\/[^"'`\s)><]+)\b/g;
const RELATIVE_ASSET_PATH_RE =
  /(?:import\(|new URL\(|src=|href=)["'](\.\/[^"'`\s)><]+\.(?:js|css|svg|ico|woff2?|ttf|json))["']/g;
const ENTRY_RELATIVE_ASSET_PATH_RE =
  /(?:import\(|new URL\()["'](\.\/(?:(?:index|[A-Za-z]{2}-[A-Za-z]{2})-[^"'`\s)><]+\.js))["']/g;
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

function resolveRelativeAssetPath(parentAssetPath, candidate) {
  if (!candidate.startsWith("./")) {
    return candidate;
  }

  const parentDir = path.posix.dirname(parentAssetPath);
  return path.posix.normalize(path.posix.join(parentDir, candidate));
}

function extractAssetPathsFor(text, parentAssetPath, { entryRestricted = false } = {}) {
  const result = new Set();
  for (const match of text.matchAll(ABSOLUTE_ASSET_PATH_RE)) {
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

  const relativeRegex = entryRestricted
    ? ENTRY_RELATIVE_ASSET_PATH_RE
    : RELATIVE_ASSET_PATH_RE;

  for (const match of text.matchAll(relativeRegex)) {
    const candidate = match[1];
    if (!candidate) {
      continue;
    }

    const resolved = resolveRelativeAssetPath(parentAssetPath, candidate);
    if (!resolved.startsWith("/assets/") && !resolved.startsWith("/vendor/")) {
      continue;
    }

    result.add(resolved);
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

async function walkFiles(rootDir) {
  const result = [];
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return result;
  }

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await walkFiles(fullPath)));
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  }

  return result;
}

async function removeEmptyDirectories(rootDir) {
  let entries = [];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const fullPath = path.join(rootDir, entry.name);
        await removeEmptyDirectories(fullPath);
        const remaining = await fs.readdir(fullPath);
        if (remaining.length === 0) {
          await fs.rmdir(fullPath);
        }
      }),
  );
}

async function pruneDownloadedAssets(keepPaths) {
  const roots = [vendorDir, path.join(publicDir, "assets", "ck1")];
  const keepSet = new Set(keepPaths.map((filePath) => path.resolve(filePath)));

  for (const rootDir of roots) {
    const files = await walkFiles(rootDir);
    for (const filePath of files) {
      if (!keepSet.has(path.resolve(filePath))) {
        await fs.rm(filePath, { force: true });
      }
    }

    await removeEmptyDirectories(rootDir);
  }
}

async function fetchAssetGraph(seedPaths, { restrictedRelativeImportAssets = new Set() } = {}) {
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

      for (const nestedPath of extractAssetPathsFor(body, assetPath, {
        entryRestricted: restrictedRelativeImportAssets.has(assetPath),
      })) {
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
  const frameHtmlBody = await fetchText(toCdnUrl(frameHtmlPath), "text/html, */*");
  const sanitizedFrameHtmlBody = frameHtmlBody.replace(CLOUDFLARE_CHALLENGE_RE, "");
  const frameInitialAssets = extractAssetPathsFor(sanitizedFrameHtmlBody, frameHtmlPath);
  const restrictedRelativeImportAssets = new Set(
    [...frameInitialAssets].filter((assetPath) =>
      /^\/assets\/ck1\/index-[A-Za-z0-9_-]+\.js$/.test(assetPath),
    ),
  );
  const downloadedAssets = await fetchAssetGraph([frameHtmlPath], {
    restrictedRelativeImportAssets,
  });
  await pruneDownloadedAssets([
    bundleOutputPath,
    ...downloadedAssets.map((asset) => asset.outputPath),
  ]);

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
