import process from 'node:process';
import { parseCliArgs } from './lib/filter-registry.mjs';
import { runQuestion } from './lib/openai-function-runner.mjs';

async function main() {
  const parsed = parseCliArgs(process.argv.slice(2));
  if (!parsed.question) {
    throw new Error(
      'Usage: npm run ask -- [--groups market,account] [--exclude-groups websocket] [--tools getTickers] [--exclude-tools createOrder] [--description-mode compact|full] "Your question"',
    );
  }

  const result = await runQuestion(parsed.question, {
    groups: parsed.groups,
    excludeGroups: parsed.excludeGroups,
    tools: parsed.tools,
    excludeTools: parsed.excludeTools,
    descriptionMode: parsed.descriptionMode,
  });

  console.log(`Model: ${result.model}`);
  console.log(`Exposed tools: ${result.exposedTools.length}`);
  console.log(`Executed calls: ${result.transcript.length}`);
  if (
    parsed.groups.length === 0 &&
    parsed.excludeGroups.length === 0 &&
    parsed.tools.length === 0 &&
    parsed.excludeTools.length === 0
  ) {
    console.log('Warning: no filters were applied; the full generated tool surface was exposed.');
  }
  console.log('');
  console.log(result.answer);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
