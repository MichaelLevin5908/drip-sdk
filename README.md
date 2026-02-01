# @drip-sdk/node

The official Node.js SDK for **Drip** - Usage tracking and cost attribution for metered infrastructure.

Drip is the system of record for usage. We capture high-frequency metering for RPC providers, API companies, and AI agents - with cost attribution, execution traces, and real-time analytics.

[![npm version](https://badge.fury.io/js/@drip-sdk/node.svg)](https://www.npmjs.com/package/@drip-sdk/node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install @drip-sdk/node
```

## Core SDK (Recommended for Pilots)

For most use cases, import the **Core SDK** - a simplified API focused on two concepts:

1. **Usage Tracking** - Record metered usage events
2. **Execution Logging** - Log agent runs with detailed event traces

```typescript
import { Drip } from '@drip-sdk/node/core';

const drip = new Drip({ apiKey: process.env.DRIP_API_KEY! });

// Verify connection
await drip.ping();
```

### Track Usage

```typescript
// Track any metered usage (no billing - just recording)
await drip.trackUsage({
  customerId: 'cus_123',
  meter: 'api_calls',
  quantity: 1,
  metadata: { endpoint: '/v1/generate', method: 'POST' },
});
```

### Record Agent Runs

```typescript
// Record a complete agent execution with one call
const result = await drip.recordRun({
  customerId: 'cus_123',
  workflow: 'research-agent',
  events: [
    { eventType: 'llm.call', model: 'gpt-4', inputTokens: 500, outputTokens: 1200 },
    { eventType: 'tool.call', name: 'web-search', duration: 1500 },
    { eventType: 'llm.call', model: 'gpt-4', inputTokens: 200, outputTokens: 800 },
  ],
  status: 'COMPLETED',
});

console.log(result.summary);
// Output: "Research Agent: 3 events recorded (2.5s)"
```

### Core SDK Methods

| Method | Description |
|--------|-------------|
| `ping()` | Verify API connection |
| `createCustomer(params)` | Create a customer |
| `getCustomer(customerId)` | Get customer details |
| `listCustomers(options)` | List all customers |
| `trackUsage(params)` | Record metered usage |
| `recordRun(params)` | Log complete agent run (simplified) |
| `startRun(params)` | Start execution trace |
| `emitEvent(params)` | Log event within run |
| `emitEventsBatch(params)` | Batch log events |
| `endRun(runId, params)` | Complete execution trace |
| `getRunTimeline(runId)` | Get execution timeline |

---

## Full SDK

For billing, webhooks, and advanced features, use the full SDK:

```typescript
import { Drip } from '@drip-sdk/node';

const drip = new Drip({ apiKey: process.env.DRIP_API_KEY! });

// All Core SDK methods plus:
// - charge(), getBalance(), getCharge(), listCharges()
// - createWebhook(), listWebhooks(), deleteWebhook()
// - estimateFromUsage(), estimateFromHypothetical()
// - checkout(), and more
```

## Quick Start (Full SDK)

### Track Usage

```typescript
import { Drip } from '@drip-sdk/node';

const drip = new Drip({ apiKey: process.env.DRIP_API_KEY! });

// Track any metered usage
await drip.trackUsage({
  customerId: 'cus_123',
  meter: 'api_calls',
  quantity: 1,
  metadata: { endpoint: '/v1/generate', method: 'POST' },
});

// Check accumulated usage
const balance = await drip.getBalance('cus_123');
console.log(`Total usage: $${balance.totalUsageUsd}`);
```

### Log Agent Runs (AI/Agent API)

```typescript
// Record a complete agent execution with one call
const result = await drip.recordRun({
  customerId: 'cus_123',
  workflow: 'research-agent',
  events: [
    { eventType: 'llm.call', model: 'gpt-4', inputTokens: 500, outputTokens: 1200 },
    { eventType: 'tool.call', name: 'web-search', duration: 1500 },
    { eventType: 'llm.call', model: 'gpt-4', inputTokens: 200, outputTokens: 800 },
  ],
  status: 'COMPLETED',
});

console.log(result.summary);
// Output: "Research Agent: 3 events recorded (2.5s)"
```

### View Execution Traces

```typescript
// Get detailed timeline of an agent run
const timeline = await drip.getRunTimeline(runId);

for (const event of timeline.events) {
  console.log(`${event.eventType}: ${event.duration}ms`);
}
```

## Use Cases

### RPC Providers

```typescript
// Track per-method usage with chain and latency
await drip.trackUsage({
  customerId: apiKeyOwner,
  meter: 'rpc_calls',
  quantity: 1,
  metadata: {
    method: 'eth_call',
    chain: 'ethereum',
    latencyMs: 45,
    cacheHit: false,
  },
});
```

### API Companies

```typescript
// Track API usage with endpoint attribution
await drip.trackUsage({
  customerId: 'cus_123',
  meter: 'api_calls',
  quantity: 1,
  metadata: {
    endpoint: '/v1/embeddings',
    tokens: 1500,
    model: 'text-embedding-3-small',
  },
});
```

### AI Agents

```typescript
// Track agent execution with detailed events
const run = await drip.startRun({
  customerId: 'cus_123',
  workflowSlug: 'document-processor',
});

await drip.emitEvent({
  runId: run.id,
  eventType: 'ocr.process',
  quantity: 5,
  units: 'pages',
});

await drip.emitEvent({
  runId: run.id,
  eventType: 'llm.summarize',
  model: 'gpt-4',
  inputTokens: 10000,
  outputTokens: 500,
});

await drip.endRun(run.id, { status: 'COMPLETED' });
```

## Full SDK API Reference

### Usage & Billing

| Method | Description |
|--------|-------------|
| `trackUsage(params)` | Record metered usage (no billing) |
| `charge(params)` | Create a billable charge |
| `getBalance(customerId)` | Get balance and usage summary |
| `getCharge(chargeId)` | Get charge details |
| `listCharges(options)` | List all charges |
| `getChargeStatus(chargeId)` | Get charge status |

### Execution Logging

| Method | Description |
|--------|-------------|
| `recordRun(params)` | Log complete agent run (simplified) |
| `startRun(params)` | Start execution trace |
| `emitEvent(params)` | Log event within run |
| `emitEventsBatch(params)` | Batch log events |
| `endRun(runId, params)` | Complete execution trace |
| `getRunTimeline(runId)` | Get execution timeline |
| `createWorkflow(params)` | Create a workflow |
| `listWorkflows()` | List all workflows |

### Customer Management

| Method | Description |
|--------|-------------|
| `createCustomer(params)` | Create a customer |
| `getCustomer(customerId)` | Get customer details |
| `listCustomers(options)` | List all customers |

### Webhooks

| Method | Description |
|--------|-------------|
| `createWebhook(params)` | Create webhook endpoint |
| `listWebhooks()` | List all webhooks |
| `getWebhook(webhookId)` | Get webhook details |
| `deleteWebhook(webhookId)` | Delete a webhook |
| `testWebhook(webhookId)` | Test a webhook |
| `rotateWebhookSecret(webhookId)` | Rotate webhook secret |
| `Drip.verifyWebhookSignature()` | Verify webhook signature |

### Cost Estimation

| Method | Description |
|--------|-------------|
| `estimateFromUsage(params)` | Estimate cost from usage data |
| `estimateFromHypothetical(params)` | Estimate from hypothetical usage |

### Other

| Method | Description |
|--------|-------------|
| `checkout(params)` | Create checkout session (fiat on-ramp) |
| `listMeters()` | List available meters |
| `ping()` | Verify API connection |

## Streaming Meter (LLM Token Streaming)

For LLM token streaming, accumulate usage locally and charge once:

```typescript
const meter = drip.createStreamMeter({
  customerId: 'cus_123',
  meter: 'tokens',
});

for await (const chunk of llmStream) {
  meter.add(chunk.tokens);
  yield chunk;
}

// Single API call at end
await meter.flush();
```

## Framework Middleware

### Next.js

```typescript
import { withDrip } from '@drip-sdk/node/next';

export const POST = withDrip({
  meter: 'api_calls',
  quantity: 1,
}, async (req, { customerId }) => {
  return Response.json({ result: 'success' });
});
```

### Express

```typescript
import { dripMiddleware } from '@drip-sdk/node/express';

app.use('/api', dripMiddleware({
  meter: 'api_calls',
  quantity: 1,
}));
```

## LangChain Integration

```typescript
import { DripCallbackHandler } from '@drip-sdk/node/langchain';

const handler = new DripCallbackHandler({
  drip,
  customerId: 'cus_123',
});

// Automatically tracks all LLM calls and tool usage
await agent.invoke({ input: '...' }, { callbacks: [handler] });
```

## Error Handling

```typescript
import { Drip, DripError } from '@drip-sdk/node';

try {
  await drip.trackUsage({ ... });
} catch (error) {
  if (error instanceof DripError) {
    console.error(`Error: ${error.message} (${error.code})`);
  }
}
```

## Billing (Full SDK Only)

```typescript
import { Drip } from '@drip-sdk/node';

const drip = new Drip({ apiKey: process.env.DRIP_API_KEY! });

// Create a billable charge
const result = await drip.charge({
  customerId: 'cus_123',
  meter: 'api_calls',
  quantity: 1,
});

// Get customer balance
const balance = await drip.getBalance('cus_123');
console.log(`Balance: $${balance.balanceUsdc}`);

// Query charges
const charge = await drip.getCharge(chargeId);
const charges = await drip.listCharges({ customerId: 'cus_123' });

// Cost estimation
await drip.estimateFromUsage({ customerId, startDate, endDate });
await drip.estimateFromHypothetical({ items: [...] });

// Checkout (fiat on-ramp)
await drip.checkout({ customerId: 'cus_123', amountUsd: 5000 });
```

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import type {
  Customer,
  Charge,
  ChargeResult,
  TrackUsageParams,
  RunResult,
  Webhook,
} from '@drip-sdk/node';
```

## Requirements

- Node.js 18.0.0 or higher

## Links

- [Documentation](https://docs.drippay.dev)
- [GitHub](https://github.com/MichaelLevin5908/drip)
- [npm](https://www.npmjs.com/package/@drip-sdk/node)
