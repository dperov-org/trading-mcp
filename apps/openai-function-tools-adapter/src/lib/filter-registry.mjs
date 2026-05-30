import {
  generatedOpenAiGroupCounts,
  generatedOpenAiGroups,
  generatedOpenAiNamespaces,
  generatedOpenAiToolRegistry,
} from '../generated/openai-tool-registry.mjs';

export function parseCliArgs(argv) {
  const result = {
    groups: [],
    excludeGroups: [],
    tools: [],
    excludeTools: [],
    descriptionMode: 'compact',
    question: '',
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--groups') {
      result.groups = splitList(argv[++index]);
      continue;
    }
    if (value === '--exclude-groups') {
      result.excludeGroups = splitList(argv[++index]);
      continue;
    }
    if (value === '--tools') {
      result.tools = splitList(argv[++index]);
      continue;
    }
    if (value === '--exclude-tools') {
      result.excludeTools = splitList(argv[++index]);
      continue;
    }
    if (value === '--description-mode') {
      result.descriptionMode = argv[++index] === 'full' ? 'full' : 'compact';
      continue;
    }

    positional.push(value);
  }

  result.question = positional.join(' ').trim();
  return result;
}

export function selectRegistry(options = {}) {
  const includeGroups = new Set(options.groups ?? []);
  const excludeGroups = new Set(options.excludeGroups ?? []);
  const includeTools = new Set(options.tools ?? []);
  const excludeTools = new Set(options.excludeTools ?? []);

  const filtered = generatedOpenAiToolRegistry.filter((entry) => {
    if (includeTools.size > 0 && !includeTools.has(entry.name)) {
      return false;
    }

    if (excludeTools.has(entry.name)) {
      return false;
    }

    if (includeGroups.size > 0 && !matchesAnyGroupSelector(entry, includeGroups)) {
      return false;
    }

    if (excludeGroups.size > 0 && matchesAnyGroupSelector(entry, excludeGroups)) {
      return false;
    }

    return true;
  });

  return filtered;
}

export function toOpenAiFunctionTools(registry, options = {}) {
  const descriptionMode = options.descriptionMode === 'full' ? 'full' : 'compact';

  return registry.map((entry) => ({
    type: 'function',
    name: entry.name,
    description: descriptionMode === 'full' ? entry.fullDescription : entry.compactDescription,
    parameters: entry.strictCompatible ? entry.strictParameters : entry.parameters,
    strict: entry.strictCompatible,
  }));
}

export function availableGroups() {
  return generatedOpenAiGroups;
}

export function availableNamespaces() {
  return generatedOpenAiNamespaces;
}

export function groupCounts() {
  return generatedOpenAiGroupCounts;
}

function matchesAnyGroupSelector(entry, selectors) {
  for (const selector of selectors) {
    if (entry.group === selector) {
      return true;
    }
    if (entry.namespace === selector) {
      return true;
    }
    if (entry.namespace.startsWith(`${selector}/`)) {
      return true;
    }
  }

  return false;
}

function splitList(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
