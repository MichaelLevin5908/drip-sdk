import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RateLimiter,
  CircuitBreaker,
  MetricsCollector,
  ResilienceManager,
  RetryExhaustedError,
  CircuitBreakerOpenError,
  calculateBackoff,
  isRetryableError,
  createDefaultResilienceConfig,
  createDisabledResilienceConfig,
  createHighThroughputResilienceConfig,
} from '../resilience.js';

// =============================================================================
// Rate Limiter Tests
// =============================================================================

describe('RateLimiter', () => {
  it('should allow burst up to burst size', async () => {
    const limiter = new RateLimiter({
      requestsPerSecond: 10,
      burstSize: 5,
      enabled: true,
    });

    // Should allow 5 requests immediately (burst)
    for (let i = 0; i < 5; i++) {
      const acquired = await limiter.acquire(10);
      expect(acquired).toBe(true);
    }
  });

  it('should throttle after burst is exhausted', async () => {
    const limiter = new RateLimiter({
      requestsPerSecond: 100,
      burstSize: 3,
      enabled: true,
    });

    // Exhaust burst
    for (let i = 0; i < 3; i++) {
      await limiter.acquire(10);
    }

    // Next request should need to wait
    const start = performance.now();
    await limiter.acquire(1000);
    const elapsed = performance.now() - start;

    // Should have waited ~10ms (1/100 per second)
    expect(elapsed).toBeGreaterThanOrEqual(5);
  });

  it('should allow all requests when disabled', async () => {
    const limiter = new RateLimiter({
      requestsPerSecond: 1,
      burstSize: 1,
      enabled: false,
    });

    // Should allow many requests instantly when disabled
    for (let i = 0; i < 10; i++) {
      const acquired = await limiter.acquire(1);
      expect(acquired).toBe(true);
    }
  });

  it('should return false on timeout', async () => {
    const limiter = new RateLimiter({
      requestsPerSecond: 1,
      burstSize: 1,
      enabled: true,
    });

    // Exhaust the single token
    await limiter.acquire(10);

    // Next request should timeout immediately
    const acquired = await limiter.acquire(1);
    expect(acquired).toBe(false);
  });

  it('should report available tokens', () => {
    const limiter = new RateLimiter({
      requestsPerSecond: 100,
      burstSize: 10,
      enabled: true,
    });

    expect(limiter.availableTokens).toBe(10);

    limiter.tryAcquire();
    expect(limiter.availableTokens).toBeLessThan(10);
  });

  it('tryAcquire should not block', () => {
    const limiter = new RateLimiter({
      requestsPerSecond: 1,
      burstSize: 1,
      enabled: true,
    });

    // First should succeed
    expect(limiter.tryAcquire()).toBe(true);

    // Second should fail immediately
    expect(limiter.tryAcquire()).toBe(false);
  });
});

// =============================================================================
// Retry Tests
// =============================================================================

describe('calculateBackoff', () => {
  const config = {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 10000,
    exponentialBase: 2,
    jitter: 0,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    enabled: true,
  };

  it('should calculate exponential backoff', () => {
    expect(calculateBackoff(0, config)).toBe(100);
    expect(calculateBackoff(1, config)).toBe(200);
    expect(calculateBackoff(2, config)).toBe(400);
    expect(calculateBackoff(3, config)).toBe(800);
  });

  it('should not exceed max delay', () => {
    const configWithLowMax = { ...config, maxDelayMs: 500 };
    expect(calculateBackoff(10, configWithLowMax)).toBe(500);
  });

  it('should add jitter when configured', () => {
    const configWithJitter = { ...config, jitter: 0.5 };
    const delays = new Set<number>();

    // Generate multiple delays to verify jitter adds variance
    for (let i = 0; i < 10; i++) {
      delays.add(calculateBackoff(0, configWithJitter));
    }

    // With 50% jitter on 100ms base, we should see some variance
    // (statistically very unlikely to get all the same)
    expect(delays.size).toBeGreaterThan(1);
  });
});

describe('isRetryableError', () => {
  const config = {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 10000,
    exponentialBase: 2,
    jitter: 0,
    retryableStatusCodes: [429, 500, 502, 503, 504],
    enabled: true,
  };

  it('should return true for network errors', () => {
    const networkError = new Error('fetch failed');
    expect(isRetryableError(networkError, config)).toBe(true);

    const connectionError = new Error('ECONNREFUSED');
    expect(isRetryableError(connectionError, config)).toBe(true);
  });

  it('should return true for retryable status codes', () => {
    const error = new Error('Server error') as Error & { statusCode: number };
    error.statusCode = 500;
    expect(isRetryableError(error, config)).toBe(true);

    error.statusCode = 429;
    expect(isRetryableError(error, config)).toBe(true);
  });

  it('should return false for non-retryable errors', () => {
    const error = new Error('Not found') as Error & { statusCode: number };
    error.statusCode = 404;
    expect(isRetryableError(error, config)).toBe(false);

    const validationError = new Error('Validation failed');
    expect(isRetryableError(validationError, config)).toBe(false);
  });
});

describe('RetryExhaustedError', () => {
  it('should contain attempt count and last error', () => {
    const lastError = new Error('Connection failed');
    const error = new RetryExhaustedError(3, lastError);

    expect(error.attempts).toBe(3);
    expect(error.lastError).toBe(lastError);
    expect(error.message).toContain('3 attempts');
    expect(error.name).toBe('RetryExhaustedError');
  });
});

// =============================================================================
// Circuit Breaker Tests
// =============================================================================

describe('CircuitBreaker', () => {
  it('should start in closed state', () => {
    const cb = new CircuitBreaker('test');
    expect(cb.getState()).toBe('closed');
  });

  it('should open after reaching failure threshold', () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 3,
      successThreshold: 2,
      timeoutMs: 30000,
      enabled: true,
    });

    // Record failures
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');

    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('should reject requests when open', () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 30000,
      enabled: true,
    });

    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);
  });

  it('should transition to half-open after timeout', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 50, // 50ms timeout
      enabled: true,
    });

    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    // Wait for timeout
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(cb.getState()).toBe('half_open');
  });

  it('should close after success threshold in half-open', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 10,
      enabled: true,
    });

    cb.recordFailure();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cb.getState()).toBe('half_open');

    cb.recordSuccess();
    expect(cb.getState()).toBe('half_open'); // Still need one more

    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
  });

  it('should reopen on failure in half-open', async () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 10,
      enabled: true,
    });

    cb.recordFailure();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cb.getState()).toBe('half_open');

    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('should allow all requests when disabled', () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 30000,
      enabled: false,
    });

    // Even after failures, should allow requests
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();

    expect(cb.allowRequest()).toBe(true);
  });

  it('should report time until retry', () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 1000,
      enabled: true,
    });

    cb.recordFailure();
    const timeUntilRetry = cb.getTimeUntilRetry();

    expect(timeUntilRetry).toBeGreaterThan(0);
    expect(timeUntilRetry).toBeLessThanOrEqual(1000);
  });

  it('should reset to initial state', () => {
    const cb = new CircuitBreaker('test', {
      failureThreshold: 1,
      successThreshold: 2,
      timeoutMs: 30000,
      enabled: true,
    });

    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.getTimeUntilRetry()).toBe(0);
  });
});

describe('CircuitBreakerOpenError', () => {
  it('should contain circuit name and time until retry', () => {
    const error = new CircuitBreakerOpenError('test_circuit', 5000);

    expect(error.circuitName).toBe('test_circuit');
    expect(error.timeUntilRetryMs).toBe(5000);
    expect(error.message).toContain('test_circuit');
    expect(error.message).toContain('5000');
    expect(error.name).toBe('CircuitBreakerOpenError');
  });
});

// =============================================================================
// Metrics Collector Tests
// =============================================================================

describe('MetricsCollector', () => {
  it('should record metrics', () => {
    const collector = new MetricsCollector();

    collector.record({
      method: 'POST',
      endpoint: '/charges',
      statusCode: 200,
      durationMs: 50,
      success: true,
      timestamp: Date.now(),
      retryCount: 0,
    });

    const summary = collector.getSummary();
    expect(summary.totalRequests).toBe(1);
    expect(summary.totalSuccesses).toBe(1);
    expect(summary.successRate).toBe(100);
  });

  it('should calculate percentiles', () => {
    const collector = new MetricsCollector();

    // Record 100 requests with varying latencies
    for (let i = 1; i <= 100; i++) {
      collector.record({
        method: 'POST',
        endpoint: '/charges',
        statusCode: 200,
        durationMs: i, // 1-100ms
        success: true,
        timestamp: Date.now(),
        retryCount: 0,
      });
    }

    const summary = collector.getSummary();
    expect(summary.p50LatencyMs).toBeGreaterThanOrEqual(49);
    expect(summary.p50LatencyMs).toBeLessThanOrEqual(52);
    expect(summary.p95LatencyMs).toBeGreaterThanOrEqual(94);
    expect(summary.p95LatencyMs).toBeLessThanOrEqual(96);
  });

  it('should track errors by type', () => {
    const collector = new MetricsCollector();

    collector.record({
      method: 'POST',
      endpoint: '/charges',
      statusCode: 500,
      durationMs: 100,
      success: false,
      timestamp: Date.now(),
      error: 'DripError',
      retryCount: 0,
    });

    collector.record({
      method: 'POST',
      endpoint: '/charges',
      statusCode: 429,
      durationMs: 50,
      success: false,
      timestamp: Date.now(),
      error: 'RateLimitError',
      retryCount: 0,
    });

    const summary = collector.getSummary();
    expect(summary.totalFailures).toBe(2);
    expect(summary.errorsByType['DripError']).toBe(1);
    expect(summary.errorsByType['RateLimitError']).toBe(1);
  });

  it('should group requests by endpoint', () => {
    const collector = new MetricsCollector();

    collector.record({
      method: 'POST',
      endpoint: '/charges',
      statusCode: 200,
      durationMs: 50,
      success: true,
      timestamp: Date.now(),
      retryCount: 0,
    });

    collector.record({
      method: 'GET',
      endpoint: '/customers',
      statusCode: 200,
      durationMs: 30,
      success: true,
      timestamp: Date.now(),
      retryCount: 0,
    });

    const summary = collector.getSummary();
    expect(summary.requestsByEndpoint['/charges']).toBe(1);
    expect(summary.requestsByEndpoint['/customers']).toBe(1);
  });

  it('should respect window size limit', () => {
    const collector = new MetricsCollector(10);

    // Record more than window size
    for (let i = 0; i < 20; i++) {
      collector.record({
        method: 'POST',
        endpoint: '/charges',
        statusCode: 200,
        durationMs: i,
        success: true,
        timestamp: Date.now(),
        retryCount: 0,
      });
    }

    const summary = collector.getSummary();
    expect(summary.windowSize).toBe(10);
    expect(summary.totalRequests).toBe(20); // Total still tracked
  });

  it('should reset all metrics', () => {
    const collector = new MetricsCollector();

    collector.record({
      method: 'POST',
      endpoint: '/charges',
      statusCode: 200,
      durationMs: 50,
      success: true,
      timestamp: Date.now(),
      retryCount: 0,
    });

    collector.reset();
    const summary = collector.getSummary();
    expect(summary.totalRequests).toBe(0);
  });

  it('should handle empty metrics', () => {
    const collector = new MetricsCollector();
    const summary = collector.getSummary();

    expect(summary.totalRequests).toBe(0);
    expect(summary.successRate).toBe(0);
    expect(summary.avgLatencyMs).toBe(0);
  });
});

// =============================================================================
// Resilience Manager Tests
// =============================================================================

describe('ResilienceManager', () => {
  it('should execute function successfully', async () => {
    const manager = new ResilienceManager(createDefaultResilienceConfig());

    const result = await manager.execute(
      async () => 'success',
      'POST',
      '/test'
    );

    expect(result).toBe('success');
  });

  it('should retry on retryable errors', async () => {
    const manager = new ResilienceManager({
      rateLimiter: { requestsPerSecond: 1000, burstSize: 1000, enabled: true },
      retry: {
        maxRetries: 2,
        baseDelayMs: 10,
        maxDelayMs: 100,
        exponentialBase: 2,
        jitter: 0,
        retryableStatusCodes: [500],
        enabled: true,
      },
      circuitBreaker: { failureThreshold: 10, successThreshold: 2, timeoutMs: 30000, enabled: false },
      collectMetrics: true,
    });

    let callCount = 0;
    const fn = async () => {
      callCount += 1;
      if (callCount < 2) {
        const error = new Error('Server error') as Error & { statusCode: number };
        error.statusCode = 500;
        throw error;
      }
      return 'success';
    };

    const result = await manager.execute(fn, 'POST', '/test');
    expect(result).toBe('success');
    expect(callCount).toBe(2);
  });

  it('should collect metrics', async () => {
    const manager = new ResilienceManager(createDefaultResilienceConfig());

    await manager.execute(async () => 'success', 'POST', '/charges');
    await manager.execute(async () => 'success', 'GET', '/customers');

    const metrics = manager.getMetrics();
    expect(metrics).not.toBeNull();
    expect(metrics!.totalRequests).toBe(2);
    expect(metrics!.requestsByEndpoint['/charges']).toBe(1);
    expect(metrics!.requestsByEndpoint['/customers']).toBe(1);
  });

  it('should provide health status', () => {
    const manager = new ResilienceManager(createDefaultResilienceConfig());

    const health = manager.getHealth();
    expect(health.circuitBreaker.state).toBe('closed');
    expect(health.rateLimiter.availableTokens).toBeGreaterThan(0);
  });

  it('should throw CircuitBreakerOpenError when circuit is open', async () => {
    const manager = new ResilienceManager({
      rateLimiter: { requestsPerSecond: 1000, burstSize: 1000, enabled: true },
      retry: { maxRetries: 0, baseDelayMs: 10, maxDelayMs: 100, exponentialBase: 2, jitter: 0, retryableStatusCodes: [], enabled: false },
      circuitBreaker: { failureThreshold: 1, successThreshold: 2, timeoutMs: 30000, enabled: true },
      collectMetrics: false,
    });

    // Trigger circuit breaker
    try {
      await manager.execute(async () => {
        throw new Error('failure');
      });
    } catch {
      // Expected
    }

    // Next call should fail with CircuitBreakerOpenError
    await expect(manager.execute(async () => 'success')).rejects.toThrow(
      CircuitBreakerOpenError
    );
  });
});

// =============================================================================
// Configuration Factory Tests
// =============================================================================

describe('Configuration Factories', () => {
  it('createDefaultResilienceConfig should return sensible defaults', () => {
    const config = createDefaultResilienceConfig();

    expect(config.rateLimiter.enabled).toBe(true);
    expect(config.rateLimiter.requestsPerSecond).toBe(100);
    expect(config.retry.enabled).toBe(true);
    expect(config.retry.maxRetries).toBe(3);
    expect(config.circuitBreaker.enabled).toBe(true);
    expect(config.collectMetrics).toBe(true);
  });

  it('createDisabledResilienceConfig should disable all features', () => {
    const config = createDisabledResilienceConfig();

    expect(config.rateLimiter.enabled).toBe(false);
    expect(config.retry.enabled).toBe(false);
    expect(config.circuitBreaker.enabled).toBe(false);
    expect(config.collectMetrics).toBe(false);
  });

  it('createHighThroughputResilienceConfig should have optimized values', () => {
    const config = createHighThroughputResilienceConfig();

    expect(config.rateLimiter.requestsPerSecond).toBe(1000);
    expect(config.rateLimiter.burstSize).toBe(2000);
    expect(config.retry.maxRetries).toBe(2);
    expect(config.circuitBreaker.failureThreshold).toBe(10);
  });
});
