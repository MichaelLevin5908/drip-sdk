/**
 * Express Adapter Tests
 *
 * Tests for the dripMiddleware for Express.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  dripMiddleware,
  createDripMiddleware,
  hasDripContext,
  getDripContext,
} from '../express.js';
import type { ExpressRequest, ExpressResponse, DripExpressRequest } from '../express.js';

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
 * Create a mock Express request.
 */
function createMockRequest(options: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  params?: Record<string, string>;
  body?: unknown;
}): ExpressRequest {
  return {
    method: options.method ?? 'POST',
    url: options.url ?? '/api/test',
    originalUrl: options.url ?? '/api/test',
    path: options.url ?? '/api/test',
    headers: options.headers ?? {},
    query: options.query ?? {},
    params: options.params ?? {},
    body: options.body,
  };
}

/**
 * Create a mock Express response.
 */
function createMockResponse(): ExpressResponse & {
  _status: number;
  _headers: Record<string, string>;
  _body: unknown;
} {
  const res: ExpressResponse & {
    _status: number;
    _headers: Record<string, string>;
    _body: unknown;
  } = {
    _status: 200,
    _headers: {},
    _body: null,
    status(code: number) {
      this._status = code;
      return this;
    },
    set(headers: Record<string, string>) {
      this._headers = { ...this._headers, ...headers };
      return this;
    },
    json(body: unknown) {
      this._body = body;
    },
    send(body: unknown) {
      this._body = body;
    },
  };
  return res;
}

describe('dripMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DRIP_API_KEY = 'test_api_key';
  });

  it('should call next() and attach drip context on success', async () => {
    const middleware = dripMiddleware({
      meter: 'api_calls',
      quantity: 1,
    });

    const req = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect((req as DripExpressRequest).drip).toBeDefined();
    expect((req as DripExpressRequest).drip.customerId).toBe('cust_123');
    expect((req as DripExpressRequest).drip.charge.charge.id).toBe('chg_123');
  });

  it('should return 400 when customer ID missing', async () => {
    const middleware = dripMiddleware({
      meter: 'api_calls',
      quantity: 1,
    });

    const req = createMockRequest({});
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(400);
    expect(res._body).toEqual(
      expect.objectContaining({
        code: 'CUSTOMER_RESOLUTION_FAILED',
      }),
    );
  });

  it('should support dynamic quantity from request', async () => {
    const middleware = dripMiddleware({
      meter: 'tokens',
      quantity: (req) => parseInt(req.headers['x-token-count'] as string, 10) || 1,
    });

    const req = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
        'x-token-count': '250',
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('should support customer resolution from query', async () => {
    const middleware = dripMiddleware({
      meter: 'api_calls',
      quantity: 1,
      customerResolver: 'query',
    });

    const req = createMockRequest({
      query: {
        drip_customer_id: 'cust_from_query',
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as DripExpressRequest).drip.customerId).toBe('cust_from_query');
  });

  it('should not attach context when attachToRequest is false', async () => {
    const middleware = dripMiddleware({
      meter: 'api_calls',
      quantity: 1,
      attachToRequest: false,
    });

    const req = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as DripExpressRequest).drip).toBeUndefined();
  });

  it('should call custom error handler', async () => {
    const errorHandler = vi.fn().mockReturnValue(true);

    const middleware = dripMiddleware({
      meter: 'api_calls',
      quantity: 1,
      errorHandler,
    });

    const req = createMockRequest({});
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(errorHandler).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('should skip charging in development when configured', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const middleware = dripMiddleware({
      meter: 'api_calls',
      quantity: 1,
      skipInDevelopment: true,
    });

    const req = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect((req as DripExpressRequest).drip.customerId).toBe('dev_customer');

    process.env.NODE_ENV = originalEnv;
  });
});

describe('createDripMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DRIP_API_KEY = 'test_api_key';
  });

  it('should create middleware with default configuration', async () => {
    const drip = createDripMiddleware({
      apiKey: 'custom_key',
    });

    const middleware = drip({
      meter: 'api_calls',
      quantity: 1,
    });

    const req = createMockRequest({
      headers: {
        'x-drip-customer-id': 'cust_123',
      },
    });
    const res = createMockResponse();
    const next = vi.fn();

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('hasDripContext', () => {
  it('should return true when drip context present', () => {
    const req = createMockRequest({}) as DripExpressRequest;
    req.drip = {
      drip: {} as DripExpressRequest['drip']['drip'],
      customerId: 'cust_123',
      charge: {} as DripExpressRequest['drip']['charge'],
      isReplay: false,
    };

    expect(hasDripContext(req)).toBe(true);
  });

  it('should return false when drip context missing', () => {
    const req = createMockRequest({});
    expect(hasDripContext(req)).toBe(false);
  });
});

describe('getDripContext', () => {
  it('should return drip context when present', () => {
    const req = createMockRequest({}) as DripExpressRequest;
    req.drip = {
      drip: {} as DripExpressRequest['drip']['drip'],
      customerId: 'cust_123',
      charge: {
        success: true,
        usageEventId: 'usage_123',
        isReplay: false,
        charge: {
          id: 'chg_123',
          amountUsdc: '0.01',
          amountToken: '10000',
          txHash: '0xabc',
          status: 'CONFIRMED',
        },
      },
      isReplay: false,
    };

    const context = getDripContext(req);
    expect(context.customerId).toBe('cust_123');
  });

  it('should throw when drip context missing', () => {
    const req = createMockRequest({});
    expect(() => getDripContext(req)).toThrow('Drip context not found');
  });
});
