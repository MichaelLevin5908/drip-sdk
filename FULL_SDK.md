# Drip SDK (Node.js) — Full SDK Reference

This document covers billing, webhooks, and advanced features. For usage tracking and execution logging, see the main [README](./README.md).

---

## Contents

- [Installation](#installation)
- [Billing Lifecycle](#billing-lifecycle)
- [Quick Start](#quick-start)
- [Use Cases](#use-cases)
- [API Reference](#api-reference)
- [Streaming Meter](#streaming-meter-llm-token-streaming)
- [Framework Middleware](#framework-middleware)
- [LangChain Integration](#langchain-integration)
- [Webhooks](#webhooks)
- [Error Handling](#error-handling)
- [Gotchas](#gotchas)

---

## Installation

```bash
npm install @drip-sdk/node
```

```typescript
import { Drip } from '@drip-sdk/node';

// Secret key — full access (server-side only)
const drip = new Drip({ apiKey: 'sk_live_...' });

// Public key — usage, customers, billing (safe for client-side)
const drip = new Drip({ apiKey: 'pk_live_...' });
```

> **Key type detection:** The SDK auto-detects your key type from the prefix. Check `drip.keyType` to see if you're using a `'secret'`, `'public'`, or `'unknown'` key. Secret-key-only methods (webhooks, API key management, feature flags) will throw `DripError(403, 'PUBLIC_KEY_NOT_ALLOWED')` if called with a public key.

---

## Billing Lifecycle

Understanding `trackUsage` vs `charge`:

| Method | What it does |
|--------|--------------|
| `trackUsage()` | Logs usage to the ledger (no billing) |
| `charge()` | Converts usage into a billable charge |

**Typical flow:**

1. `trackUsage()` throughout the day/request stream
2. Optionally `estimateFromUsage()` to preview cost
3. `charge()` to create billable charges
4. `getBalance()` / `listCharges()` for reconciliation
5. Webhooks for `charge.succeeded` / `charge.failed`

> Most pilots start with `trackUsage()` only. Add `charge()` when you're ready to bill.

---

## Quick Start

### Create a Customer + Track Usage

```typescript
// Create a customer first (at least one of externalCustomerId or onchainAddress required)
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

// Track metered usage (logs to ledger, no billing)
await drip.trackUsage({
  customerId: customer.id,
  meter: 'api_calls',
  quantity: 1,
  metadata: { endpoint: '/v1/generate', method: 'POST' },
});

// Check accumulated usage
const balance = await drip.getBalance(customer.id);
console.log(`Balance: $${balance.balanceUsdc}`);
```

### Log Agent Runs

```typescript
const result = await drip.recordRun({
  customerId: customer.id,
  workflow: 'research-agent',
  events: [
    { eventType: 'llm.call', quantity: 1700, units: 'tokens' },
    { eventType: 'tool.call', quantity: 1 },
    { eventType: 'llm.call', quantity: 1000, units: 'tokens' },
  ],
  status: 'COMPLETED',
});

console.log(result.summary);
// Output: "Research Agent: 3 events recorded (2.5s)"
```

### View Execution Traces

```typescript
// Assume: runId from a previous startRun() or recordRun()
const runId = 'run_abc123';

const timeline = await drip.getRunTimeline(runId);

for (const event of timeline.events) {
  console.log(`${event.eventType}: ${event.duration}ms`);
}
```

---

## Use Cases

### RPC Providers

```typescript
// Create a customer for the API key owner
const apiKeyOwner = await drip.createCustomer({ externalCustomerId: 'rpc_user_123' });

await drip.trackUsage({
  customerId: apiKeyOwner.id,
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
const customer = await drip.createCustomer({ externalCustomerId: 'api_user_123' });

await drip.trackUsage({
  customerId: customer.id,
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
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

const run = await drip.startRun({
  customerId: customer.id,
  workflowId: 'document-processor',
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
  quantity: 10500,
  units: 'tokens',
  metadata: { model: 'gpt-4', inputTokens: 10000, outputTokens: 500 },
});

await drip.endRun(run.id, { status: 'COMPLETED' });
```

### Distributed Tracing (correlationId)

Pass a `correlationId` to link Drip runs with your existing observability tools (OpenTelemetry, Datadog, etc.):

```typescript
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

const run = await drip.startRun({
  customerId: customer.id,
  workflowId: 'document-processor',
  correlationId: span.spanContext().traceId, // OpenTelemetry trace ID
});

// Or with recordRun:
await drip.recordRun({
  customerId: customer.id,
  workflow: 'research-agent',
  correlationId: 'trace_abc123',
  events: [
    { eventType: 'llm.call', quantity: 1700, units: 'tokens' },
  ],
  status: 'COMPLETED',
});
```

**Key points:**
- `correlationId` is **user-supplied**, not auto-generated — you provide your own trace/request ID
- It's **optional** — skip it if you don't use distributed tracing
- Use it to cross-reference Drip billing data with traces in your APM dashboard
- Common values: OpenTelemetry `traceId`, Datadog `trace_id`, or your own `requestId`
- Visible in the Drip dashboard timeline and available via `getRunTimeline()`

Events also accept a `correlationId` for even finer-grained linking:

```typescript
await drip.emitEvent({
  runId: run.id,
  eventType: 'llm.call',
  quantity: 1700,
  units: 'tokens',
  correlationId: span.spanContext().spanId, // Link to a specific span
});
```

---

## API Reference

### Usage & Billing

| Method | Description |
|--------|-------------|
| `trackUsage(params)` | Log usage to ledger (no billing) |
| `charge(params)` | Create a billable charge |
| `wrapApiCall(params)` | Wrap external API call with guaranteed usage recording |
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
| `getRun(runId)` | Get run details |
| `getRunTimeline(runId)` | Get execution timeline |
| `createWorkflow(params)` | Create a workflow |
| `listWorkflows()` | List all workflows |

### Customer Management

| Method | Description |
|--------|-------------|
| `createCustomer(params)` | Create a customer |
| `getCustomer(customerId)` | Get customer details |
| `listCustomers(options)` | List all customers |

### Webhooks (Secret Key Only)

All webhook management methods require a **secret key (`sk_`)**. Using a public key throws `DripError(403)`.

| Method | Description |
|--------|-------------|
| `createWebhook(params)` | Create webhook endpoint |
| `listWebhooks()` | List all webhooks |
| `getWebhook(webhookId)` | Get webhook details |
| `deleteWebhook(webhookId)` | Delete a webhook |
| `testWebhook(webhookId)` | Test a webhook |
| `rotateWebhookSecret(webhookId)` | Rotate webhook secret |
| `Drip.verifyWebhookSignature()` | Verify webhook signature (static, no key needed) |

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

---

## Streaming Meter (LLM Token Streaming)

For LLM token streaming, accumulate usage locally and flush once:

```typescript
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

const meter = drip.createStreamMeter({
  customerId: customer.id,
  meter: 'tokens',
});

for await (const chunk of llmStream) {
  meter.add(chunk.tokens);
  yield chunk;
}

// Single API call at end
await meter.flush();
```

---

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

---

## LangChain Integration

```typescript
import { DripCallbackHandler } from '@drip-sdk/node/langchain';

// Create a customer first
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

const handler = new DripCallbackHandler({
  drip,
  customerId: customer.id,
});

// Automatically tracks all LLM calls and tool usage
await agent.invoke({ input: '...' }, { callbacks: [handler] });
```

---

## Webhooks

> **Secret key required.** All webhook management methods require an `sk_` key. Public keys (`pk_`) will receive a `DripError` with code `PUBLIC_KEY_NOT_ALLOWED` (HTTP 403).

```typescript
// Must use a secret key for webhook management
const drip = new Drip({ apiKey: 'sk_live_...' });

// Create webhook
const webhook = await drip.createWebhook({
  url: 'https://yourapp.com/webhooks/drip',
  events: ['charge.succeeded', 'charge.failed', 'customer.balance.low'],
});
// IMPORTANT: Store webhook.secret securely!

// Verify incoming webhook (static method, no key needed)
import { Drip } from '@drip-sdk/node';

const isValid = Drip.verifyWebhookSignature({
  payload: request.body,
  signature: request.headers['x-drip-signature'],
  secret: webhookSecret,
});
```

---

## Billing

```typescript
// Create a customer first
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

// Create a billable charge
const result = await drip.charge({
  customerId: customer.id,
  meter: 'api_calls',
  quantity: 1,
});

// Get customer balance
const balance = await drip.getBalance(customer.id);
console.log(`Balance: $${balance.balanceUsdc}`);

// Query charges
const charge = await drip.getCharge(result.charge.id);
const charges = await drip.listCharges({ customerId: customer.id });

// Cost estimation from actual usage
const startDate = new Date('2024-01-01');
const endDate = new Date('2024-01-31');
await drip.estimateFromUsage({ customerId: customer.id, startDate, endDate });

// Cost estimation from hypothetical usage (no real data needed)
const estimate = await drip.estimateFromHypothetical({
  items: [
    { usageType: 'api_calls', quantity: 1000 },
    { usageType: 'tokens', quantity: 50000 },
  ],
});
console.log(`Estimated cost: $${estimate.estimatedTotalUsdc}`);

// Wrap external API call with guaranteed usage recording
const result = await drip.wrapApiCall({
  customerId: 'customer_123',
  meter: 'tokens',
  call: async () => openai.chat.completions.create({ model: 'gpt-4', messages }),
  extractUsage: (response) => response.usage.total_tokens,
});
// result.result = the API response, result.charge = the Drip charge

// Checkout (fiat on-ramp)
await drip.checkout({ customerId: customer.id, amountUsd: 5000 });
```

---

## Error Handling

```typescript
import { Drip, DripError } from '@drip-sdk/node';

const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

try {
  await drip.charge({
    customerId: customer.id,
    meter: 'api_calls',
    quantity: 1,
  });
} catch (error) {
  if (error instanceof DripError) {
    console.error(`Error: ${error.message} (${error.code})`);

    // Handle public key access errors
    if (error.code === 'PUBLIC_KEY_NOT_ALLOWED') {
      console.error('This operation requires a secret key (sk_)');
    }
  }
}
```

---

## Gotchas

### Idempotency

Use idempotency keys to prevent duplicate charges on retries:

```typescript
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

await drip.charge({
  customerId: customer.id,
  meter: 'api_calls',
  quantity: 1,
  idempotencyKey: 'req_abc123_step_1',
});
```

### Public Key Restrictions

Public keys (`pk_`) cannot access webhook, API key, or feature flag management endpoints. If you see `PUBLIC_KEY_NOT_ALLOWED` (403), switch to a secret key (`sk_`):

```typescript
// Wrong — public keys can't manage webhooks
const drip = new Drip({ apiKey: 'pk_live_...' });
await drip.createWebhook({ ... }); // Throws DripError(403)

// Right — use a secret key for admin operations
const drip = new Drip({ apiKey: 'sk_live_...' });
await drip.createWebhook({ ... }); // Works
```

### Rate Limits

If you hit 429, back off and retry. The SDK handles this automatically with exponential backoff.

### trackUsage vs charge

- `trackUsage()` = logging (free, no balance impact)
- `charge()` = billing (deducts from balance)

Start with `trackUsage()` during pilots. Add `charge()` when ready to bill.

---

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

---

## Requirements

- Node.js 18.0.0 or higher

## Links

- [Core SDK (README)](./README.md)
- [API Documentation](https://docs.drippay.dev)
- [GitHub](https://github.com/MichaelLevin5908/drip)
- [npm](https://www.npmjs.com/package/@drip-sdk/node)
