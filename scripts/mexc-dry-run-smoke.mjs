import assert from 'node:assert/strict';
import process from 'node:process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['--import', 'tsx/esm', 'src/mexc.ts'],
  cwd: process.cwd(),
  env: {
    ...process.env,
    MEXC_WRITE_MODE: 'dry-run',
  },
  stderr: 'pipe',
});

const client = new Client({ name: 'mexc-dry-run-smoke', version: '0.1.0' }, { capabilities: {} });

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const triggerTool = tools.tools.find((tool) => tool.name === 'createFuturesTriggerOrder');
  assert.ok(triggerTool, 'createFuturesTriggerOrder must be published');
  assert.ok(!triggerTool.description?.toLowerCase().includes('dry-run'));
  assert.match(triggerTool.inputSchema?.properties?.orderType?.description ?? '', /5=market/);
  const response = await client.callTool({
    name: 'createFuturesTriggerOrder',
    arguments: {
      symbol: 'BTC_USDT',
      vol: 1,
      leverage: 2,
      side: 1,
      openType: 2,
      triggerPrice: 105000,
      triggerType: 1,
      executeCycle: 1,
      orderType: 5,
      trend: 1,
      stopLossPrice: 102000,
      takeProfitPrice: 111000,
      reduceOnly: false,
    },
  });
  const payload = JSON.parse(response.content?.[0]?.text ?? '{}');
  assert.equal(response.isError, undefined);
  assert.equal(payload.mode, 'dry-run');
  assert.equal(payload.exchangeRequestSent, false);
  assert.equal(payload.operation, 'createFuturesTriggerOrder');
  assert.equal(payload.validatedArguments.side, 1);

  const stringEnumResponse = await client.callTool({
    name: 'createFuturesTriggerOrder',
    arguments: {
      symbol: 'BTC_USDT', vol: '1', leverage: 2, side: '1', openType: '2',
      triggerPrice: '105000', triggerType: '1', executeCycle: '1', orderType: '5', trend: '1',
      stopLossPrice: '102000', takeProfitPrice: '111000', positionMode: '1', reduceOnly: false,
    },
  });
  const stringEnumPayload = JSON.parse(stringEnumResponse.content?.[0]?.text ?? '{}');
  assert.equal(stringEnumResponse.isError, undefined);
  assert.equal(stringEnumPayload.mode, 'dry-run');
  assert.equal(stringEnumPayload.validatedArguments.side, 1);
  assert.equal(stringEnumPayload.validatedArguments.orderType, 5);
  assert.equal(stringEnumPayload.validatedArguments.positionMode, 1);

  const invalidEnumResponse = await client.callTool({
    name: 'createFuturesTriggerOrder',
    arguments: {
      symbol: 'BTC_USDT', vol: 1, leverage: 2, side: '1.0', openType: 2,
      triggerPrice: 105000, triggerType: 1, executeCycle: 1, orderType: 5, trend: 1,
      stopLossPrice: 102000, takeProfitPrice: 111000, reduceOnly: false,
    },
  });
  assert.equal(invalidEnumResponse.isError, true);
  assert.match(invalidEnumResponse.content?.[0]?.text ?? '', /side: Invalid input/);
  console.log('mexc dry-run smoke: passed (no exchange request sent)');
} finally {
  await client.close();
  await transport.close();
}
