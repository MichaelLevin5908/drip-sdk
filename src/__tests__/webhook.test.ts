import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Drip } from '../index.js';

describe('Webhook Signature', () => {
  const testPayload = JSON.stringify({
    type: 'charge.succeeded',
    data: { chargeId: 'chg_test123', amount: '1.50' },
  });
  const testSecret = 'whsec_testsecret123';

  describe('generateWebhookSignature', () => {
    it('should generate signature in correct format', () => {
      const signature = Drip.generateWebhookSignature(testPayload, testSecret);

      expect(signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
    });

    it('should use provided timestamp', () => {
      const timestamp = 1700000000;
      const signature = Drip.generateWebhookSignature(testPayload, testSecret, timestamp);

      expect(signature).toMatch(/^t=1700000000,v1=[a-f0-9]{64}$/);
    });

    it('should generate different signatures for different payloads', () => {
      const sig1 = Drip.generateWebhookSignature('payload1', testSecret, 1700000000);
      const sig2 = Drip.generateWebhookSignature('payload2', testSecret, 1700000000);

      expect(sig1).not.toBe(sig2);
    });

    it('should generate different signatures for different secrets', () => {
      const sig1 = Drip.generateWebhookSignature(testPayload, 'secret1', 1700000000);
      const sig2 = Drip.generateWebhookSignature(testPayload, 'secret2', 1700000000);

      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifyWebhookSignatureSync', () => {
    it('should verify valid signature', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = Drip.generateWebhookSignature(testPayload, testSecret, timestamp);

      const isValid = Drip.verifyWebhookSignatureSync(testPayload, signature, testSecret);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const isValid = Drip.verifyWebhookSignatureSync(
        testPayload,
        'invalid_signature',
        testSecret,
      );

      expect(isValid).toBe(false);
    });

    it('should reject signature without correct format', () => {
      const isValid = Drip.verifyWebhookSignatureSync(
        testPayload,
        'sha256=abc123', // Wrong format
        testSecret,
      );

      expect(isValid).toBe(false);
    });

    it('should reject expired timestamp', () => {
      // Generate signature with timestamp from 10 minutes ago
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const signature = Drip.generateWebhookSignature(testPayload, testSecret, oldTimestamp);

      // Default tolerance is 5 minutes (300 seconds)
      const isValid = Drip.verifyWebhookSignatureSync(testPayload, signature, testSecret);

      expect(isValid).toBe(false);
    });

    it('should accept custom tolerance', () => {
      // Generate signature with timestamp from 10 minutes ago
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const signature = Drip.generateWebhookSignature(testPayload, testSecret, oldTimestamp);

      // Use 15 minute tolerance
      const isValid = Drip.verifyWebhookSignatureSync(testPayload, signature, testSecret, 900);

      expect(isValid).toBe(true);
    });

    it('should reject wrong payload', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = Drip.generateWebhookSignature(testPayload, testSecret, timestamp);

      const isValid = Drip.verifyWebhookSignatureSync(
        'different payload',
        signature,
        testSecret,
      );

      expect(isValid).toBe(false);
    });

    it('should reject wrong secret', () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = Drip.generateWebhookSignature(testPayload, testSecret, timestamp);

      const isValid = Drip.verifyWebhookSignatureSync(
        testPayload,
        signature,
        'wrong_secret',
      );

      expect(isValid).toBe(false);
    });

    it('should return false for empty inputs', () => {
      expect(Drip.verifyWebhookSignatureSync('', 'sig', 'secret')).toBe(false);
      expect(Drip.verifyWebhookSignatureSync('payload', '', 'secret')).toBe(false);
      expect(Drip.verifyWebhookSignatureSync('payload', 'sig', '')).toBe(false);
    });

    it('should return false for malformed timestamp', () => {
      const isValid = Drip.verifyWebhookSignatureSync(
        testPayload,
        't=invalid,v1=abc123',
        testSecret,
      );

      expect(isValid).toBe(false);
    });
  });

  describe('verifyWebhookSignature (async)', () => {
    it('should verify valid signature', async () => {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = Drip.generateWebhookSignature(testPayload, testSecret, timestamp);

      const isValid = await Drip.verifyWebhookSignature(testPayload, signature, testSecret);

      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', async () => {
      const isValid = await Drip.verifyWebhookSignature(
        testPayload,
        'invalid_signature',
        testSecret,
      );

      expect(isValid).toBe(false);
    });

    it('should reject expired timestamp', async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const signature = Drip.generateWebhookSignature(testPayload, testSecret, oldTimestamp);

      const isValid = await Drip.verifyWebhookSignature(testPayload, signature, testSecret);

      expect(isValid).toBe(false);
    });

    it('should accept custom tolerance', async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 600;
      const signature = Drip.generateWebhookSignature(testPayload, testSecret, oldTimestamp);

      const isValid = await Drip.verifyWebhookSignature(
        testPayload,
        signature,
        testSecret,
        900,
      );

      expect(isValid).toBe(true);
    });

    it('should return false for empty inputs', async () => {
      expect(await Drip.verifyWebhookSignature('', 'sig', 'secret')).toBe(false);
      expect(await Drip.verifyWebhookSignature('payload', '', 'secret')).toBe(false);
      expect(await Drip.verifyWebhookSignature('payload', 'sig', '')).toBe(false);
    });
  });
});
