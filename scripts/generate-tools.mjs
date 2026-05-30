#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ROOT_DIR = process.cwd();
const TOOLS_DIR = path.join(ROOT_DIR, 'src', 'tools');
const INVENTORY_PATH = path.join(ROOT_DIR, 'codegen', 'tool-inventory.json');
const AUTO_GENERATED_MARKER = 'auto-generated, do not edit';

async function main() {
  const command = process.argv[2] ?? 'generate';

  if (command === 'bootstrap') {
    const inventory = await buildInventory();
    await writeInventory(inventory);
    console.error(`tool inventory written: ${relativeFromRoot(INVENTORY_PATH)}`);
    return;
  }

  if (command === 'generate') {
    const inventory = await readInventory();
    await generateFromInventory(inventory);
    console.error('tool files regenerated from inventory');
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

async function buildInventory() {
  const files = await walkTypescriptFiles(TOOLS_DIR);
  const indexes = [];
  const tools = [];

  for (const filePath of files) {
    if (path.basename(filePath) === 'index.ts') {
      indexes.push(await parseIndexFile(filePath));
    } else {
      tools.push(await parseToolFile(filePath));
    }
  }

  indexes.sort((a, b) => a.groupPath.localeCompare(b.groupPath));
  tools.sort((a, b) => a.toolPath.localeCompare(b.toolPath));

  validateInventory(indexes, tools);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    indexes,
    tools,
  };
}

async function parseIndexFile(filePath) {
  const content = await readNormalized(filePath);
  const { bannerLine, body } = splitBanner(content);
  const exportMatch = body.match(/export const (\w+) = \[\n([\s\S]*?)\n\];\n?$/);
  if (!exportMatch) {
    throw new Error(`Unable to parse index export in ${relativeFromRoot(filePath)}`);
  }

  const exportName = exportMatch[1];
  const arrayBody = exportMatch[2];
  const importsSection = body.slice(0, exportMatch.index).trimEnd();
  const importLines = importsSection ? importsSection.split('\n') : [];
  const arrayEntries = arrayBody
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.endsWith(',') ? line.slice(0, -1) : line);

  return {
    groupPath: toPosix(path.relative(TOOLS_DIR, path.dirname(filePath))).replace(/^\.$/, ''),
    bannerLine,
    exportName,
    importLines,
    arrayEntries,
  };
}

async function parseToolFile(filePath) {
  const content = await readNormalized(filePath);
  const { bannerLine, body } = splitBanner(content);
  const exportMatch = body.match(/export const (\w+) = \{\n/);
  if (!exportMatch) {
    throw new Error(`Unable to parse tool export in ${relativeFromRoot(filePath)}`);
  }

  const exportName = exportMatch[1];
  const exportIndex = exportMatch.index;
  const importsSection = body.slice(0, exportIndex).trimEnd();
  const importLines = importsSection ? importsSection.split('\n') : [];

  const nameMarker = '\n  name: ';
  const descriptionMarker = '\n  description: ';
  const inputSchemaMarker = '\n  inputSchema: ';
  const handlerMarker = '\n  handler: ';
  const endMarker = '\n};';

  const nameStart = body.indexOf(nameMarker, exportIndex);
  const descriptionStart = body.indexOf(descriptionMarker, nameStart);
  const inputSchemaStart = body.indexOf(inputSchemaMarker, descriptionStart);
  const handlerStart = body.indexOf(handlerMarker, inputSchemaStart);
  const endStart = body.lastIndexOf(endMarker);

  if ([nameStart, descriptionStart, inputSchemaStart, handlerStart, endStart].some((v) => v < 0)) {
    throw new Error(`Unable to parse tool sections in ${relativeFromRoot(filePath)}`);
  }

  return {
    toolPath: toPosix(path.relative(TOOLS_DIR, filePath)).replace(/\.ts$/, ''),
    bannerLine,
    importLines,
    exportName,
    nameSource: trimTrailingComma(body.slice(nameStart + nameMarker.length, descriptionStart)),
    descriptionSource: trimTrailingComma(body.slice(descriptionStart + descriptionMarker.length, inputSchemaStart)),
    inputSchemaSource: trimTrailingComma(body.slice(inputSchemaStart + inputSchemaMarker.length, handlerStart)),
    handlerSource: trimTrailingComma(body.slice(handlerStart + handlerMarker.length, endStart)),
  };
}

function validateInventory(indexes, tools) {
  if (!indexes.find((indexFile) => indexFile.groupPath === '')) {
    throw new Error('Root src/tools/index.ts is missing from inventory');
  }

  const toolPathSet = new Set();
  for (const tool of tools) {
    if (toolPathSet.has(tool.toolPath)) {
      throw new Error(`Duplicate tool path in inventory: ${tool.toolPath}`);
    }
    toolPathSet.add(tool.toolPath);
  }

  for (const indexFile of indexes) {
    for (const entry of indexFile.arrayEntries) {
      if (!entry.startsWith('...')) {
        continue;
      }
      const importName = entry.slice(3);
      const hasImport = indexFile.importLines.some((line) => line.includes(`{ ${importName} }`));
      if (!hasImport) {
        throw new Error(`Spread entry ${entry} in ${indexFile.groupPath || 'root'} index has no matching import`);
      }
    }
  }
}

async function writeInventory(inventory) {
  await fs.mkdir(path.dirname(INVENTORY_PATH), { recursive: true });
  const content = `${JSON.stringify(inventory, null, 2)}\n`;
  await fs.writeFile(INVENTORY_PATH, content, 'utf8');
}

async function readInventory() {
  const content = await readNormalized(INVENTORY_PATH);
  return JSON.parse(content);
}

async function generateFromInventory(inventory) {
  for (const tool of inventory.tools) {
    const filePath = path.join(TOOLS_DIR, ...tool.toolPath.split('/')) + '.ts';
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, renderTool(tool), 'utf8');
  }

  for (const indexFile of inventory.indexes) {
    const filePath = indexFile.groupPath
      ? path.join(TOOLS_DIR, ...indexFile.groupPath.split('/'), 'index.ts')
      : path.join(TOOLS_DIR, 'index.ts');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, renderIndex(indexFile), 'utf8');
  }
}

function renderTool(tool) {
  const lines = [];

  if (tool.bannerLine) {
    lines.push(tool.bannerLine);
  }
  lines.push(...tool.importLines, '');
  lines.push(`export const ${tool.exportName} = {`);
  lines.push(`  name: ${tool.nameSource},`);
  lines.push(`  description: ${tool.descriptionSource},`);
  lines.push(`  inputSchema: ${tool.inputSchemaSource},`);
  lines.push(`  handler: ${tool.handlerSource},`);
  lines.push('};', '');

  return lines.join('\n');
}

function renderIndex(indexFile) {
  const lines = [];

  if (indexFile.bannerLine) {
    lines.push(indexFile.bannerLine);
  }
  lines.push(...indexFile.importLines, '');
  lines.push(`export const ${indexFile.exportName} = [`);
  for (const entry of indexFile.arrayEntries) {
    lines.push(`  ${entry},`);
  }
  lines.push('];', '');

  return lines.join('\n');
}

async function walkTypescriptFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkTypescriptFiles(fullPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

async function readNormalized(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return content.replace(/\r\n/g, '\n');
}

function splitBanner(content) {
  const firstLineEnd = content.indexOf('\n');
  if (firstLineEnd < 0) {
    return { bannerLine: null, body: content };
  }

  const firstLine = content.slice(0, firstLineEnd);
  if (firstLine.includes(AUTO_GENERATED_MARKER)) {
    return {
      bannerLine: firstLine,
      body: content.slice(firstLineEnd + 1),
    };
  }

  return { bannerLine: null, body: content };
}

function trimTrailingComma(value) {
  let result = value.trimEnd();
  if (result.endsWith(',')) {
    result = result.slice(0, -1);
  }
  return result;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function relativeFromRoot(filePath) {
  return toPosix(path.relative(ROOT_DIR, filePath));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
