#!/usr/bin/env node

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';

const APP_ROOT = process.cwd();
const REPO_ROOT = path.resolve(APP_ROOT, '..', '..');
const INVENTORY_PATH = path.join(REPO_ROOT, 'codegen', 'tool-inventory.json');
const OUTPUT_DIR = path.join(APP_ROOT, 'src', 'generated');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'openai-tool-registry.mjs');

async function main() {
  const inventory = JSON.parse(await fs.readFile(INVENTORY_PATH, 'utf8'));
  const tools = await Promise.all(inventory.tools.map((tool, index) => buildGeneratedTool(tool, index)));

  validateUniqueFunctionNames(tools);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(OUTPUT_PATH, renderGeneratedRegistry(tools), 'utf8');

  console.error(
    `generated ${tools.length} OpenAI function tool wrapper(s) to ${path.relative(APP_ROOT, OUTPUT_PATH)}`,
  );
}

async function buildGeneratedTool(toolMeta, index) {
  const modulePath = path.join(REPO_ROOT, 'src', 'tools', ...toolMeta.toolPath.split('/')) + '.ts';
  const moduleUrl = pathToFileURL(modulePath).href;
  const mod = await import(moduleUrl);
  const tool = mod[toolMeta.exportName];

  if (!tool) {
    throw new Error(`Export ${toolMeta.exportName} not found in ${toolMeta.toolPath}`);
  }

  if (typeof tool.name !== 'string' || typeof tool.description !== 'string' || !tool.inputSchema || typeof tool.handler !== 'function') {
    throw new Error(`Tool ${toolMeta.toolPath} does not match the expected shape`);
  }

  const namespace = path.posix.dirname(toolMeta.toolPath);
  const group = namespace.split('/')[0];
  const parameters = normalizeJsonSchema(
    zodToJsonSchema(tool.inputSchema, {
      target: 'jsonSchema7',
      $refStrategy: 'none',
    }),
  );
  const strictResult = buildStrictSchema(tool.inputSchema, parameters, tool.name);
  const compactDescription = toCompactDescription(tool.description);
  const importPath = toPosix(
    path.relative(OUTPUT_DIR, modulePath),
  );

  return {
    alias: `tool_${index}`,
    exportName: toolMeta.exportName,
    importPath: importPath.startsWith('.') ? importPath : `./${importPath}`,
    sourcePath: toolMeta.toolPath,
    namespace,
    group,
    name: tool.name,
    fullDescription: tool.description,
    compactDescription,
    parameters,
    strictCompatible: strictResult.compatible,
    strictParameters: strictResult.schema,
    strictIncompatibilityReasons: strictResult.reasons,
  };
}

function validateUniqueFunctionNames(tools) {
  const seen = new Set();
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      throw new Error(`Duplicate tool name for OpenAI function registry: ${tool.name}`);
    }
    seen.add(tool.name);
  }
}

function normalizeJsonSchema(schema) {
  const cloned = structuredClone(schema);
  stripUndefined(cloned);

  delete cloned.$schema;
  if (!cloned.type) {
    cloned.type = 'object';
  }
  if (!cloned.properties) {
    cloned.properties = {};
  }
  if (!cloned.required) {
    cloned.required = [];
  }

  return cloned;
}

function buildStrictSchema(zodSchema, baseSchema, pathLabel) {
  try {
    const result = convertZodToStrict(zodSchema, baseSchema, pathLabel);
    return {
      compatible: result.compatible,
      schema: result.schema,
      reasons: result.reasons,
    };
  } catch (error) {
    return {
      compatible: false,
      schema: baseSchema,
      reasons: [error instanceof Error ? error.message : String(error)],
    };
  }
}

function convertZodToStrict(zodSchema, baseSchema, pathLabel) {
  const unwrapped = unwrapZodSchema(zodSchema);
  const typeName = unwrapped.schema?._def?.typeName;

  if (!typeName) {
    return incompatible(baseSchema, `Unsupported schema at ${pathLabel}: missing zod type`);
  }

  switch (typeName) {
    case 'ZodObject':
      return convertObjectSchema(unwrapped, baseSchema, pathLabel);
    case 'ZodArray':
      return convertArraySchema(unwrapped, baseSchema, pathLabel);
    case 'ZodString':
      return compatible(
        applyNullability(
          withKeywords(baseSchema, ['description', 'minLength', 'maxLength', 'pattern', 'format'], {
            type: 'string',
          }),
          unwrapped,
        ),
        [],
      );
    case 'ZodNumber':
      return compatible(
        applyNullability(
          withKeywords(
            baseSchema,
            ['description', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'],
            {
              type: isIntegerSchema(unwrapped.schema, baseSchema) ? 'integer' : 'number',
            },
          ),
          unwrapped,
        ),
        [],
      );
    case 'ZodBoolean':
      return compatible(
        applyNullability(
          withKeywords(baseSchema, ['description'], {
            type: 'boolean',
          }),
          unwrapped,
        ),
        [],
      );
    case 'ZodEnum':
      return compatible(
        applyNullability(
          withKeywords(baseSchema, ['description'], {
            type: 'string',
            enum: [...unwrapped.schema._def.values],
          }),
          unwrapped,
        ),
        [],
      );
    case 'ZodLiteral':
      return compatible(
        applyNullability(
          literalSchema(unwrapped.schema._def.value, baseSchema),
          unwrapped,
        ),
        [],
      );
    case 'ZodUnion':
      return convertUnionSchema(unwrapped, baseSchema, pathLabel);
    default:
      return incompatible(
        baseSchema,
        `Unsupported strict schema type at ${pathLabel}: ${typeName}`,
      );
  }
}

function convertObjectSchema(unwrapped, baseSchema, pathLabel) {
  const shape = unwrapped.schema._def.shape();
  const properties = {};
  const required = [];
  const reasons = [];
  let allCompatible = true;

  for (const [key, childSchema] of Object.entries(shape)) {
    const childBase = baseSchema?.properties?.[key] ?? {};
    const childResult = convertZodToStrict(childSchema, childBase, `${pathLabel}.${key}`);
    properties[key] = childResult.schema;
    required.push(key);
    if (!childResult.compatible) {
      allCompatible = false;
      reasons.push(...childResult.reasons);
    }
  }

  return {
    compatible: allCompatible,
    reasons,
    schema: applyNullability(
      withKeywords(baseSchema, ['description'], {
        type: 'object',
        additionalProperties: false,
        properties,
        required,
      }),
      unwrapped,
    ),
  };
}

function convertArraySchema(unwrapped, baseSchema, pathLabel) {
  const itemSchema = unwrapped.schema._def.type;
  const itemBase = baseSchema?.items ?? {};
  const itemResult = convertZodToStrict(itemSchema, itemBase, `${pathLabel}[]`);

  return {
    compatible: itemResult.compatible,
    reasons: itemResult.reasons,
    schema: applyNullability(
      withKeywords(baseSchema, ['description', 'minItems', 'maxItems'], {
        type: 'array',
        items: itemResult.schema,
      }),
      unwrapped,
    ),
  };
}

function convertUnionSchema(unwrapped, baseSchema, pathLabel) {
  const values = [];
  let type = null;
  let nullable = unwrapped.acceptsNull;

  for (const option of unwrapped.schema._def.options) {
    const optionUnwrapped = unwrapZodSchema(option);
    const optionTypeName = optionUnwrapped.schema?._def?.typeName;

    if (optionTypeName === 'ZodLiteral') {
      const literalValue = optionUnwrapped.schema._def.value;
      if (literalValue === null) {
        nullable = true;
        continue;
      }

      const literalType = typeof literalValue;
      if (!['string', 'number', 'boolean'].includes(literalType)) {
        return incompatible(baseSchema, `Unsupported literal union at ${pathLabel}: ${literalType}`);
      }

      if (type && type !== normalizeLiteralType(literalType, literalValue)) {
        return incompatible(baseSchema, `Mixed literal union at ${pathLabel} is not strict-compatible`);
      }

      type = normalizeLiteralType(literalType, literalValue);
      values.push(literalValue);
      continue;
    }

    if (optionTypeName === 'ZodNull') {
      nullable = true;
      continue;
    }

    return incompatible(
      baseSchema,
      `Unsupported union option at ${pathLabel}: ${optionTypeName}`,
    );
  }

  if (!type || values.length === 0) {
    return incompatible(baseSchema, `Empty or unsupported union at ${pathLabel}`);
  }

  return {
    compatible: true,
    reasons: [],
    schema: applyNullability(
      withKeywords(baseSchema, ['description'], {
        type,
        enum: values,
      }),
      {
        omittable: unwrapped.omittable,
        acceptsNull: nullable,
      },
    ),
  };
}

function unwrapZodSchema(schema) {
  let current = schema;
  let omittable = false;
  let acceptsNull = false;

  while (current?._def?.typeName) {
    const typeName = current._def.typeName;
    if (typeName === 'ZodOptional') {
      omittable = true;
      current = current._def.innerType;
      continue;
    }
    if (typeName === 'ZodDefault') {
      omittable = true;
      current = current._def.innerType;
      continue;
    }
    if (typeName === 'ZodNullable') {
      acceptsNull = true;
      current = current._def.innerType;
      continue;
    }
    break;
  }

  return {
    schema: current,
    omittable,
    acceptsNull,
  };
}

function applyNullability(schema, flags) {
  if (!flags.omittable && !flags.acceptsNull) {
    return schema;
  }

  if (schema?.anyOf?.some((item) => item?.type === 'null')) {
    return schema;
  }

  return {
    anyOf: [
      schema,
      { type: 'null' },
    ],
  };
}

function withKeywords(baseSchema, keys, seed) {
  const result = { ...seed };
  for (const key of keys) {
    if (baseSchema?.[key] !== undefined) {
      result[key] = structuredClone(baseSchema[key]);
    }
  }
  return result;
}

function literalSchema(value, baseSchema) {
  const valueType = typeof value;
  if (valueType === 'string') {
    return withKeywords(baseSchema, ['description'], {
      type: 'string',
      enum: [value],
    });
  }
  if (valueType === 'boolean') {
    return withKeywords(baseSchema, ['description'], {
      type: 'boolean',
      enum: [value],
    });
  }
  if (valueType === 'number') {
    return withKeywords(baseSchema, ['description'], {
      type: Number.isInteger(value) ? 'integer' : 'number',
      enum: [value],
    });
  }

  throw new Error(`Unsupported literal value type: ${valueType}`);
}

function normalizeLiteralType(valueType, value) {
  if (valueType === 'number') {
    return Number.isInteger(value) ? 'integer' : 'number';
  }
  return valueType;
}

function isIntegerSchema(zodSchema, baseSchema) {
  if (baseSchema?.type === 'integer') {
    return true;
  }

  return Array.isArray(zodSchema?._def?.checks)
    && zodSchema._def.checks.some((check) => check.kind === 'int');
}

function compatible(schema, reasons) {
  return {
    compatible: true,
    reasons,
    schema,
  };
}

function incompatible(schema, reason) {
  return {
    compatible: false,
    reasons: [reason],
    schema,
  };
}

function stripUndefined(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      stripUndefined(item);
    }
    return;
  }

  if (!value || typeof value !== 'object') {
    return;
  }

  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
      continue;
    }

    stripUndefined(value[key]);
  }
}

function toCompactDescription(description) {
  const normalized = description.replace(/\s+/g, ' ').trim();
  const firstParagraph = normalized.split('**')[0].trim() || normalized;
  if (firstParagraph.length <= 240) {
    return firstParagraph;
  }
  return `${firstParagraph.slice(0, 237).trimEnd()}...`;
}

function renderGeneratedRegistry(tools) {
  const groups = Array.from(new Set(tools.map((tool) => tool.group))).sort();
  const namespaces = Array.from(new Set(tools.map((tool) => tool.namespace))).sort();
  const groupCounts = Object.fromEntries(
    groups.map((group) => [group, tools.filter((tool) => tool.group === group).length]),
  );

  const lines = [];
  lines.push('// openai-tool-registry.mjs — auto-generated, do not edit');

  for (const tool of tools) {
    lines.push(
      `import { ${tool.exportName} as ${tool.alias} } from ${JSON.stringify(tool.importPath)};`,
    );
  }

  lines.push('', 'export const generatedOpenAiToolRegistry = [');
  for (const tool of tools) {
    lines.push('  {');
    lines.push(`    name: ${JSON.stringify(tool.name)},`);
    lines.push(`    group: ${JSON.stringify(tool.group)},`);
    lines.push(`    namespace: ${JSON.stringify(tool.namespace)},`);
    lines.push(`    sourcePath: ${JSON.stringify(tool.sourcePath)},`);
    lines.push(`    compactDescription: ${JSON.stringify(tool.compactDescription)},`);
    lines.push(`    fullDescription: ${JSON.stringify(tool.fullDescription)},`);
    lines.push(`    parameters: ${JSON.stringify(tool.parameters)},`);
    lines.push(`    strictCompatible: ${JSON.stringify(tool.strictCompatible)},`);
    lines.push(`    strictParameters: ${JSON.stringify(tool.strictParameters)},`);
    lines.push(`    strictIncompatibilityReasons: ${JSON.stringify(tool.strictIncompatibilityReasons)},`);
    lines.push(`    tool: ${tool.alias},`);
    lines.push('  },');
  }
  lines.push('];', '');

  lines.push(`export const generatedOpenAiGroups = ${JSON.stringify(groups, null, 2)};`, '');
  lines.push(`export const generatedOpenAiNamespaces = ${JSON.stringify(namespaces, null, 2)};`, '');
  lines.push(`export const generatedOpenAiGroupCounts = ${JSON.stringify(groupCounts, null, 2)};`, '');

  return `${lines.join('\n')}\n`;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
