# L Harness Plugin Template

A template for building integrations that connect external services to L Harness.

**開発用テンプレートです。** 外部APIはサンプルで、署名検証や通知のイベント単位の重複防止は実装が必要です。定期実行・通知・Webhook受付は初期状態では無効です。すぐに条件を変えて使いたい場合は[条件タグ付けプラグイン](../../examples/plugins/tag-rules/README.md)を選んでください。

Use this as a starting point when building a plugin for services like MedicalForce, HotPepper, Shopify, or any other platform.

## What This Template Includes

| File | Purpose |
|---|---|
| `src/index.ts` | CF Worker entry point with cron + webhook handlers |
| `src/sync.ts` | Sync external data to L Harness (tags, metadata) |
| `src/notify.ts` | Send LINE messages based on external conditions |
| `src/external-api.ts` | External API client stub |
| `mcp-server/index.ts` | MCP server for AI agent integration |
| `mcp-server/tools/example-tool.ts` | Example MCP tools combining external API + L Harness |

## Getting Started

1. **Copy this template** into a new directory:

```bash
pnpm plugin:create ../plugin-yourservice integration
cd ../plugin-yourservice
```

2. **Rename** all occurrences of `MyService` / `myservice` to your service name.

3. **Implement the external API client** in `src/external-api.ts` — replace the stub with real API calls.

4. **Customize sync logic** in `src/sync.ts` — define which data maps to L Harness tags and metadata.

5. **Customize notifications** in `src/notify.ts` — define when and what messages to send.

6. **Install dependencies** (the generated project is independent of the main repository):

```bash
npm install
npm run typecheck
```

## Configuration

### Environment Variables

| Variable | Description |
|---|---|
| `LINE_HARNESS_API_URL` | Your L Harness API base URL |
| `LINE_HARNESS_API_KEY` | API key for L Harness (set as secret) |
| `EXTERNAL_API_KEY` | API key for the external service (set as secret) |
| `LINE_ACCOUNT_ID` | (Optional) LINE account ID for multi-account setups |

### Setting Secrets

```bash
wrangler secret put LINE_HARNESS_API_KEY
wrangler secret put EXTERNAL_API_KEY
```

### Cron Schedule

Edit `wrangler.toml` to change the sync frequency:

Cron is disabled by default. Implement and test the external API before enabling it. Notification examples in `src/notify.ts` are not called until you explicitly wire them in; replace their illustrative friend-level dedup tags with event-level persistence and retry handling before use.

```toml
[triggers]
crons = ["0 * * * *"]    # every hour
# crons = ["*/15 * * * *"]  # every 15 minutes
# crons = ["0 9 * * *"]     # daily at 9:00 UTC
```

## Deploying the Worker

```bash
# Development
pnpm dev

# Production
pnpm deploy
```

## MCP Server Setup

The MCP server lets AI agents (Claude, etc.) interact with your plugin via natural language.

### Build

```bash
pnpm build:mcp
```

### Register in `.mcp.json`

```json
{
  "mcpServers": {
    "myservice": {
      "command": "node",
      "args": ["packages/plugin-yourservice/dist-mcp/index.js"],
      "env": {
        "LINE_HARNESS_API_URL": "https://your-line-harness.example.com",
        "LINE_HARNESS_API_KEY": "your-api-key",
        "EXTERNAL_API_KEY": "your-external-api-key"
      }
    }
  }
}
```

### Available MCP Tools

| Tool | Description |
|---|---|
| `lookup_customer` | Look up a customer in MyService and show their LINE profile |
| `send_myservice_notification` | Send a notification to a LINE friend |

Add more tools by creating files in `mcp-server/tools/` and registering them in `mcp-server/index.ts`.

## Architecture

```
External Service (MyService)
    │
    ├── Cron sync ──→ L Harness API (tags, metadata)
    ├── Webhooks ───→ CF Worker → L Harness API (messages)
    └── MCP tools ──→ AI Agent → L Harness SDK
```

The plugin acts as a bridge: it reads data from the external service and writes to L Harness via the SDK. It never touches LINE's Messaging API directly — that is handled by L Harness.

## Adding New MCP Tools

1. Create a new file in `mcp-server/tools/`:

```typescript
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

export function registerMyTool(server: McpServer): void {
  server.tool(
    'my_tool_name',
    'Description of what this tool does',
    {
      param1: z.string().describe('Parameter description'),
    },
    async ({ param1 }) => {
      // Your implementation here
      return {
        content: [{ type: 'text', text: JSON.stringify({ result: param1 }) }],
      }
    },
  )
}
```

2. Register it in `mcp-server/index.ts`:

```typescript
import { registerMyTool } from './tools/my-tool.js'
registerMyTool(server)
```

## License

MIT
