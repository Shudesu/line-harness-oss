# @line-harness/sdk

AI-native SDK for LINE Harness — programmatic LINE official account automation.

Replaces L社/U社 with a fully API-driven approach designed for AI agents (Claude Code).

## Install

```bash
npm install @line-harness/sdk
```

## Quick Start

```ts
import { LineHarness } from '@line-harness/sdk'

const client = new LineHarness({
  apiUrl: 'https://your-worker.workers.dev',
  apiKey: 'your-api-key',
})

// Create a 3-step education scenario
const scenario = await client.createStepScenario('Welcome Flow', 'friend_add', [
  { delay: '0m', type: 'text', content: 'Welcome! Thanks for adding us.' },
  { delay: '1d', type: 'text', content: 'Here are 3 things you should know...' },
  { delay: '3d', type: 'flex', content: JSON.stringify(flexMessageJson) },
])

// Broadcast to all friends
await client.broadcastText('Weekend sale! 50% off!')

// Broadcast to tagged friends
await client.broadcastToTag(tagId, 'text', 'VIP exclusive coupon: CODE123')
```

## API Reference

### Low-Level (1:1 with Worker API)

#### Friends

```ts
const { items, total, hasNextPage } = await client.friends.list({ limit: 50, offset: 0 })
const friend = await client.friends.get(friendId)
const count = await client.friends.count()
await client.friends.addTag(friendId, tagId)
await client.friends.removeTag(friendId, tagId)
```

#### Tags

```ts
const tags = await client.tags.list()
const tag = await client.tags.create({ name: 'VIP', color: '#EF4444' })
await client.tags.delete(tagId)
```

#### Scenarios

```ts
const scenarios = await client.scenarios.list()
const scenario = await client.scenarios.create({ name: 'Flow', triggerType: 'friend_add' })
const full = await client.scenarios.get(scenarioId)
await client.scenarios.update(scenarioId, { isActive: false })
await client.scenarios.delete(scenarioId)

// Steps
await client.scenarios.addStep(scenarioId, {
  stepOrder: 1, delayMinutes: 0, messageType: 'text', messageContent: 'Hello!',
})
await client.scenarios.updateStep(scenarioId, stepId, { messageContent: 'Updated' })
await client.scenarios.deleteStep(scenarioId, stepId)

// Enrollment
await client.scenarios.enroll(scenarioId, friendId)
```

#### Broadcasts

```ts
const broadcasts = await client.broadcasts.list()
const broadcast = await client.broadcasts.create({
  title: 'Sale', messageType: 'text', messageContent: '50% off!', targetType: 'all',
})
await client.broadcasts.update(broadcastId, { scheduledAt: '2026-04-01T09:00:00Z' })
await client.broadcasts.send(broadcastId)
await client.broadcasts.delete(broadcastId)
```

### High-Level (Convenience)

```ts
// Create scenario with steps in one call (delay: '0m', '1h', '1d', '1w')
await client.createStepScenario(name, triggerType, steps)

// Broadcast text to all
await client.broadcastText('Message')

// Broadcast to tagged friends
await client.broadcastToTag(tagId, 'text', 'Message')
```

## Error Handling

```ts
import { LineHarness, LineHarnessError } from '@line-harness/sdk'

try {
  await client.scenarios.get('nonexistent')
} catch (err) {
  if (err instanceof LineHarnessError) {
    console.log(err.status)    // 404
    console.log(err.message)   // 'Scenario not found'
    console.log(err.endpoint)  // 'GET /api/scenarios/nonexistent'
  }
}
```

## Requirements

- Node.js 18+ (uses native `fetch`)
- A deployed LINE Harness Worker API

## License

MIT
