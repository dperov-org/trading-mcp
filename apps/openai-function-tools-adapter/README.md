# OpenAI Function Tools Adapter

This project exposes the local `trading-mcp` tool layer to the OpenAI Responses API as `function` tools instead of MCP tools.

It works directly against the repo source code:

1. Reads the root tool inventory from `../../codegen/tool-inventory.json`
2. Code-generates a full OpenAI function registry for every tool in `../../src/tools/**`
3. Lets you enable or disable tools by group, namespace, or exact tool name
4. Generates both non-strict and OpenAI strict-compatible parameter schemas
5. Runs the normal OpenAI function-calling loop and executes the local tool handlers directly

## What Is Generated

`npm run codegen` generates [src/generated/openai-tool-registry.mjs](./src/generated/openai-tool-registry.mjs), which contains:

- every available tool in the repo
- top-level group metadata
- full namespace metadata
- compact and full descriptions
- JSON Schema parameters for OpenAI function tools
- OpenAI strict-compatible parameter schemas where possible
- references to the local tool handlers

The generated registry currently covers all repo groups, including:

- `account`
- `advanceearn`
- `affiliate`
- `alpha`
- `asset`
- `bot`
- `broker`
- `copy-trading-classic`
- `copy-trading-tradfi`
- `crypto-loan-fixed-term`
- `crypto-loan-flexible`
- `crypto-loan-new`
- `doublewin`
- `earn`
- `earntoken`
- `fiat-convert`
- `fixedterm`
- `liquiditymining`
- `market`
- `p2p`
- `position`
- `rfq-trading`
- `smartleverage`
- `spot-margin-trade-uta`
- `spot-margin-uta`
- `spread-trading`
- `strategy`
- `subscription`
- `trade`
- `user`
- `websocket`
- `wstrade`

Use `npm run groups` to print counts per group from the generated registry.

## Requirements

- root project dependencies installed
- adapter project dependencies installed
- `OPENAI_API_KEY` present in `../../.env`
- Bybit credentials present in `../../.env`

The adapter reads `../../.env` automatically and maps `BYBIT_RO_API_KEY` / `BYBIT_RO_API_SECRET` to the local tools when full `BYBIT_API_KEY` / `BYBIT_API_SECRET` are not set.

## Install

```bash
cd apps/openai-function-tools-adapter
npm install
npm run codegen
```

## Group And Tool Filters

Supported selectors:

- `--groups market,account`
- `--exclude-groups websocket,wstrade`
- `--tools getTickers,getWalletBalance`
- `--exclude-tools createOrder,wsCreateOrder`
- `--description-mode compact`
- `--description-mode full`

Group selectors match either the top-level group or the full namespace. For example:

- `asset` includes every `asset/*` tool
- `asset/deposit` includes only deposit tools under `asset`

## Ask One Question

This command exposes every generated tool by default. Use filters for cost and safety.

```bash
npm run ask -- "What is the current BTC/USDT price?"
```

Example with a constrained surface:

```bash
npm run ask -- --groups market,account --exclude-groups websocket,wstrade "What is the current BTC/USDT price?"
```

## Live Check

The built-in live check uses a small safe tool allowlist and asks:

- `What is the current BTC/USDT price?`
- `What's my wallet balance?`
- `Do I currently have any open spot orders?`

Run it with:

```bash
npm run live-check
```

It writes a JSON report to `artifacts/`.

## Notes

- This adapter bypasses MCP entirely. It calls the existing tool handlers directly.
- When a tool is strict-compatible, the adapter exports it to OpenAI with `strict: true`.
- Strict-compatible optional fields are represented as nullable in the generated schema, then normalized back to omitted/defaulted inputs before local `zod.parse()`.
- The generated registry includes write-capable and trading-capable tools. Be deliberate with group filters.
- Exposing all tools at once is possible, but it is expensive in tokens and can be operationally risky.
