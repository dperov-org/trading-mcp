import {
  defaultSafeToolNames,
} from './lib/config.mjs';
import {
  runQuestion,
  writeJsonArtifact,
} from './lib/openai-function-runner.mjs';

const QUESTIONS = [
  'What is the current BTC/USDT price? Use the available tools and give me the exact price you retrieved.',
  "What's my wallet balance? Use the available tools and summarize the accessible balances.",
  'Do I currently have any open spot orders? Use the available tools and answer with the current count if possible.',
];

const LIVE_CHECK_INSTRUCTIONS = [
  'You are validating the local Bybit tool adapter that uses OpenAI function tools.',
  'Always use the available tools when relevant.',
  'For BTC/USDT price, prefer getTickers with category="spot" and symbol="BTCUSDT".',
  'For wallet balance, prefer getWalletBalance with accountType="UNIFIED" and omit coin unless explicitly required.',
  'For open spot orders, prefer getOpenOrders with category="spot".',
  'Answer briefly with retrieved facts only.',
].join(' ');

async function main() {
  const entries = [];
  let selectedModel = null;

  for (const question of QUESTIONS) {
    const result = await runQuestion(question, {
      tools: defaultSafeToolNames,
      descriptionMode: 'compact',
      instructions: LIVE_CHECK_INSTRUCTIONS,
      parallelToolCalls: false,
      maxSteps: 8,
      maxOutputTokens: 900,
    });

    selectedModel = result.model;
    entries.push({
      question,
      answer: result.answer,
      transcript: result.transcript,
      exposedTools: result.exposedTools,
    });
  }

  const report = {
    ranAt: new Date().toISOString(),
    model: selectedModel,
    tools: defaultSafeToolNames,
    questions: entries,
  };

  const artifactPath = await writeJsonArtifact('live-check', report);

  console.log(`Model: ${report.model}`);
  console.log(`Report: ${artifactPath}`);
  console.log('');

  for (const entry of report.questions) {
    console.log(`Q: ${entry.question}`);
    console.log(`Calls: ${entry.transcript.map((item) => `${item.name}:${item.ok ? 'ok' : 'error'}`).join(', ')}`);
    console.log(`A: ${entry.answer}`);
    console.log('');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
