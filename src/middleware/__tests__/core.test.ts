/**
 * Core Middleware Tests
 *
 * Tests for the framework-agnostic core middleware logic.
 */

import { describe, it, expect } from 'vitest';
import {
  hasPaymentProof,
  parsePaymentProof,
  generatePaymentRequest,
  getHeader,
  resolveCustomerId,
  resolveQuantity,
  generateIdempotencyKey,
} from '../core.js';
import { DripMiddlewareError } from '../types.js';

describe('getHeader', () => {
  it('should get header case-insensitively', () => {
    const headers = {
      'Content-Type': 'application/json',
      'x-drip-customer-id': 'cust_123',
    };

    expect(getHeader(headers, 'content-type')).toBe('application/json');
    expect(getHeader(headers, 'Content-Type')).toBe('application/json');
    expect(getHeader(headers, 'X-Drip-Customer-Id')).toBe('cust_123');
  });

  it('should handle array headers', () => {
    const headers = {
      'x-custom': ['value1', 'value2'],
    };

    expect(getHeader(headers, 'x-custom')).toBe('value1');
  });

  it('should return undefined for missing headers', () => {
    const headers = {};
    expect(getHeader(headers, 'x-missing')).toBeUndefined();
  });
});

describe('hasPaymentProof', () => {
  it('should return true when all required headers present', () => {
    const headers = {
      'x-payment-signature': '0xsig',
      'x-payment-session-key': '0xkey',
      'x-payment-smart-account': '0xaccount',
      'x-payment-timestamp': '1234567890',
      'x-payment-amount': '1.00',
      'x-payment-recipient': '0xrecipient',
      'x-payment-usage-id': '0xusageid',
      'x-payment-nonce': 'nonce123',
    };

    expect(hasPaymentProof(headers)).toBe(true);
  });

  it('should return false when headers are missing', () => {
    const headers = {
      'x-payment-signature': '0xsig',
      // Missing other required headers
    };

    expect(hasPaymentProof(headers)).toBe(false);
  });

  it('should return false for empty headers', () => {
    expect(hasPaymentProof({})).toBe(false);
  });
});

describe('parsePaymentProof', () => {
  // Use a fresh timestamp (current time in seconds)
  const freshTimestamp = String(Math.floor(Date.now() / 1000));

  const validHeaders = {
    'x-payment-signature': '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    'x-payment-session-key': '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    'x-payment-smart-account': '0x1234567890123456789012345678901234567890',
    'x-payment-timestamp': freshTimestamp,
    'x-payment-amount': '1.50',
    'x-payment-recipient': '0x0987654321098765432109876543210987654321',
    'x-payment-usage-id': '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab',
    'x-payment-nonce': 'nonce-12345',
  };

  it('should parse valid payment proof headers', () => {
    const proof = parsePaymentProof(validHeaders);

    expect(proof).not.toBeNull();
    expect(proof?.signature).toBe(validHeaders['x-payment-signature']);
    expect(proof?.sessionKeyId).toBe(validHeaders['x-payment-session-key']);
    expect(proof?.smartAccount).toBe(validHeaders['x-payment-smart-account']);
    expect(proof?.timestamp).toBe(parseInt(freshTimestamp, 10));
    expect(proof?.amount).toBe('1.50');
    expect(proof?.recipient).toBe(validHeaders['x-payment-recipient']);
    expect(proof?.usageId).toBe(validHeaders['x-payment-usage-id']);
    expect(proof?.nonce).toBe('nonce-12345');
  });

  it('should return null for missing required headers', () => {
    const incompleteHeaders = {
      'x-payment-signature': '0xsig',
    };

    expect(parsePaymentProof(incompleteHeaders)).toBeNull();
  });

  it('should return null for invalid timestamp', () => {
    const headers = {
      ...validHeaders,
      'x-payment-timestamp': 'invalid',
    };

    expect(parsePaymentProof(headers)).toBeNull();
  });

  it('should return null for expired timestamp', () => {
    // Use a timestamp from 10 minutes ago (beyond 5 min max age)
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 600);
    const headers = {
      ...validHeaders,
      'x-payment-timestamp': oldTimestamp,
    };

    expect(parsePaymentProof(headers)).toBeNull();
  });

  it('should return null for non-hex signature', () => {
    const headers = {
      ...validHeaders,
      'x-payment-signature': 'not-hex',
    };

    expect(parsePaymentProof(headers)).toBeNull();
  });

  it('should return null for signature with invalid hex characters', () => {
    const headers = {
      ...validHeaders,
      // Contains invalid hex character 'g'
      'x-payment-signature': '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefgg',
    };

    expect(parsePaymentProof(headers)).toBeNull();
  });

  it('should return null for signature that is too short', () => {
    const headers = {
      ...validHeaders,
      // Too short (less than 65 bytes / 130 hex chars)
      'x-payment-signature': '0x1234567890abcdef',
    };

    expect(parsePaymentProof(headers)).toBeNull();
  });
});

describe('generatePaymentRequest', () => {
  it('should generate valid payment request', () => {
    const { headers, paymentRequest } = generatePaymentRequest({
      amount: '1.50',
      recipient: '0x1234567890123456789012345678901234567890',
      usageId: 'usage_123',
      description: 'API call charge',
    });

    // Check headers
    expect(headers['X-Payment-Required']).toBe('true');
    expect(headers['X-Payment-Amount']).toBe('1.50');
    expect(headers['X-Payment-Recipient']).toBe('0x1234567890123456789012345678901234567890');
    expect(headers['X-Payment-Description']).toBe('API call charge');
    expect(headers['X-Payment-Nonce']).toBeTruthy();
    expect(headers['X-Payment-Timestamp']).toBeTruthy();

    // Check payment request
    expect(paymentRequest.amount).toBe('1.50');
    expect(paymentRequest.recipient).toBe('0x1234567890123456789012345678901234567890');
    expect(paymentRequest.description).toBe('API call charge');
    expect(paymentRequest.expiresAt).toBeGreaterThan(paymentRequest.timestamp);
  });

  it('should hash non-hex usageId', () => {
    const { headers } = generatePaymentRequest({
      amount: '1.00',
      recipient: '0x1234567890123456789012345678901234567890',
      usageId: 'my-string-id',
    });

    expect(headers['X-Payment-Usage-Id']).toMatch(/^0x[a-f0-9]+$/);
  });

  it('should preserve hex usageId', () => {
    const hexId = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
    const { headers } = generatePaymentRequest({
      amount: '1.00',
      recipient: '0x1234567890123456789012345678901234567890',
      usageId: hexId,
    });

    expect(headers['X-Payment-Usage-Id']).toBe(hexId);
  });

  it('should use custom expiry time', () => {
    const { paymentRequest } = generatePaymentRequest({
      amount: '1.00',
      recipient: '0x1234567890123456789012345678901234567890',
      usageId: 'test',
      expiresInSec: 120, // 2 minutes
    });

    expect(paymentRequest.expiresAt - paymentRequest.timestamp).toBe(120);
  });
});

describe('resolveCustomerId', () => {
  it('should resolve from header (default)', async () => {
    const request = {
      method: 'POST',
      url: '/api/test',
      headers: {
        'x-drip-customer-id': 'cust_from_header',
      },
    };

    const customerId = await resolveCustomerId(request, {
      meter: 'test',
      quantity: 1,
    });

    expect(customerId).toBe('cust_from_header');
  });

  it('should resolve from x-customer-id header', async () => {
    const request = {
      method: 'POST',
      url: '/api/test',
      headers: {
        'x-customer-id': 'cust_alt_header',
      },
    };

    const customerId = await resolveCustomerId(request, {
      meter: 'test',
      quantity: 1,
      customerResolver: 'header',
    });

    expect(customerId).toBe('cust_alt_header');
  });

  it('should resolve from query parameter', async () => {
    const request = {
      method: 'GET',
      url: '/api/test?drip_customer_id=cust_from_query',
      headers: {},
      query: {
        drip_customer_id: 'cust_from_query',
      },
    };

    const customerId = await resolveCustomerId(request, {
      meter: 'test',
      quantity: 1,
      customerResolver: 'query',
    });

    expect(customerId).toBe('cust_from_query');
  });

  it('should resolve from custom function', async () => {
    const request = {
      method: 'POST',
      url: '/api/test',
      headers: {
        'authorization': 'Bearer token123',
      },
    };

    const customerId = await resolveCustomerId(request, {
      meter: 'test',
      quantity: 1,
      customerResolver: (req) => {
        const auth = getHeader(req.headers, 'authorization');
        return `user_${auth?.split(' ')[1]}`;
      },
    });

    expect(customerId).toBe('user_token123');
  });

  it('should throw when header missing', async () => {
    const request = {
      method: 'POST',
      url: '/api/test',
      headers: {},
    };

    await expect(
      resolveCustomerId(request, {
        meter: 'test',
        quantity: 1,
        customerResolver: 'header',
      }),
    ).rejects.toThrow(DripMiddlewareError);
  });

  it('should throw when query param missing', async () => {
    const request = {
      method: 'GET',
      url: '/api/test',
      headers: {},
      query: {},
    };

    await expect(
      resolveCustomerId(request, {
        meter: 'test',
        quantity: 1,
        customerResolver: 'query',
      }),
    ).rejects.toThrow(DripMiddlewareError);
  });
});

describe('resolveQuantity', () => {
  it('should return static quantity', async () => {
    const request = { method: 'POST', url: '/test', headers: {} };

    const quantity = await resolveQuantity(request, {
      meter: 'test',
      quantity: 42,
    });

    expect(quantity).toBe(42);
  });

  it('should call quantity function', async () => {
    const request = {
      method: 'POST',
      url: '/test',
      headers: {
        'x-token-count': '150',
      },
    };

    const quantity = await resolveQuantity(request, {
      meter: 'tokens',
      quantity: (req) => parseInt(getHeader(req.headers, 'x-token-count') ?? '0', 10),
    });

    expect(quantity).toBe(150);
  });

  it('should handle async quantity function', async () => {
    const request = { method: 'POST', url: '/test', headers: {} };

    const quantity = await resolveQuantity(request, {
      meter: 'test',
      quantity: async () => {
        await new Promise((r) => setTimeout(r, 10));
        return 99;
      },
    });

    expect(quantity).toBe(99);
  });
});

describe('generateIdempotencyKey', () => {
  it('should generate default idempotency key', async () => {
    const request = {
      method: 'POST',
      url: '/api/v1/generate',
      headers: {},
    };

    const key = await generateIdempotencyKey(request, 'cust_123', {
      meter: 'test',
      quantity: 1,
    });

    expect(key).toMatch(/^drip_[a-f0-9]+$/);
  });

  it('should use custom idempotency key generator', async () => {
    const request = {
      method: 'POST',
      url: '/api/v1/generate',
      headers: {
        'x-request-id': 'req_custom_123',
      },
    };

    const key = await generateIdempotencyKey(request, 'cust_123', {
      meter: 'test',
      quantity: 1,
      idempotencyKey: (req) => getHeader(req.headers, 'x-request-id') ?? 'default',
    });

    expect(key).toBe('req_custom_123');
  });

  it('should generate unique keys for each call (millisecond precision)', async () => {
    const request = {
      method: 'POST',
      url: '/api/v1/generate',
      headers: {},
    };

    const key1 = await generateIdempotencyKey(request, 'cust_123', {
      meter: 'test',
      quantity: 1,
    });

    // Wait 5ms to ensure different timestamp (accounts for hash truncation)
    await new Promise((r) => setTimeout(r, 5));

    const key2 = await generateIdempotencyKey(request, 'cust_123', {
      meter: 'test',
      quantity: 1,
    });

    // Keys should be different due to millisecond precision
    expect(key1).not.toBe(key2);
  });

  it('should generate different keys for different customers', async () => {
    const request = {
      method: 'POST',
      url: '/api/v1/generate',
      headers: {},
    };

    const key1 = await generateIdempotencyKey(request, 'cust_123', {
      meter: 'test',
      quantity: 1,
    });

    const key2 = await generateIdempotencyKey(request, 'cust_456', {
      meter: 'test',
      quantity: 1,
    });

    expect(key1).not.toBe(key2);
  });
});
