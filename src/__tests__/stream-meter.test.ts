import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamMeter, type StreamMeterOptions, type StreamMeterFlushResult } from '../stream-meter.js';
import type { ChargeResult } from '../index.js';

describe('StreamMeter', () => {
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

  const createMeter = (
    options: Partial<StreamMeterOptions> = {},
    chargeFn = vi.fn().mockResolvedValue(mockChargeResult),
  ) => {
    const fullOptions: StreamMeterOptions = {
      customerId: 'cust_123',
      meter: 'tokens',
      ...options,
    };
    return { meter: new StreamMeter(chargeFn, fullOptions), chargeFn };
  };

  describe('add', () => {
    it('should accumulate quantity', () => {
      const { meter } = createMeter();

      meter.addSync(10);
      expect(meter.total).toBe(10);

      meter.addSync(5);
      expect(meter.total).toBe(15);
    });

    it('should ignore non-positive quantities', () => {
      const { meter } = createMeter();

      meter.addSync(0);
      expect(meter.total).toBe(0);

      meter.addSync(-5);
      expect(meter.total).toBe(0);
    });

    it('should call onAdd callback', () => {
      const onAdd = vi.fn();
      const { meter } = createMeter({ onAdd });

      meter.addSync(10);
      expect(onAdd).toHaveBeenCalledWith(10, 10);

      meter.addSync(5);
      expect(onAdd).toHaveBeenCalledWith(5, 15);
    });
  });

  describe('add with auto-flush', () => {
    it('should auto-flush when threshold is reached', async () => {
      const { meter, chargeFn } = createMeter({ flushThreshold: 100 });

      // Add below threshold
      await meter.add(50);
      expect(chargeFn).not.toHaveBeenCalled();
      expect(meter.total).toBe(50);

      // Add to exceed threshold
      const result = await meter.add(60);
      expect(chargeFn).toHaveBeenCalledWith({
        customerId: 'cust_123',
        meter: 'tokens',
        quantity: 110,
        idempotencyKey: undefined,
        metadata: undefined,
      });
      expect(meter.total).toBe(0);
      expect(result?.success).toBe(true);
    });
  });

  describe('flush', () => {
    it('should charge with accumulated quantity', async () => {
      const { meter, chargeFn } = createMeter();

      meter.addSync(100);
      const result = await meter.flush();

      expect(chargeFn).toHaveBeenCalledWith({
        customerId: 'cust_123',
        meter: 'tokens',
        quantity: 100,
        idempotencyKey: undefined,
        metadata: undefined,
      });
      expect(result.success).toBe(true);
      expect(result.quantity).toBe(100);
      expect(result.charge?.amountUsdc).toBe('0.001000');
    });

    it('should reset total after flush', async () => {
      const { meter } = createMeter();

      meter.addSync(100);
      await meter.flush();

      expect(meter.total).toBe(0);
    });

    it('should return success with null charge when total is 0', async () => {
      const { meter, chargeFn } = createMeter();

      const result = await meter.flush();

      expect(chargeFn).not.toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.quantity).toBe(0);
      expect(result.charge).toBeNull();
    });

    it('should include idempotency key with flush count', async () => {
      const { meter, chargeFn } = createMeter({ idempotencyKey: 'stream_123' });

      meter.addSync(50);
      await meter.flush();

      expect(chargeFn).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'stream_123_flush_0' }),
      );

      meter.addSync(50);
      await meter.flush();

      expect(chargeFn).toHaveBeenCalledWith(
        expect.objectContaining({ idempotencyKey: 'stream_123_flush_1' }),
      );
    });

    it('should include metadata', async () => {
      const { meter, chargeFn } = createMeter({
        metadata: { model: 'gpt-4' },
      });

      meter.addSync(100);
      await meter.flush();

      expect(chargeFn).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { model: 'gpt-4' } }),
      );
    });

    it('should call onFlush callback', async () => {
      const onFlush = vi.fn();
      const { meter } = createMeter({ onFlush });

      meter.addSync(100);
      await meter.flush();

      expect(onFlush).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          quantity: 100,
        }),
      );
    });

    it('should update isFlushed and flushCount', async () => {
      const { meter } = createMeter();

      expect(meter.isFlushed).toBe(false);
      expect(meter.flushCount).toBe(0);

      meter.addSync(100);
      await meter.flush();

      expect(meter.isFlushed).toBe(true);
      expect(meter.flushCount).toBe(1);

      meter.addSync(50);
      await meter.flush();

      expect(meter.flushCount).toBe(2);
    });
  });

  describe('reset', () => {
    it('should reset total to 0 without charging', async () => {
      const { meter, chargeFn } = createMeter();

      meter.addSync(100);
      meter.reset();

      expect(meter.total).toBe(0);
      expect(chargeFn).not.toHaveBeenCalled();
    });
  });

  describe('replay detection', () => {
    it('should pass through isReplay from charge result', async () => {
      const replayResult: ChargeResult = {
        ...mockChargeResult,
        isReplay: true,
      };
      const { meter } = createMeter({}, vi.fn().mockResolvedValue(replayResult));

      meter.addSync(100);
      const result = await meter.flush();

      expect(result.isReplay).toBe(true);
    });
  });
});
