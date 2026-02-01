# Drip SDK (Node.js)

Drip is a lightweight SDK for **usage tracking and execution logging** in systems where cost is tied to computation — AI agents, APIs, background jobs, and infra workloads.

This **Core SDK** is designed for pilots: it records *what ran* and *how much it used*, without handling billing or balances.

[![npm version](https://img.shields.io/npm/v/%40drip-sdk%2Fnode.svg)](https://www.npmjs.com/package/@drip-sdk/node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## 60-Second Quickstart (Core SDK)

### 1. Install

```bash
npm install @drip-sdk/node
```

### 2. Set your API key

```bash
export DRIP_API_KEY=sk_test_...
```

### 3. Track usage + execution

```typescript
import { Drip } from '@drip-sdk/node/core';

const drip = new Drip({ apiKey: process.env.DRIP_API_KEY! });

async function main() {
  // Verify connectivity
  await drip.ping();

  // Record usage
  await drip.trackUsage({
    customerId: 'customer_123',
    meter: 'llm_tokens',
    quantity: 842,
    metadata: { model: 'gpt-4o-mini' },
  });

  // Record an execution lifecycle
  await drip.recordRun({
    customerId: 'customer_123',
    workflow: 'research-agent',
    events: [
      { eventType: 'llm.call', model: 'gpt-4', inputTokens: 500, outputTokens: 1200 },
      { eventType: 'tool.call', name: 'web-search', duration: 1500 },
    ],
    status: 'COMPLETED',
  });

  console.log('Usage + run recorded');
}

main();
```

**Expected result:**
- No errors
- Events appear in your Drip dashboard within seconds

---

## Core Concepts (2-minute mental model)

| Concept | Description |
|---------|-------------|
| `customerId` | The end user, API key, or account you're attributing usage to |
| `meter` | What you're measuring (tokens, requests, seconds, rows, etc.) |
| `quantity` | Numeric usage for that meter |
| `run` | A single execution or request lifecycle (success / failure / duration) |

**Status values:** `PENDING` | `RUNNING` | `COMPLETED` | `FAILED`

**Event schema:** Payloads are schema-flexible. Drip stores events as structured JSON and does not enforce a fixed event taxonomy.

Drip is append-only and idempotent-friendly. You can safely retry events.

---

## SDK Variants

| Variant | Description |
|---------|-------------|
| **Core SDK** (recommended for pilots) | Usage tracking + execution logging only |
| **Full SDK** | Includes billing, balances, and workflows (for later stages) |

---

## Core SDK Methods

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

## Who This Is For

- AI agents (token metering, tool calls, execution traces)
- API companies (per-request billing, endpoint attribution)
- RPC providers (multi-chain call tracking)
- Cloud/infra (compute seconds, storage, bandwidth)

---

## Full SDK (Billing, Webhooks, Integrations)

For billing, webhooks, middleware, and advanced features:

```typescript
import { Drip } from '@drip-sdk/node';
```

See **[FULL_SDK.md](./FULL_SDK.md)** for complete documentation.

---

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

---

## Requirements

- Node.js 18.0.0 or higher

## Links

- [Full SDK Documentation](./FULL_SDK.md)
- [API Documentation](https://docs.drippay.dev)
- [GitHub](https://github.com/MichaelLevin5908/drip)
- [npm](https://www.npmjs.com/package/@drip-sdk/node)
