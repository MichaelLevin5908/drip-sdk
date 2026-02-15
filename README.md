# Drip SDK (Node.js)

Drip is a lightweight SDK for **usage tracking and execution logging** in systems where cost is tied to computation — AI agents, APIs, background jobs, and infra workloads.

This **Core SDK** is designed for pilots: it records *what ran* and *how much it used*, without handling billing or balances.

**One line to start tracking:** `await drip.trackUsage({ customerId, meter, quantity })`

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
# Secret key — full API access (server-side only, never expose publicly)
export DRIP_API_KEY=sk_test_...

# Or public key — read/write access for usage, customers, billing (safe for client-side)
export DRIP_API_KEY=pk_test_...
```

### 3. Create a customer and track usage

```typescript
import { drip } from '@drip-sdk/node';

// Create a customer first
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

// Track usage — that's it
await drip.trackUsage({ customerId: customer.id, meter: 'api_calls', quantity: 1 });
```

The `drip` singleton reads `DRIP_API_KEY` from your environment automatically.

### Alternative: Explicit Configuration

```typescript
import { Drip } from '@drip-sdk/node';

// Auto-reads DRIP_API_KEY from environment
const drip = new Drip();

// Or pass config explicitly with a secret key (full access)
const drip = new Drip({ apiKey: 'sk_test_...' });

// Or with a public key (safe for client-side, limited scope)
const drip = new Drip({ apiKey: 'pk_test_...' });
```

### Full Example

```typescript
import { drip } from '@drip-sdk/node';

async function main() {
  // Verify connectivity
  await drip.ping();

  // Create a customer (at least one of externalCustomerId or onchainAddress required)
  const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

  // Record usage
  await drip.trackUsage({
    customerId: customer.id,
    meter: 'llm_tokens',
    quantity: 842,
    metadata: { model: 'gpt-4o-mini' },
  });

  // Record an execution lifecycle
  await drip.recordRun({
    customerId: customer.id,
    workflow: 'research-agent',
    events: [
      { eventType: 'llm.call', quantity: 1700, units: 'tokens' },
      { eventType: 'tool.call', quantity: 1 },
    ],
    status: 'COMPLETED',
  });

  console.log(`Customer ${customer.id}: usage + run recorded`);
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
| `correlationId` | Optional. Your trace/request ID for linking Drip data with your APM (OpenTelemetry, Datadog, etc.) |

**Status values:** `PENDING` | `RUNNING` | `COMPLETED` | `FAILED`

**Event schema:** Payloads are schema-flexible. Drip stores events as structured JSON and does not enforce a fixed event taxonomy.

Drip is append-only and idempotent-friendly. You can safely retry events.

> **Distributed tracing:** Pass `correlationId` to `startRun()`, `recordRun()`, or `emitEvent()` to cross-reference Drip billing with your observability stack. See [FULL_SDK.md](./FULL_SDK.md#distributed-tracing-correlationid) for details.

---

## Idempotency Keys

Every mutating SDK method (`charge`, `trackUsage`, `emitEvent`) accepts an optional `idempotencyKey` parameter. The server uses this key to deduplicate requests — if two requests share the same key, only the first is processed.

`recordRun` generates idempotency keys internally for its batch events (using `externalRunId` when provided, otherwise deterministic keys).

### Auto-generated keys (default)

When you omit `idempotencyKey`, the SDK generates one automatically. The auto key is:

- **Unique per call** — two separate calls with identical parameters produce different keys (a monotonic counter ensures this).
- **Stable across retries** — the key is generated once and reused for all retry attempts of that call, so network retries are safely deduplicated.
- **Deterministic** — no randomness; keys are reproducible for debugging.

This means you get **free retry safety** with zero configuration.

> **Note:** `wrapApiCall` generates a time-based key when no explicit `idempotencyKey` is provided. Pass your own key if you need deterministic deduplication with `wrapApiCall`.

### When to pass explicit keys

Pass your own `idempotencyKey` when you need **application-level deduplication** — e.g., to guarantee that a specific business operation is billed exactly once, even across process restarts:

```typescript
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

await drip.charge({
  customerId: customer.id,
  meter: 'api_calls',
  quantity: 1,
  idempotencyKey: `order_${orderId}_charge`, // your business-level key
});
```

Common patterns:
- `order_${orderId}` — one charge per order
- `run_${runId}_step_${stepIndex}` — one charge per pipeline step
- `invoice_${invoiceId}` — one charge per invoice

### StreamMeter

`StreamMeter` also auto-generates idempotency keys per flush. If you provide an `idempotencyKey` in the options, each flush appends a counter (`_flush_0`, `_flush_1`, etc.) to keep multi-flush scenarios safe.

---

## API Key Types

Drip issues two key types per API key pair. Each has different access scopes:

| Key Type | Prefix | Access | Use In |
|----------|--------|--------|--------|
| **Secret Key** | `sk_live_` / `sk_test_` | Full API access (all endpoints) | Server-side only |
| **Public Key** | `pk_live_` / `pk_test_` | Usage tracking, customers, billing, analytics, sessions | Client-side safe |

### What public keys **can** access
- Usage tracking (`trackUsage`, `recordRun`, `startRun`, `emitEvent`, etc.)
- Customer management (`createCustomer`, `getCustomer`, `listCustomers`)
- Billing & charges (`charge`, `getBalance`, `listCharges`, etc.)
- Pricing plans, sessions, analytics, usage caps, refunds

### What public keys **cannot** access (secret key required)
- Webhook management (`createWebhook`, `listWebhooks`, `deleteWebhook`, etc.)
- API key management (create, rotate, revoke keys)
- Feature flag management

The SDK detects your key type automatically and will throw a `DripError` with code `PUBLIC_KEY_NOT_ALLOWED` (HTTP 403) if you attempt a secret-key-only operation with a public key.

```typescript
const drip = new Drip({ apiKey: 'pk_test_...' });
console.log(drip.keyType); // 'public'

// Create a customer first, then track usage
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });
await drip.trackUsage({ customerId: customer.id, meter: 'api_calls', quantity: 1 });

// This throws DripError(403, 'PUBLIC_KEY_NOT_ALLOWED')
await drip.createWebhook({ url: '...', events: ['charge.succeeded'] });
```

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
| `getRun(runId)` | Get run details and summary |
| `getRunTimeline(runId)` | Get execution timeline |

### Creating Customers

All parameters are optional, but at least one of `externalCustomerId` or `onchainAddress` must be provided:

```typescript
// Simplest — just your internal user ID
const customer = await drip.createCustomer({ externalCustomerId: 'user_123' });

// With an on-chain address (for on-chain billing)
const customer = await drip.createCustomer({
  onchainAddress: '0x1234...',
  externalCustomerId: 'user_123',
});

// Internal/non-billing customer (for tracking only)
const customer = await drip.createCustomer({
  externalCustomerId: 'internal-team',
  isInternal: true,
});
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `externalCustomerId` | `string` | No* | Your internal user/account ID |
| `onchainAddress` | `string` | No* | Customer's Ethereum address |
| `isInternal` | `boolean` | No | Mark as internal (non-billing). Default: `false` |
| `metadata` | `object` | No | Arbitrary key-value metadata |

\*At least one of `externalCustomerId` or `onchainAddress` is required.

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
- [API Documentation](https://drippay.dev/api-reference)
- [npm](https://www.npmjs.com/package/@drip-sdk/node)
