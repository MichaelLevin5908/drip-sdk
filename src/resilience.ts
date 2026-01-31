/**
 * Production-grade resilience patterns for the Drip SDK.
 *
 * This module provides:
 * - Rate limiting (token bucket algorithm)
 * - Retry with exponential backoff
 * - Circuit breaker pattern
 * - Request metrics and observability
 */

// =============================================================================
// Rate Limiter (Token Bucket Algorithm)
// =============================================================================

/**
 * Configuration for rate limiting.
 */
export interface RateLimiterConfig {
  /**
   * Maximum requests per second.
   * @default 100
   */
  requestsPerSecond: number;

  /**
   * Maximum burst size (bucket capacity).
   * @default 200
   */
  burstSize: number;

  /**
   * Whether rate limiting is enabled.
   * @default true
   */
  enabled: boolean;
}

/**
 * Default rate limiter configuration.
 */
export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  requestsPerSecond: 100,
  burstSize: 200,
  enabled: true,
};

/**
 * Thread-safe token bucket rate limiter.
 *
 * Allows bursting up to `burstSize` requests, then limits to
 * `requestsPerSecond` sustained rate.
 */
export class RateLimiter {
  private readonly config: RateLimiterConfig;
  private tokens: number;
  private lastRefill: number;

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = { ...DEFAULT_RATE_LIMITER_CONFIG, ...config };
    this.tokens = this.config.burstSize;
    this.lastRefill = Date.now();
  }

  /**
   * Refill tokens based on elapsed time.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // Convert to seconds
    this.tokens = Math.min(
      this.config.burstSize,
      this.tokens + elapsed * this.config.requestsPerSecond
    );
    this.lastRefill = now;
  }

  /**
   * Acquire a token, blocking if necessary.
   *
   * @param timeout - Maximum time to wait for a token in ms (undefined = wait forever)
   * @returns Promise that resolves to true if token acquired, false if timeout
   */
  async acquire(timeout?: number): Promise<boolean> {
    if (!this.config.enabled) {
      return true;
    }

    const deadline = timeout !== undefined ? Date.now() + timeout : undefined;

    while (true) {
      this.refill();

      if (this.tokens >= 1) {
        this.tokens -= 1;
        return true;
      }

      // Calculate wait time for next token
      const waitTime = ((1 - this.tokens) / this.config.requestsPerSecond) * 1000;

      if (deadline !== undefined) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
          return false;
        }
        await this.sleep(Math.min(waitTime, remaining));
      } else {
        await this.sleep(waitTime);
      }
    }
  }

  /**
   * Try to acquire a token without waiting.
   *
   * @returns true if token acquired, false otherwise
   */
  tryAcquire(): boolean {
    if (!this.config.enabled) {
      return true;
    }

    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }

    return false;
  }

  /**
   * Get current number of available tokens.
   */
  get availableTokens(): number {
    this.refill();
    return this.tokens;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// =============================================================================
// Retry with Exponential Backoff
// =============================================================================

/**
 * Configuration for retry behavior.
 */
export interface RetryConfig {
  /**
   * Maximum number of retry attempts.
   * @default 3
   */
  maxRetries: number;

  /**
   * Base delay in milliseconds.
   * @default 100
   */
  baseDelayMs: number;

  /**
   * Maximum delay in milliseconds.
   * @default 10000
   */
  maxDelayMs: number;

  /**
   * Exponential backoff base.
   * @default 2
   */
  exponentialBase: number;

  /**
   * Random jitter factor (0-1).
   * @default 0.1
   */
  jitter: number;

  /**
   * HTTP status codes that should trigger retry.
   * @default [429, 500, 502, 503, 504]
   */
  retryableStatusCodes: number[];

  /**
   * Whether retry is enabled.
   * @default true
   */
  enabled: boolean;
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 10000,
  exponentialBase: 2,
  jitter: 0.1,
  retryableStatusCodes: [429, 500, 502, 503, 504],
  enabled: true,
};

/**
 * Error thrown when all retry attempts have been exhausted.
 */
export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastError: Error;

  constructor(attempts: number, lastError: Error) {
    super(`Retry exhausted after ${attempts} attempts: ${lastError.message}`);
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.lastError = lastError;
    Object.setPrototypeOf(this, RetryExhaustedError.prototype);
  }
}

/**
 * Calculate backoff delay for a given attempt.
 */
export function calculateBackoff(attempt: number, config: RetryConfig): number {
  let delay = config.baseDelayMs * Math.pow(config.exponentialBase, attempt);
  delay = Math.min(delay, config.maxDelayMs);

  // Add jitter
  if (config.jitter > 0) {
    const jitterRange = delay * config.jitter;
    delay += Math.random() * 2 * jitterRange - jitterRange;
  }

  return Math.max(0, delay);
}

/**
 * Check if an error is retryable based on configuration.
 */
export function isRetryableError(
  error: unknown,
  config: RetryConfig
): boolean {
  if (error instanceof Error) {
    // Check for network errors
    if (
      error.message.includes('fetch') ||
      error.message.includes('network') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ETIMEDOUT')
    ) {
      return true;
    }

    // Check for status code on error object
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode !== undefined) {
      return config.retryableStatusCodes.includes(statusCode);
    }
  }

  return false;
}

// =============================================================================
// Circuit Breaker
// =============================================================================

/**
 * Circuit breaker states.
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * Configuration for circuit breaker.
 */
export interface CircuitBreakerConfig {
  /**
   * Number of failures before opening circuit.
   * @default 5
   */
  failureThreshold: number;

  /**
   * Number of successes in half-open to close circuit.
   * @default 2
   */
  successThreshold: number;

  /**
   * Milliseconds to wait before transitioning from open to half-open.
   * @default 30000
   */
  timeoutMs: number;

  /**
   * Whether circuit breaker is enabled.
   * @default true
   */
  enabled: boolean;
}

/**
 * Default circuit breaker configuration.
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeoutMs: 30000,
  enabled: true,
};

/**
 * Error thrown when circuit breaker is open.
 */
export class CircuitBreakerOpenError extends Error {
  readonly circuitName: string;
  readonly timeUntilRetryMs: number;

  constructor(circuitName: string, timeUntilRetryMs: number) {
    super(
      `Circuit '${circuitName}' is open. Retry in ${Math.round(timeUntilRetryMs)}ms`
    );
    this.name = 'CircuitBreakerOpenError';
    this.circuitName = circuitName;
    this.timeUntilRetryMs = timeUntilRetryMs;
    Object.setPrototypeOf(this, CircuitBreakerOpenError.prototype);
  }
}

/**
 * Circuit breaker pattern implementation.
 *
 * Prevents cascading failures by failing fast when a service is unhealthy.
 */
export class CircuitBreaker {
  readonly name: string;
  private readonly config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;

  constructor(name: string, config?: Partial<CircuitBreakerConfig>) {
    this.name = name;
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  /**
   * Get current circuit state.
   */
  getState(): CircuitState {
    this.checkStateTransition();
    return this.state;
  }

  /**
   * Check if state should transition based on timeout.
   */
  private checkStateTransition(): void {
    if (this.state === 'open' && this.lastFailureTime !== null) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.config.timeoutMs) {
        this.state = 'half_open';
        this.successCount = 0;
      }
    }
  }

  /**
   * Record a successful call.
   */
  recordSuccess(): void {
    if (!this.config.enabled) {
      return;
    }

    if (this.state === 'half_open') {
      this.successCount += 1;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
      }
    } else if (this.state === 'closed') {
      // Reset failure count on success
      this.failureCount = 0;
    }
  }

  /**
   * Record a failed call.
   */
  recordFailure(): void {
    if (!this.config.enabled) {
      return;
    }

    this.failureCount += 1;
    this.lastFailureTime = Date.now();

    if (this.state === 'half_open') {
      // Any failure in half-open returns to open
      this.state = 'open';
    } else if (this.state === 'closed') {
      if (this.failureCount >= this.config.failureThreshold) {
        this.state = 'open';
      }
    }
  }

  /**
   * Check if a request should be allowed.
   */
  allowRequest(): boolean {
    if (!this.config.enabled) {
      return true;
    }

    this.checkStateTransition();

    if (this.state === 'closed') {
      return true;
    } else if (this.state === 'half_open') {
      return true; // Allow test request
    } else {
      return false;
    }
  }

  /**
   * Get milliseconds until circuit transitions to half-open.
   */
  getTimeUntilRetry(): number {
    if (this.state !== 'open' || this.lastFailureTime === null) {
      return 0;
    }
    const elapsed = Date.now() - this.lastFailureTime;
    return Math.max(0, this.config.timeoutMs - elapsed);
  }

  /**
   * Reset the circuit breaker to initial state.
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
  }
}

// =============================================================================
// Metrics and Observability
// =============================================================================

/**
 * Metrics for a single request.
 */
export interface RequestMetrics {
  method: string;
  endpoint: string;
  statusCode: number | null;
  durationMs: number;
  success: boolean;
  timestamp: number;
  error?: string;
  retryCount: number;
}

/**
 * Aggregated metrics summary.
 */
export interface MetricsSummary {
  windowSize: number;
  totalRequests: number;
  totalSuccesses: number;
  totalFailures: number;
  successRate: number;
  avgLatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  requestsByEndpoint: Record<string, number>;
  errorsByType: Record<string, number>;
}

/**
 * Collects and aggregates request metrics.
 *
 * Thread-safe metrics collection with windowed aggregation.
 */
export class MetricsCollector {
  private readonly windowSize: number;
  private readonly metrics: RequestMetrics[] = [];
  private totalRequests = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;

  constructor(windowSize = 1000) {
    this.windowSize = windowSize;
  }

  /**
   * Record a request's metrics.
   */
  record(metrics: RequestMetrics): void {
    this.metrics.push(metrics);
    this.totalRequests += 1;

    if (metrics.success) {
      this.totalSuccesses += 1;
    } else {
      this.totalFailures += 1;
    }

    // Maintain window size
    while (this.metrics.length > this.windowSize) {
      this.metrics.shift();
    }
  }

  /**
   * Get aggregated metrics summary.
   */
  getSummary(): MetricsSummary {
    if (this.metrics.length === 0) {
      return {
        windowSize: 0,
        totalRequests: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        successRate: 0,
        avgLatencyMs: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        requestsByEndpoint: {},
        errorsByType: {},
      };
    }

    const latencies = this.metrics.map((m) => m.durationMs).sort((a, b) => a - b);
    const successes = this.metrics.filter((m) => m.success).length;

    // Group by endpoint
    const byEndpoint: Record<string, number> = {};
    for (const m of this.metrics) {
      byEndpoint[m.endpoint] = (byEndpoint[m.endpoint] ?? 0) + 1;
    }

    // Group errors
    const errors: Record<string, number> = {};
    for (const m of this.metrics) {
      if (m.error) {
        errors[m.error] = (errors[m.error] ?? 0) + 1;
      }
    }

    const sum = latencies.reduce((a, b) => a + b, 0);

    return {
      windowSize: this.metrics.length,
      totalRequests: this.totalRequests,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      successRate: (successes / this.metrics.length) * 100,
      avgLatencyMs: sum / latencies.length,
      minLatencyMs: latencies[0],
      maxLatencyMs: latencies[latencies.length - 1],
      p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)],
      p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)],
      p99LatencyMs: latencies[Math.floor(latencies.length * 0.99)],
      requestsByEndpoint: byEndpoint,
      errorsByType: errors,
    };
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.metrics.length = 0;
    this.totalRequests = 0;
    this.totalSuccesses = 0;
    this.totalFailures = 0;
  }
}

// =============================================================================
// Combined Resilience Manager
// =============================================================================

/**
 * Combined configuration for all resilience features.
 */
export interface ResilienceConfig {
  rateLimiter: RateLimiterConfig;
  retry: RetryConfig;
  circuitBreaker: CircuitBreakerConfig;
  collectMetrics: boolean;
}

/**
 * Create default production configuration.
 */
export function createDefaultResilienceConfig(): ResilienceConfig {
  return {
    rateLimiter: {
      requestsPerSecond: 100,
      burstSize: 200,
      enabled: true,
    },
    retry: {
      maxRetries: 3,
      baseDelayMs: 100,
      maxDelayMs: 10000,
      exponentialBase: 2,
      jitter: 0.1,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      enabled: true,
    },
    circuitBreaker: {
      failureThreshold: 5,
      successThreshold: 2,
      timeoutMs: 30000,
      enabled: true,
    },
    collectMetrics: true,
  };
}

/**
 * Create configuration with all features disabled.
 */
export function createDisabledResilienceConfig(): ResilienceConfig {
  return {
    rateLimiter: { ...DEFAULT_RATE_LIMITER_CONFIG, enabled: false },
    retry: { ...DEFAULT_RETRY_CONFIG, enabled: false },
    circuitBreaker: { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, enabled: false },
    collectMetrics: false,
  };
}

/**
 * Create configuration optimized for high throughput.
 */
export function createHighThroughputResilienceConfig(): ResilienceConfig {
  return {
    rateLimiter: {
      requestsPerSecond: 1000,
      burstSize: 2000,
      enabled: true,
    },
    retry: {
      maxRetries: 2,
      baseDelayMs: 50,
      maxDelayMs: 5000,
      exponentialBase: 2,
      jitter: 0.1,
      retryableStatusCodes: [429, 500, 502, 503, 504],
      enabled: true,
    },
    circuitBreaker: {
      failureThreshold: 10,
      successThreshold: 3,
      timeoutMs: 15000,
      enabled: true,
    },
    collectMetrics: true,
  };
}

/**
 * Health status of resilience components.
 */
export interface ResilienceHealth {
  circuitBreaker: {
    state: CircuitState;
    timeUntilRetryMs: number;
  };
  rateLimiter: {
    availableTokens: number;
    requestsPerSecond: number;
  };
  metrics: MetricsSummary | null;
}

/**
 * Manages all resilience features for the SDK.
 *
 * Provides a unified interface for rate limiting, retry, circuit breaker,
 * and metrics collection.
 */
export class ResilienceManager {
  readonly config: ResilienceConfig;
  readonly rateLimiter: RateLimiter;
  readonly circuitBreaker: CircuitBreaker;
  readonly metrics: MetricsCollector | null;

  constructor(config?: Partial<ResilienceConfig>) {
    this.config = {
      ...createDefaultResilienceConfig(),
      ...config,
      rateLimiter: {
        ...createDefaultResilienceConfig().rateLimiter,
        ...config?.rateLimiter,
      },
      retry: {
        ...createDefaultResilienceConfig().retry,
        ...config?.retry,
      },
      circuitBreaker: {
        ...createDefaultResilienceConfig().circuitBreaker,
        ...config?.circuitBreaker,
      },
    };

    this.rateLimiter = new RateLimiter(this.config.rateLimiter);
    this.circuitBreaker = new CircuitBreaker('drip_api', this.config.circuitBreaker);
    this.metrics = this.config.collectMetrics ? new MetricsCollector() : null;
  }

  /**
   * Execute a function with all resilience features.
   *
   * @param fn - The function to execute
   * @param method - HTTP method for metrics
   * @param endpoint - Endpoint for metrics
   * @returns Result of the function
   */
  async execute<T>(
    fn: () => Promise<T>,
    method = 'UNKNOWN',
    endpoint = 'unknown'
  ): Promise<T> {
    const startTime = performance.now();
    let retryCount = 0;
    let lastError: Error | null = null;

    // Rate limiting
    const acquired = await this.rateLimiter.acquire(30000);
    if (!acquired) {
      throw new Error('Rate limiter timeout');
    }

    // Circuit breaker check
    if (!this.circuitBreaker.allowRequest()) {
      throw new CircuitBreakerOpenError(
        this.circuitBreaker.name,
        this.circuitBreaker.getTimeUntilRetry()
      );
    }

    // Execute with retry
    for (let attempt = 0; attempt <= this.config.retry.maxRetries; attempt++) {
      try {
        const result = await fn();
        this.circuitBreaker.recordSuccess();

        // Record success metrics
        if (this.metrics) {
          const duration = performance.now() - startTime;
          this.metrics.record({
            method,
            endpoint,
            statusCode: 200,
            durationMs: duration,
            success: true,
            timestamp: Date.now(),
            retryCount,
          });
        }

        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if retryable
        const isRetryable =
          this.config.retry.enabled &&
          isRetryableError(error, this.config.retry);

        if (isRetryable && attempt < this.config.retry.maxRetries) {
          retryCount += 1;
          const delay = calculateBackoff(attempt, this.config.retry);
          await this.sleep(delay);
          continue;
        }

        // Not retryable or exhausted retries
        this.circuitBreaker.recordFailure();

        // Record failure metrics
        if (this.metrics) {
          const duration = performance.now() - startTime;
          const statusCode = (error as { statusCode?: number }).statusCode ?? null;
          this.metrics.record({
            method,
            endpoint,
            statusCode,
            durationMs: duration,
            success: false,
            timestamp: Date.now(),
            error: lastError.name,
            retryCount,
          });
        }

        throw error;
      }
    }

    // Should not reach here
    if (lastError) {
      throw new RetryExhaustedError(this.config.retry.maxRetries + 1, lastError);
    }
    throw new Error('Unexpected execution path');
  }

  /**
   * Get current metrics summary.
   */
  getMetrics(): MetricsSummary | null {
    return this.metrics?.getSummary() ?? null;
  }

  /**
   * Get health status of all resilience components.
   */
  getHealth(): ResilienceHealth {
    return {
      circuitBreaker: {
        state: this.circuitBreaker.getState(),
        timeUntilRetryMs: this.circuitBreaker.getTimeUntilRetry(),
      },
      rateLimiter: {
        availableTokens: this.rateLimiter.availableTokens,
        requestsPerSecond: this.config.rateLimiter.requestsPerSecond,
      },
      metrics: this.getMetrics(),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
