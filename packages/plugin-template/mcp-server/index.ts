/**
 * MCP Server for MyService plugin.
 *
 * Registers custom tools that let AI agents interact with
 * both MyService and LINE Harness in a unified interface.
 *
 * Usage:
 *   node dist-mcp/index.js
 *
 * Configure in .mcp.json:
 *   {
 *     "mcpServers": {
 *       "myservice": {
 *         "command": "node",
 *         "args": ["path/to/dist-mcp/index.js"],
 *         "env": {
 *           "LINE_HARNESS_API_URL": "https://...",
 *           "LINE_HARNESS_API_KEY": "...",
 *           "EXTERNAL_API_KEY": "..."
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerExampleTool } from './tools/example-tool.js'

const server = new McpServer({
  name: 'line-harness-plugin-myservice',
  version: '0.1.0',
})

// Register all plugin-specific tools
registerExampleTool(server)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('MyService Plugin MCP Server running on stdio')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
