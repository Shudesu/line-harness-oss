import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const client = new Client({ name: 'synthetic-schema-smoke', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [fileURLToPath(new URL('../dist/index.js', import.meta.url))],
  // Do not inherit account credentials. Invalid input must fail before API use.
  env: { PATH: process.env.PATH ?? '', LINE_HARNESS_API_URL: 'https://synthetic.invalid', LINE_HARNESS_API_KEY: 'synthetic-unused' },
  stderr: 'pipe',
});
try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert(tools.length > 0);
  assert(tools.every(tool => tool.inputSchema.type === 'object'));
  const result = await client.callTool({ name: 'list_friends', arguments: { limit: 'invalid' } });
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result), /validation|invalid_type|Invalid arguments/i);
  console.log(`MCP handshake, ${tools.length} tool schemas and invalid-input rejection passed; no API calls made.`);
} finally {
  await client.close();
}
