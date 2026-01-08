/**
 * Next.js Adapter Tests
 *
 * Tests for the withDrip wrapper for Next.js App Router.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withDrip, createWithDrip, hasPaymentProofHeaders } from '../next.js';
import type { NextRequest } from '../next.js';

// Mock the Drip class
vi.mock('../../index.js', () => ({
  Drip: vi.fn().mockImplementation(() => ({
    charge: vi.fn().mockResolvedValue({
      success: true,
      usageEventId: 'usage_123',
      charge: {
        id: 'chg_123',
        amountUsdc: '0.01',
        amountToken: '10000',
        txHash: '0xabc',
        status: 'CONFIRMED',
      },
    }),
  })),
  DripError: class DripError extends Error {
    constructor(
      message: string,
      public statusCode: number,
      public code?: string,
    ) {
      super(message);
    }
  },
}));

/**
 * Create a mock Next.js request.
 */
function createMockRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  searchParams?: Record<string, string>;
}): NextRequest {
  const headers = new Headers(options.headers ?? {});
  const searchParams = new URLSearchParams(options.searchParams ?? {});

  return {
    method: options.method ?? 'POST',
    url: options.url ?? 'http://localhost/api/test',
    headers,
    nextUrl: { searchParams },
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(''),
    clone: vi.fn().mockReturnThis(),
  };
}

describe('withDrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DRIP_API_KEY = 'test_api_key';
  });

  it('should wrap handler and pass context on success', async () => {
    const handler = vi.fn().mockImplementation(async (_req, ctx) => {
      return Response.json({
        customerId: ctx.customerId,
        chargeId: ctx.charge.charge.id,
      });
    });

    const wrappedHandler = withDrip(
      {
        meter: 'api_calls',
        quantity: 1,
      },
      handler,
    );

    const request = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_test123',
      },
    });

    const response = await wrappedHandler(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.customerId).toBe('cust_test123');
    expect(body.chargeId).toBe('chg_123');
    expect(handler).toHaveBeenCalledOnce();
  });

  it('should return 400 when customer ID missing', async () => {
    const handler = vi.fn();

    const wrappedHandler = withDrip(
      {
        meter: 'api_calls',
        quantity: 1,
      },
      handler,
    );

    const request = createMockRequest({});

    const response = await wrappedHandler(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('CUSTOMER_RESOLUTION_FAILED');
    expect(handler).not.toHaveBeenCalled();
  });

  it('should support dynamic quantity from request', async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }));

    const wrappedHandler = withDrip(
      {
        meter: 'tokens',
        quantity: (req) => {
          const count = req.headers.get('x-token-count');
          return count ? parseInt(count, 10) : 1;
        },
      },
      handler,
    );

    const request = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
        'x-token-count': '500',
      },
    });

    await wrappedHandler(request);

    expect(handler).toHaveBeenCalled();
  });

  it('should support customer resolution from query', async () => {
    const handler = vi.fn().mockImplementation(async (_req, ctx) => {
      return Response.json({ customerId: ctx.customerId });
    });

    const wrappedHandler = withDrip(
      {
        meter: 'api_calls',
        quantity: 1,
        customerResolver: 'query',
      },
      handler,
    );

    const request = createMockRequest({
      searchParams: {
        drip_customer_id: 'cust_from_query',
      },
    });

    const response = await wrappedHandler(request);
    const body = await response.json();

    expect(body.customerId).toBe('cust_from_query');
  });

  it('should support custom customer resolver function', async () => {
    const handler = vi.fn().mockImplementation(async (_req, ctx) => {
      return Response.json({ customerId: ctx.customerId });
    });

    const wrappedHandler = withDrip(
      {
        meter: 'api_calls',
        quantity: 1,
        customerResolver: (req) => {
          const auth = req.headers.get('authorization');
          return auth?.replace('Bearer ', '') ?? 'unknown';
        },
      },
      handler,
    );

    const request = createMockRequest({
      headers: {
        authorization: 'Bearer cust_custom_resolved',
      },
    });

    const response = await wrappedHandler(request);
    const body = await response.json();

    expect(body.customerId).toBe('cust_custom_resolved');
  });

  it('should pass route params to handler', async () => {
    const handler = vi.fn().mockImplementation(async (_req, ctx) => {
      return Response.json({ id: ctx.params?.id });
    });

    const wrappedHandler = withDrip(
      {
        meter: 'api_calls',
        quantity: 1,
      },
      handler,
    );

    const request = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
      },
    });

    const response = await wrappedHandler(request, { params: { id: 'abc123' } });
    const body = await response.json();

    expect(body.id).toBe('abc123');
  });

  it('should call onCharge callback on successful charge', async () => {
    const onCharge = vi.fn();
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }));

    const wrappedHandler = withDrip(
      {
        meter: 'api_calls',
        quantity: 1,
        onCharge,
      },
      handler,
    );

    const request = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
      },
    });

    await wrappedHandler(request);

    expect(onCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        charge: expect.objectContaining({ id: 'chg_123' }),
      }),
      request,
    );
  });

  it('should skip charging in development when configured', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const handler = vi.fn().mockImplementation(async (_req, ctx) => {
      return Response.json({
        customerId: ctx.customerId,
        chargeId: ctx.charge.charge.id,
      });
    });

    const wrappedHandler = withDrip(
      {
        meter: 'api_calls',
        quantity: 1,
        skipInDevelopment: true,
      },
      handler,
    );

    const request = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
      },
    });

    const response = await wrappedHandler(request);
    const body = await response.json();

    expect(body.customerId).toBe('dev_customer');
    expect(body.chargeId).toBe('dev_charge');

    process.env.NODE_ENV = originalEnv;
  });
});

describe('createWithDrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DRIP_API_KEY = 'test_api_key';
  });

  it('should create a withDrip with default configuration', async () => {
    const customWithDrip = createWithDrip({
      apiKey: 'custom_key',
      baseUrl: 'https://custom.api.drip.dev',
    });

    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }));

    const wrappedHandler = customWithDrip(
      {
        meter: 'api_calls',
        quantity: 1,
      },
      handler,
    );

    const request = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
      },
    });

    await wrappedHandler(request);

    expect(handler).toHaveBeenCalled();
  });
});

describe('hasPaymentProofHeaders', () => {
  it('should return true when all payment headers present', () => {
    const request = createMockRequest({
      headers: {
        'x-payment-signature': '0xsig',
        'x-payment-session-key': '0xkey',
        'x-payment-smart-account': '0xaccount',
        'x-payment-timestamp': '1234567890',
        'x-payment-amount': '1.00',
        'x-payment-recipient': '0xrecipient',
        'x-payment-usage-id': '0xusage',
        'x-payment-nonce': 'nonce',
      },
    });

    expect(hasPaymentProofHeaders(request)).toBe(true);
  });

  it('should return false when payment headers missing', () => {
    const request = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
      },
    });

    expect(hasPaymentProofHeaders(request)).toBe(false);
  });
});
