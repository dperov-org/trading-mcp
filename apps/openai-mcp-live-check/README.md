# OpenAI MCP Live Check

This project verifies the local `trading-mcp` server in a real LLM flow:

1. Starts the repo's existing Bybit MCP server over stdio.
2. Bridges it to Streamable HTTP MCP on `127.0.0.1`.
3. Exposes that bridge through a temporary public HTTPS tunnel.
4. Calls the OpenAI Responses API with the MCP tool attached.
5. Asks simple natural-language questions and checks that the model used MCP tools.

## What It Tests

By default the bridge exposes a small read-only tool allowlist:

- `getServerTime`
- `getTickers`
- `getOrderbook`
- `queryAPIKey`
- `getAccountInfo`
- `getWalletBalance`
- `getOpenOrders`

The default live check asks:

- `What is the current BTC/USDT price?`
- `What's my wallet balance?`
- `Do I currently have any open spot orders?`

For each prompt, the runner records:

- which model was used
- which MCP tools were imported
- which MCP tools were called
- whether those MCP calls completed successfully
- the final natural-language answer from the model

It does **not** place, amend, or cancel orders.

## Requirements

- Root project dependencies installed
- `OPENAI_API_KEY` present in `../../.env`
- Bybit credentials present in `../../.env`

The runner automatically maps `BYBIT_RO_API_KEY` and `BYBIT_RO_API_SECRET` to the child MCP server if full `BYBIT_API_KEY` / `BYBIT_API_SECRET` are not set.

The bridge launches `../../src/server.ts` through `tsx` instead of `../../dist/index.js`. This is intentional: the published package entrypoint contains an online version gate, while this live-check project is meant to validate the local repo state.

## Install

```bash
cd apps/openai-mcp-live-check
npm install
```

## Run The Full Live Check

```bash
npm run live-check
```

The runner writes a timestamped report to `artifacts/`.

## Ask One Custom Question

```bash
npm run ask -- "What is the current BTC/USDT price?"
```

## Notes

- The OpenAI Responses API MCP integration requires a public URL, so this project creates a temporary tunnel automatically.
- Tool approvals are set to `never` for the smoke test because the bridge only exposes the read-only allowlist above.
- If you want to expose the full MCP tool surface, set `EXPOSE_ALL_TOOLS=1` before running.
