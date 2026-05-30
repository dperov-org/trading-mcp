#!/usr/bin/env node

import { spawn } from 'node:child_process';
import process from 'node:process';

const MIN_NODE_MAJOR = 20;
const MIN_NODE_MINOR = 6;

async function main() {
  assertNodeVersion();

  const steps = [
    {
      name: 'generate',
      command: npmRunCommand('generate'),
      description: 'Regenerate src/tools/** from codegen/tool-inventory.json',
    },
    {
      name: 'typecheck',
      command: npmRunCommand('typecheck'),
      description: 'Type-check the TypeScript source tree with tsc --noEmit',
    },
    {
      name: 'build',
      command: npmRunCommand('build'),
      description: 'Build the production bundle with tsup',
    },
  ];

  const summary = [];

  for (const step of steps) {
    console.error(`verify:${step.name} — ${step.description}`);
    const startedAt = Date.now();
    await run(step.command);
    summary.push({
      name: step.name,
      durationMs: Date.now() - startedAt,
    });
  }

  console.error('verify summary:');
  for (const item of summary) {
    console.error(`- ${item.name}: ${item.durationMs} ms`);
  }
}

function assertNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map((value) => Number(value));
  const isSupported = major > MIN_NODE_MAJOR || (major === MIN_NODE_MAJOR && minor >= MIN_NODE_MINOR);

  if (!isSupported) {
    throw new Error(
      `Node.js ${process.versions.node} is too old. Required: >=${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}.`,
    );
  }
}

function npmRunCommand(scriptName) {
  if (process.platform === 'win32') {
    const cmd = process.env.ComSpec || 'cmd.exe';
    return {
      file: cmd,
      args: ['/d', '/s', '/c', `npm run ${scriptName}`],
      label: `npm run ${scriptName}`,
    };
  }

  return {
    file: 'npm',
    args: ['run', scriptName],
    label: `npm run ${scriptName}`,
  };
}

function run(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      stdio: 'inherit',
      shell: false,
      env: process.env,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`${command.label} terminated by signal ${signal}`));
        return;
      }

      reject(new Error(`${command.label} exited with code ${code}`));
    });
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
