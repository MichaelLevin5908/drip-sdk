import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Drip } from '../index.js';
import type { ChargeResult } from '../index.js';

// Mock fetch globally
const mockFetch = vi.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

describe('wrapApiCall', () => {
  const mockChargeResult: ChargeResult = {
    success: true,
    usageEventId: 'usage_123',
    isReplay: false,
    charge: {
      id: 'chg_123',
      amountUsdc: '0.001000',
      amountToken: '1000000000000000',
      txHash: '0x123abc',
      status: 'CONFIRMED',
    },
  };

  let drip: Drip;

  beforeEach(() => {
    vi.clearAllMocks();
    drip = new Drip({
      apiKey: 'test_api_key',
      baseUrl: 'http://localhost:3000/v1',
    });
  });

  const setupMockCharge = (result: ChargeResult = mockChargeResult) => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(result),
    });
  };

  describe('basic functionality', () => {
    it('should call the external API and record usage', async () => {
      setupMockCharge();

      interface MockApiResponse {
        data: string;
        usage: { total_tokens: number };
      }

      const externalApiCall = vi.fn().mockResolvedValue({
        data: 'response',
        usage: { total_tokens: 150 },
      });

      const result = await drip.wrapApiCall<MockApiResponse>({
        customerId: 'cust_123',
        meter: 'tokens',
        call: externalApiCall,
        extractUsage: (r) => r.usage.total_tokens,
      });

      // External API was called once
      expect(externalApiCall).toHaveBeenCalledTimes(1);

      // Usage was recorded
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/v1/usage',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"quantity":150'),
        }),
      );

      // Result contains both API result and charge
      expect(result.result.data).toBe('response');
      expect(result.charge.success).toBe(true);
      expect(result.charge.charge.amountUsdc).toBe('0.001000');
    });

    it('should generate unique idempotency key if not provided', async () => {
      setupMockCharge();

      const result = await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () => Promise.resolve({ tokens: 100 }),
        extractUsage: (r) => r.tokens,
      });

      // Should have a generated idempotency key
      expect(result.idempotencyKey).toMatch(/^wrap_\d+_[a-z0-9]+$/);

      // Check it was passed to the charge call
      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.idempotencyKey).toBe(result.idempotencyKey);
    });

    it('should use custom idempotency key if provided', async () => {
      setupMockCharge();

      const result = await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () => Promise.resolve({ tokens: 100 }),
        extractUsage: (r) => r.tokens,
        idempotencyKey: 'my_custom_key_123',
      });

      expect(result.idempotencyKey).toBe('my_custom_key_123');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.idempotencyKey).toBe('my_custom_key_123');
    });

    it('should pass metadata to charge', async () => {
      setupMockCharge();

      await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () => Promise.resolve({ tokens: 100 }),
        extractUsage: (r) => r.tokens,
        metadata: { model: 'gpt-4', prompt_id: 'abc' },
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.metadata).toEqual({ model: 'gpt-4', prompt_id: 'abc' });
    });
  });

  describe('error handling', () => {
    it('should throw if external API call fails (no retry)', async () => {
      const apiError = new Error('OpenAI rate limit exceeded');
      const externalApiCall = vi.fn().mockRejectedValue(apiError);

      await expect(
        drip.wrapApiCall({
          customerId: 'cust_123',
          meter: 'tokens',
          call: externalApiCall,
          extractUsage: () => 0,
        }),
      ).rejects.toThrow('OpenAI rate limit exceeded');

      // External API was called only once (no retry)
      expect(externalApiCall).toHaveBeenCalledTimes(1);

      // Drip charge was never called
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should throw if Drip charge fails with non-retryable error', async () => {
      // 400 Bad Request - not retryable
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ message: 'Invalid customer ID' }),
      });

      await expect(
        drip.wrapApiCall({
          customerId: 'invalid_cust',
          meter: 'tokens',
          call: () => Promise.resolve({ tokens: 100 }),
          extractUsage: (r) => r.tokens,
        }),
      ).rejects.toThrow('Invalid customer ID');

      // Only one attempt (no retry for 400)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('retry behavior', () => {
    it('should retry on 500 errors', async () => {
      // First call fails with 500, second succeeds
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ message: 'Internal server error' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockChargeResult),
        });

      const result = await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () => Promise.resolve({ tokens: 100 }),
        extractUsage: (r) => r.tokens,
        retryOptions: {
          maxAttempts: 3,
          baseDelayMs: 10, // Fast for tests
        },
      });

      // Two attempts (first failed, second succeeded)
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.charge.success).toBe(true);
    });

    it('should retry on 429 rate limit errors', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ message: 'Rate limited' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockChargeResult),
        });

      const result = await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () => Promise.resolve({ tokens: 100 }),
        extractUsage: (r) => r.tokens,
        retryOptions: {
          baseDelayMs: 10,
        },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result.charge.success).toBe(true);
    });

    it('should give up after max attempts', async () => {
      // All calls fail with 500
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ message: 'Server down' }),
      });

      await expect(
        drip.wrapApiCall({
          customerId: 'cust_123',
          meter: 'tokens',
          call: () => Promise.resolve({ tokens: 100 }),
          extractUsage: (r) => r.tokens,
          retryOptions: {
            maxAttempts: 3,
            baseDelayMs: 10,
          },
        }),
      ).rejects.toThrow('Server down');

      // Exactly 3 attempts
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should use same idempotency key across retries', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ message: 'Error' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(mockChargeResult),
        });

      await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () => Promise.resolve({ tokens: 100 }),
        extractUsage: (r) => r.tokens,
        idempotencyKey: 'fixed_key',
        retryOptions: {
          baseDelayMs: 10,
        },
      });

      // Both attempts used the same idempotency key
      const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);

      expect(firstBody.idempotencyKey).toBe('fixed_key');
      expect(secondBody.idempotencyKey).toBe('fixed_key');
    });
  });

  describe('usage extraction', () => {
    it('should handle zero usage', async () => {
      setupMockCharge();

      const result = await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () => Promise.resolve({ tokens: 0 }),
        extractUsage: (r) => r.tokens,
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.quantity).toBe(0);
      expect(result.charge.success).toBe(true);
    });

    it('should handle complex usage extraction', async () => {
      setupMockCharge();

      await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () =>
          Promise.resolve({
            usage: {
              prompt_tokens: 50,
              completion_tokens: 100,
            },
          }),
        extractUsage: (r) => r.usage.prompt_tokens + r.usage.completion_tokens,
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.quantity).toBe(150);
    });

    it('should handle nullable usage with fallback', async () => {
      setupMockCharge();

      interface NullableUsageResponse {
        usage: { total_tokens: number } | null;
      }

      await drip.wrapApiCall<NullableUsageResponse>({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () => Promise.resolve({ usage: null }),
        extractUsage: (r) => r.usage?.total_tokens ?? 0,
      });

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.quantity).toBe(0);
    });
  });

  describe('real-world scenarios', () => {
    it('should work with OpenAI-like response', async () => {
      setupMockCharge();

      const openAIResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello! How can I help you?',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 8,
          total_tokens: 18,
        },
      };

      const result = await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () => Promise.resolve(openAIResponse),
        extractUsage: (r) => r.usage.total_tokens,
        metadata: { model: 'gpt-4' },
      });

      expect(result.result.choices[0].message.content).toBe('Hello! How can I help you?');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.quantity).toBe(18);
      expect(callBody.metadata.model).toBe('gpt-4');
    });

    it('should work with Anthropic-like response', async () => {
      setupMockCharge();

      const anthropicResponse = {
        id: 'msg_123',
        type: 'message',
        content: [{ type: 'text', text: 'Hello!' }],
        usage: {
          input_tokens: 15,
          output_tokens: 25,
        },
      };

      const result = await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'tokens',
        call: () => Promise.resolve(anthropicResponse),
        extractUsage: (r) => r.usage.input_tokens + r.usage.output_tokens,
      });

      expect(result.result.content[0].text).toBe('Hello!');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.quantity).toBe(40);
    });

    it('should work with fixed-cost API calls', async () => {
      setupMockCharge();

      const result = await drip.wrapApiCall({
        customerId: 'cust_123',
        meter: 'api_calls',
        call: () => Promise.resolve({ status: 'ok', data: [1, 2, 3] }),
        extractUsage: () => 1, // Fixed cost: 1 API call
      });

      expect(result.result.status).toBe('ok');

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.quantity).toBe(1);
      expect(callBody.usageType).toBe('api_calls');
    });
  });
});
