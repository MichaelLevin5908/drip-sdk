# @drip-sdk/node

The official Node.js SDK for **Drip** - Usage-based billing for AI agents.

Drip enables real-time, per-request billing using USDC on blockchain. Perfect for AI APIs, compute platforms, and any service with variable usage patterns.

[![npm version](https://badge.fury.io/js/@drip-sdk/node.svg)](https://www.npmjs.com/package/@drip-sdk/node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Installation

```bash
npm install @drip-sdk/node
```

```bash
yarn add @drip-sdk/node
```

```bash
pnpm add @drip-sdk/node
```

## Quick Start

### One-Liner Integration (Recommended)

The fastest way to add billing to your API:

#### Next.js App Router

```typescript
// app/api/generate/route.ts
import { withDrip } from '@drip-sdk/node/next';

export const POST = withDrip({
  meter: 'api_calls',
  quantity: 1,
}, async (req, { charge, customerId }) => {
  // Your handler - payment already verified!
  console.log(`Charged ${charge.charge.amountUsdc} USDC to ${customerId}`);
  return Response.json({ result: 'success' });
});
```

#### Express

```typescript
import express from 'express';
import { dripMiddleware } from '@drip-sdk/node/express';

const app = express();

app.use('/api/paid', dripMiddleware({
  meter: 'api_calls',
  quantity: 1,
}));

app.post('/api/paid/generate', (req, res) => {
  console.log(`Charged: ${req.drip.charge.charge.amountUsdc} USDC`);
  res.json({ success: true });
});
```

### Manual Integration

For more control, use the SDK directly:

```typescript
import { Drip } from '@drip-sdk/node';

// Initialize the client
const drip = new Drip({
  apiKey: process.env.DRIP_API_KEY!,
});

// Create a customer
const customer = await drip.createCustomer({
  onchainAddress: '0x1234567890abcdef...',
  externalCustomerId: 'user_123',
});

// Record usage and charge
const result = await drip.charge({
  customerId: customer.id,
  meter: 'api_calls',
  quantity: 100,
});

console.log(`Charged ${result.charge.amountUsdc} USDC`);
console.log(`TX: ${result.charge.txHash}`);
```

## Configuration

```typescript
const drip = new Drip({
  // Required: Your Drip API key
  apiKey: 'drip_live_abc123...',

  // Optional: API base URL (for staging/development)
  baseUrl: 'https://api.drip.dev/v1',

  // Optional: Request timeout in milliseconds (default: 30000)
  timeout: 30000,
});
```

## API Reference

### Customer Management

#### Create a Customer

```typescript
const customer = await drip.createCustomer({
  onchainAddress: '0x1234567890abcdef...',
  externalCustomerId: 'user_123', // Your internal user ID
  metadata: { plan: 'pro' },
});
```

#### Get a Customer

```typescript
const customer = await drip.getCustomer('cust_abc123');
```

#### List Customers

```typescript
// List all customers
const { data: customers } = await drip.listCustomers();

// With filters
const { data: activeCustomers } = await drip.listCustomers({
  status: 'ACTIVE',
  limit: 50,
});
```

#### Get Customer Balance

```typescript
const balance = await drip.getBalance('cust_abc123');
console.log(`Balance: ${balance.balanceUSDC} USDC`);
```

### Meters (Usage Types)

#### List Available Meters

Discover what meter names are valid for charging. Meters are defined by your pricing plans.

```typescript
const { data: meters } = await drip.listMeters();

console.log('Available meters:');
for (const meter of meters) {
  console.log(`  ${meter.meter}: $${meter.unitPriceUsd}/unit`);
}
// Output:
//   api_calls: $0.001/unit
//   tokens: $0.00001/unit
//   compute_seconds: $0.01/unit
```

### Charging & Usage

#### Record Usage and Charge

```typescript
const result = await drip.charge({
  customerId: 'cust_abc123',
  meter: 'api_calls',
  quantity: 100,
  idempotencyKey: 'req_unique_123', // Prevents duplicate charges
  metadata: { endpoint: '/v1/chat' },
});

if (result.success) {
  console.log(`Charge ID: ${result.charge.id}`);
  console.log(`Amount: ${result.charge.amountUsdc} USDC`);
  console.log(`TX Hash: ${result.charge.txHash}`);
}
```

#### Get Charge Details

```typescript
const charge = await drip.getCharge('chg_abc123');
console.log(`Status: ${charge.status}`);
```

#### List Charges

```typescript
// List all charges
const { data: charges } = await drip.listCharges();

// Filter by customer and status
const { data: customerCharges } = await drip.listCharges({
  customerId: 'cust_abc123',
  status: 'CONFIRMED',
  limit: 50,
});
```

#### Check Charge Status

```typescript
const status = await drip.getChargeStatus('chg_abc123');
if (status.status === 'CONFIRMED') {
  console.log('Charge confirmed on-chain!');
}
```

### Run Tracking (Simplified API)

Track agent executions with a single API call instead of multiple separate calls.

#### Record a Complete Run

The `recordRun()` method combines workflow creation, run tracking, event emission, and completion into one call:

```typescript
// Before: 4+ separate API calls
const workflow = await drip.createWorkflow({ name: 'My Agent', slug: 'my_agent' });
const run = await drip.startRun({ customerId, workflowId: workflow.id });
await drip.emitEvent({ runId: run.id, eventType: 'step1', ... });
await drip.emitEvent({ runId: run.id, eventType: 'step2', ... });
await drip.endRun(run.id, { status: 'COMPLETED' });

// After: 1 call with recordRun()
const result = await drip.recordRun({
  customerId: 'cust_123',
  workflow: 'my_agent',  // Auto-creates workflow if it doesn't exist
  events: [
    { eventType: 'agent.start', description: 'Started processing' },
    { eventType: 'tool.ocr', quantity: 3, units: 'pages', costUnits: 0.15 },
    { eventType: 'tool.validate', quantity: 1, costUnits: 0.05 },
    { eventType: 'agent.complete', description: 'Finished successfully' },
  ],
  status: 'COMPLETED',
});

console.log(result.summary);
// Output: "✓ My Agent: 4 events recorded (250ms)"
```

#### Record a Failed Run

```typescript
const result = await drip.recordRun({
  customerId: 'cust_123',
  workflow: 'prescription_intake',
  events: [
    { eventType: 'agent.start', description: 'Started processing' },
    { eventType: 'error', description: 'OCR failed: image too blurry' },
  ],
  status: 'FAILED',
  errorMessage: 'OCR processing failed',
  errorCode: 'OCR_QUALITY_ERROR',
});

console.log(result.summary);
// Output: "✗ Prescription Intake: 2 events recorded (150ms)"
```

### Webhooks

#### Create a Webhook

```typescript
const webhook = await drip.createWebhook({
  url: 'https://api.yourapp.com/webhooks/drip',
  events: ['charge.succeeded', 'charge.failed', 'customer.balance.low'],
  description: 'Main webhook endpoint',
});

// IMPORTANT: Save the secret securely!
console.log(`Webhook secret: ${webhook.secret}`);
```

#### List Webhooks

```typescript
const { data: webhooks } = await drip.listWebhooks();
webhooks.forEach((wh) => {
  console.log(`${wh.url}: ${wh.stats?.successfulDeliveries} successful`);
});
```

#### Delete a Webhook

```typescript
await drip.deleteWebhook('wh_abc123');
```

#### Verify Webhook Signatures

```typescript
import express from 'express';
import { Drip } from '@drip-sdk/node';

const app = express();

app.post(
  '/webhooks/drip',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const isValid = Drip.verifyWebhookSignature(
      req.body.toString(),
      req.headers['x-drip-signature'] as string,
      process.env.DRIP_WEBHOOK_SECRET!,
    );

    if (!isValid) {
      return res.status(401).send('Invalid signature');
    }

    const event = JSON.parse(req.body.toString());

    switch (event.type) {
      case 'charge.succeeded':
        console.log('Charge succeeded:', event.data.charge_id);
        break;
      case 'charge.failed':
        console.log('Charge failed:', event.data.failure_reason);
        break;
      case 'customer.balance.low':
        console.log('Low balance alert for:', event.data.customer_id);
        break;
    }

    res.status(200).send('OK');
  },
);
```

### Available Webhook Events

| Event                        | Description                          |
| ---------------------------- | ------------------------------------ |
| `charge.succeeded`           | Charge confirmed on-chain            |
| `charge.failed`              | Charge failed                        |
| `customer.balance.low`       | Customer balance below threshold     |
| `customer.deposit.confirmed` | Deposit confirmed on-chain           |
| `customer.withdraw.confirmed`| Withdrawal confirmed                 |
| `customer.usage_cap.reached` | Usage cap hit                        |
| `customer.created`           | New customer created                 |
| `usage.recorded`             | Usage event recorded                 |
| `transaction.created`        | Transaction initiated                |
| `transaction.confirmed`      | Transaction confirmed on-chain       |
| `transaction.failed`         | Transaction failed                   |

## TypeScript Usage

The SDK is written in TypeScript and includes full type definitions.

```typescript
import {
  Drip,
  DripConfig,
  DripError,
  Customer,
  Charge,
  ChargeResult,
  ChargeStatus,
  Webhook,
  WebhookEventType,
} from '@drip-sdk/node';

// All types are available for use
const config: DripConfig = {
  apiKey: process.env.DRIP_API_KEY!,
};

const drip = new Drip(config);

// Type-safe responses
const customer: Customer = await drip.getCustomer('cust_abc123');
const result: ChargeResult = await drip.charge({
  customerId: customer.id,
  meter: 'api_calls',
  quantity: 100,
});
```

## Error Handling

The SDK throws `DripError` for API errors:

```typescript
import { Drip, DripError } from '@drip-sdk/node';

try {
  const result = await drip.charge({
    customerId: 'cust_abc123',
    meter: 'api_calls',
    quantity: 100,
  });
} catch (error) {
  if (error instanceof DripError) {
    console.error(`API Error: ${error.message}`);
    console.error(`Status Code: ${error.statusCode}`);
    console.error(`Error Code: ${error.code}`);

    switch (error.code) {
      case 'INSUFFICIENT_BALANCE':
        // Handle low balance
        break;
      case 'CUSTOMER_NOT_FOUND':
        // Handle missing customer
        break;
      case 'RATE_LIMITED':
        // Handle rate limiting
        break;
    }
  }
}
```

### Common Error Codes

| Code                   | Description                              |
| ---------------------- | ---------------------------------------- |
| `INSUFFICIENT_BALANCE` | Customer doesn't have enough balance     |
| `CUSTOMER_NOT_FOUND`   | Customer ID doesn't exist                |
| `DUPLICATE_CUSTOMER`   | Customer already exists                  |
| `INVALID_API_KEY`      | API key is invalid or revoked            |
| `RATE_LIMITED`         | Too many requests                        |
| `TIMEOUT`              | Request timed out                        |

## Idempotency

Use idempotency keys to safely retry requests:

```typescript
const result = await drip.charge({
  customerId: 'cust_abc123',
  meter: 'api_calls',
  quantity: 100,
  idempotencyKey: `req_${requestId}`, // Unique per request
});

// Retrying with the same key returns the original result
const retry = await drip.charge({
  customerId: 'cust_abc123',
  meter: 'api_calls',
  quantity: 100,
  idempotencyKey: `req_${requestId}`, // Same key = same result
});
```

## CommonJS Usage

The SDK supports both ESM and CommonJS:

```javascript
// ESM
import { Drip } from '@drip-sdk/node';

// CommonJS
const { Drip } = require('@drip-sdk/node');
```

## Requirements

- Node.js 18.0.0 or higher
- Native `fetch` support (included in Node.js 18+)

## Middleware Reference (withDrip)

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `meter` | `string` | **required** | Usage meter to charge (must match pricing plan) |
| `quantity` | `number \| (req) => number` | **required** | Quantity to charge (static or dynamic) |
| `apiKey` | `string` | `DRIP_API_KEY` | Drip API key |
| `baseUrl` | `string` | `DRIP_API_URL` | Drip API base URL |
| `customerResolver` | `'header' \| 'query' \| function` | `'header'` | How to identify customers |
| `skipInDevelopment` | `boolean` | `false` | Skip charging in dev mode |
| `metadata` | `object \| function` | `undefined` | Custom metadata for charges |
| `onCharge` | `function` | `undefined` | Callback after successful charge |
| `onError` | `function` | `undefined` | Custom error handler |

### How It Works

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Your API      │    │   withDrip       │    │   Drip Backend  │
│   (Next/Express)│───▶│   Middleware     │───▶│   API           │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                      │                       │
         ▼                      ▼                       ▼
    1. Request            2. Resolve             3. Check balance
       arrives               customer               & charge
         │                      │                       │
         ▼                      ▼                       ▼
    6. Response           5. Pass to             4. Return result
       returned              handler                or 402
```

### x402 Payment Flow

When a customer has insufficient balance, the middleware returns `402 Payment Required`:

```
HTTP/1.1 402 Payment Required
X-Payment-Required: true
X-Payment-Amount: 0.01
X-Payment-Recipient: 0x...
X-Payment-Usage-Id: 0x...
X-Payment-Expires: 1704110400
X-Payment-Nonce: abc123

{
  "error": "Payment required",
  "code": "PAYMENT_REQUIRED",
  "paymentRequest": { ... },
  "instructions": {
    "step1": "Sign the payment request with your session key using EIP-712",
    "step2": "Retry the request with X-Payment-* headers"
  }
}
```

### Advanced Usage

#### Dynamic Quantity

```typescript
export const POST = withDrip({
  meter: 'tokens',
  quantity: async (req) => {
    const body = await req.json();
    return body.maxTokens ?? 100;
  },
}, handler);
```

#### Custom Customer Resolution

```typescript
export const POST = withDrip({
  meter: 'api_calls',
  quantity: 1,
  customerResolver: (req) => {
    const token = req.headers.get('authorization')?.split(' ')[1];
    return decodeJWT(token).customerId;
  },
}, handler);
```

#### Factory Pattern

```typescript
// lib/drip.ts
import { createWithDrip } from '@drip-sdk/node/next';

export const withDrip = createWithDrip({
  apiKey: process.env.DRIP_API_KEY,
  baseUrl: process.env.DRIP_API_URL,
});

// app/api/generate/route.ts
import { withDrip } from '@/lib/drip';
export const POST = withDrip({ meter: 'api_calls', quantity: 1 }, handler);
```

### What's Included vs. Missing

| Feature | Status | Description |
|---------|--------|-------------|
| Next.js App Router | ✅ | `withDrip` wrapper |
| Express Middleware | ✅ | `dripMiddleware` |
| x402 Payment Flow | ✅ | Automatic 402 handling |
| Dynamic Quantity | ✅ | Function-based pricing |
| Customer Resolution | ✅ | Header, query, or custom |
| Idempotency | ✅ | Built-in or custom keys |
| Dev Mode Skip | ✅ | Skip in development |
| Metadata | ✅ | Attach to charges |
| TypeScript | ✅ | Full type definitions |
| Fastify Adapter | ❌ | Coming soon |
| Rate Limiting | ❌ | Planned |
| Balance Caching | ❌ | Planned |

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](./LICENSE)

## Links

- [GitHub Repository](https://github.com/MichaelLevin5908/drip-sdk)
- [Issue Tracker](https://github.com/MichaelLevin5908/drip-sdk/issues)
- [npm Package](https://www.npmjs.com/package/@drip-sdk/node)
- [Documentation](https://docs.drip.dev)
