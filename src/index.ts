/**
 * Drip SDK - Usage-based billing for Node.js
 *
 * The official SDK for integrating with the Drip billing platform.
 * Provides methods for managing customers, recording usage, handling charges,
 * and configuring webhooks.
 *
 * @packageDocumentation
 */

import { StreamMeter, type StreamMeterOptions } from './stream-meter.js';

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Configuration options for the Drip SDK client.
 */
export interface DripConfig {
  /**
   * Your Drip API key. Obtain this from the Drip dashboard.
   * @example "drip_live_abc123..."
   */
  apiKey: string;

  /**
   * Base URL for the Drip API. Defaults to production API.
   * Override for staging/development environments.
   * @default "https://api.drip.dev/v1"
   */
  baseUrl?: string;

  /**
   * Request timeout in milliseconds.
   * @default 30000
   */
  timeout?: number;
}

// ============================================================================
// Customer Types
// ============================================================================

/**
 * Parameters for creating a new customer.
 */
export interface CreateCustomerParams {
  /**
   * Your internal customer/user ID for reconciliation.
   * @example "user_12345"
   */
  externalCustomerId?: string;

  /**
   * The customer's Drip Smart Account address (derived from their EOA).
   * @example "0x1234567890abcdef..."
   */
  onchainAddress: string;

  /**
   * Additional metadata to store with the customer.
   */
  metadata?: Record<string, unknown>;
}

/**
 * A Drip customer record.
 */
export interface Customer {
  /** Unique customer ID in Drip */
  id: string;

  /** Your business ID */
  businessId: string;

  /** Your external customer ID (if provided) */
  externalCustomerId: string | null;

  /** Customer's on-chain address */
  onchainAddress: string;

  /** Custom metadata */
  metadata: Record<string, unknown> | null;

  /** ISO timestamp of creation */
  createdAt: string;

  /** ISO timestamp of last update */
  updatedAt: string;
}

/**
 * Options for listing customers.
 */
export interface ListCustomersOptions {
  /**
   * Maximum number of customers to return (1-100).
   * @default 100
   */
  limit?: number;

  /**
   * Filter by customer status.
   */
  status?: 'ACTIVE' | 'LOW_BALANCE' | 'PAUSED';
}

/**
 * Response from listing customers.
 */
export interface ListCustomersResponse {
  /** Array of customers */
  data: Customer[];

  /** Total count returned */
  count: number;
}

/**
 * Customer balance information.
 */
export interface BalanceResult {
  /** Customer ID */
  customerId: string;

  /** Balance in USDC (6 decimals) */
  balanceUSDC: string;

  /** Balance in native token */
  balanceToken: string;

  /** ISO timestamp of last balance update */
  lastUpdated: string;
}

// ============================================================================
// Usage & Charge Types
// ============================================================================

/**
 * Parameters for recording usage and charging a customer.
 */
export interface ChargeParams {
  /**
   * The Drip customer ID to charge.
   */
  customerId: string;

  /**
   * The usage meter/type to record against.
   * Must match a meter configured in your pricing plan.
   * @example "api_calls", "compute_seconds", "storage_gb"
   */
  meter: string;

  /**
   * The quantity of usage to record.
   * Will be multiplied by the meter's unit price.
   */
  quantity: number;

  /**
   * Unique key to prevent duplicate charges.
   * If provided, retrying with the same key returns the original charge.
   * @example "req_abc123"
   */
  idempotencyKey?: string;

  /**
   * Additional metadata to attach to this usage event.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Result of a successful charge operation.
 */
export interface ChargeResult {
  /** Whether the charge was successful */
  success: boolean;

  /** The usage event ID */
  usageEventId: string;

  /** True if this was an idempotent replay (returned cached result from previous request) */
  isReplay: boolean;

  /** Details about the charge */
  charge: {
    /** Unique charge ID */
    id: string;

    /** Amount charged in USDC (6 decimals) */
    amountUsdc: string;

    /** Amount in native token */
    amountToken: string;

    /** Blockchain transaction hash */
    txHash: string;

    /** Current status of the charge */
    status: ChargeStatus;
  };
}

/**
 * Possible charge statuses.
 */
export type ChargeStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'CONFIRMED'
  | 'FAILED'
  | 'REFUNDED';

/**
 * A detailed charge record.
 */
export interface Charge {
  /** Unique charge ID */
  id: string;

  /** Associated usage event ID */
  usageId: string;

  /** Customer ID */
  customerId: string;

  /** Customer details */
  customer: {
    id: string;
    onchainAddress: string;
    externalCustomerId: string | null;
  };

  /** Usage event details */
  usageEvent: {
    id: string;
    type: string;
    quantity: string;
    metadata: Record<string, unknown> | null;
  };

  /** Amount in USDC */
  amountUsdc: string;

  /** Amount in native token */
  amountToken: string;

  /** Transaction hash (if submitted) */
  txHash: string | null;

  /** Block number (if confirmed) */
  blockNumber: string | null;

  /** Current status */
  status: ChargeStatus;

  /** Failure reason (if failed) */
  failureReason: string | null;

  /** ISO timestamp of creation */
  createdAt: string;

  /** ISO timestamp of confirmation */
  confirmedAt: string | null;
}

/**
 * Options for listing charges.
 */
export interface ListChargesOptions {
  /**
   * Filter by customer ID.
   */
  customerId?: string;

  /**
   * Filter by charge status.
   */
  status?: ChargeStatus;

  /**
   * Maximum number of charges to return (1-100).
   * @default 100
   */
  limit?: number;

  /**
   * Number of charges to skip (for pagination).
   * @default 0
   */
  offset?: number;
}

/**
 * Response from listing charges.
 */
export interface ListChargesResponse {
  /** Array of charges */
  data: Charge[];

  /** Total count returned */
  count: number;
}

// ============================================================================
// Webhook Types
// ============================================================================

/**
 * Available webhook event types.
 */
export type WebhookEventType =
  | 'customer.balance.low'
  | 'usage.recorded'
  | 'charge.succeeded'
  | 'charge.failed'
  | 'customer.deposit.confirmed'
  | 'customer.withdraw.confirmed'
  | 'customer.usage_cap.reached'
  | 'webhook.endpoint.unhealthy'
  | 'customer.created'
  | 'api_key.created'
  | 'pricing_plan.updated'
  | 'transaction.created'
  | 'transaction.pending'
  | 'transaction.confirmed'
  | 'transaction.failed';

/**
 * Parameters for creating a webhook.
 */
export interface CreateWebhookParams {
  /**
   * The URL to send webhook events to.
   * Must be HTTPS in production.
   * @example "https://api.yourapp.com/webhooks/drip"
   */
  url: string;

  /**
   * Array of event types to subscribe to.
   * @example ["charge.succeeded", "charge.failed"]
   */
  events: WebhookEventType[];

  /**
   * Optional description for the webhook.
   */
  description?: string;
}

/**
 * A webhook configuration.
 */
export interface Webhook {
  /** Unique webhook ID */
  id: string;

  /** Webhook endpoint URL */
  url: string;

  /** Subscribed event types */
  events: string[];

  /** Description */
  description: string | null;

  /** Whether the webhook is active */
  isActive: boolean;

  /** ISO timestamp of creation */
  createdAt: string;

  /** ISO timestamp of last update */
  updatedAt: string;

  /** Delivery statistics */
  stats?: {
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    lastDeliveryAt: string | null;
  };
}

/**
 * Response from creating a webhook.
 */
export interface CreateWebhookResponse extends Webhook {
  /**
   * The webhook signing secret.
   * Only returned once at creation time - save it securely!
   */
  secret: string;

  /** Reminder to save the secret */
  message: string;
}

/**
 * Response from listing webhooks.
 */
export interface ListWebhooksResponse {
  /** Array of webhooks */
  data: Webhook[];

  /** Total count */
  count: number;
}

/**
 * Response from deleting a webhook.
 */
export interface DeleteWebhookResponse {
  /** Whether the deletion was successful */
  success: boolean;
}

// ============================================================================
// Checkout Types
// ============================================================================

/**
 * Parameters for creating a checkout session.
 * This is the primary way to get money into a customer's account.
 */
export interface CheckoutParams {
  /**
   * Existing customer ID (optional).
   * If not provided, a new customer is created after payment.
   */
  customerId?: string;

  /**
   * Your internal customer/user ID for new customers.
   * Used to link the Drip customer to your system.
   */
  externalCustomerId?: string;

  /**
   * Amount in cents (e.g., 5000 = $50.00).
   * Minimum: 500 ($5.00)
   * Maximum: 1000000 ($10,000.00)
   */
  amount: number;

  /**
   * URL to redirect after successful payment.
   * Query params will be added: session_id, customer_id, status
   */
  returnUrl: string;

  /**
   * URL to redirect if user cancels (optional).
   */
  cancelUrl?: string;

  /**
   * Custom metadata to attach to this checkout.
   */
  metadata?: Record<string, unknown>;
}

/**
 * Result of creating a checkout session.
 */
export interface CheckoutResult {
  /** Checkout session ID */
  id: string;

  /** URL to redirect user to for payment */
  url: string;

  /** ISO timestamp when session expires (30 minutes) */
  expiresAt: string;

  /** Amount in USD */
  amountUsd: number;
}

// ============================================================================
// Run & Event Types (Execution Ledger)
// ============================================================================

/**
 * Parameters for creating a new workflow.
 */
export interface CreateWorkflowParams {
  /** Human-readable workflow name */
  name: string;

  /** URL-safe identifier (lowercase alphanumeric with underscores/hyphens) */
  slug: string;

  /** Type of workflow */
  productSurface?: 'RPC' | 'WEBHOOK' | 'AGENT' | 'PIPELINE' | 'CUSTOM';

  /** Optional description */
  description?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * A workflow definition.
 */
export interface Workflow {
  id: string;
  name: string;
  slug: string;
  productSurface: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

/**
 * Parameters for starting a new agent run.
 */
export interface StartRunParams {
  /** Customer ID this run belongs to */
  customerId: string;

  /** Workflow ID this run executes */
  workflowId: string;

  /** Your external run ID for correlation */
  externalRunId?: string;

  /** Correlation ID for distributed tracing */
  correlationId?: string;

  /** Parent run ID for nested runs */
  parentRunId?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of starting a run.
 */
export interface RunResult {
  id: string;
  customerId: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  correlationId: string | null;
  createdAt: string;
}

/**
 * Parameters for ending/updating a run.
 */
export interface EndRunParams {
  /** New status for the run */
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';

  /** Error message if failed */
  errorMessage?: string;

  /** Error code for categorization */
  errorCode?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Possible run statuses.
 */
export type RunStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'TIMEOUT';

/**
 * Parameters for emitting an event to a run.
 */
export interface EmitEventParams {
  /** Run ID to attach this event to */
  runId: string;

  /** Event type (e.g., "agent.step", "rpc.request") */
  eventType: string;

  /** Quantity of units consumed */
  quantity?: number;

  /** Human-readable unit label */
  units?: string;

  /** Human-readable description */
  description?: string;

  /** Cost in abstract units */
  costUnits?: number;

  /** Currency for cost */
  costCurrency?: string;

  /** Correlation ID for tracing */
  correlationId?: string;

  /** Parent event ID for trace tree */
  parentEventId?: string;

  /** OpenTelemetry-style span ID */
  spanId?: string;

  /** Idempotency key (auto-generated if not provided) */
  idempotencyKey?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of emitting an event.
 */
export interface EventResult {
  id: string;
  runId: string;
  eventType: string;
  quantity: number;
  costUnits: number | null;
  isDuplicate: boolean;
  timestamp: string;
}

// ============================================================================
// Meter Types
// ============================================================================

/**
 * A meter (usage type) from a pricing plan.
 */
export interface Meter {
  /** Pricing plan ID */
  id: string;

  /** Human-readable name */
  name: string;

  /** The meter/usage type identifier (use this in charge() calls) */
  meter: string;

  /** Price per unit in USD */
  unitPriceUsd: string;

  /** Whether this meter is active */
  isActive: boolean;
}

/**
 * Response from listing meters.
 */
export interface ListMetersResponse {
  /** Array of available meters */
  data: Meter[];

  /** Total count */
  count: number;
}

// ============================================================================
// Record Run Types (Simplified API)
// ============================================================================

/**
 * A single event to record in a run.
 */
export interface RecordRunEvent {
  /** Event type (e.g., "agent.step", "tool.call") */
  eventType: string;

  /** Quantity of units consumed */
  quantity?: number;

  /** Human-readable unit label */
  units?: string;

  /** Human-readable description */
  description?: string;

  /** Cost in abstract units */
  costUnits?: number;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Parameters for recording a complete run in one call.
 * This is the simplified API that combines workflow, run, and events.
 */
export interface RecordRunParams {
  /** Customer ID this run belongs to */
  customerId: string;

  /**
   * Workflow identifier. Can be:
   * - An existing workflow ID (e.g., "wf_abc123")
   * - A slug that will be auto-created if it doesn't exist (e.g., "my_agent")
   */
  workflow: string;

  /** Events that occurred during the run */
  events: RecordRunEvent[];

  /** Final status of the run */
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT';

  /** Error message if status is FAILED */
  errorMessage?: string;

  /** Error code if status is FAILED */
  errorCode?: string;

  /** Your external run ID for correlation */
  externalRunId?: string;

  /** Correlation ID for distributed tracing */
  correlationId?: string;

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Result of recording a run.
 */
export interface RecordRunResult {
  /** The created run */
  run: {
    id: string;
    workflowId: string;
    workflowName: string;
    status: RunStatus;
    durationMs: number | null;
  };

  /** Summary of events created */
  events: {
    created: number;
    duplicates: number;
  };

  /** Total cost computed */
  totalCostUnits: string | null;

  /** Human-readable summary */
  summary: string;
}

/**
 * Full run timeline response.
 */
export interface RunTimeline {
  run: {
    id: string;
    customerId: string;
    customerName: string | null;
    workflowId: string;
    workflowName: string;
    status: RunStatus;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
    errorMessage: string | null;
    errorCode: string | null;
    correlationId: string | null;
    metadata: Record<string, unknown> | null;
  };
  timeline: Array<{
    id: string;
    eventType: string;
    quantity: number;
    units: string | null;
    description: string | null;
    costUnits: number | null;
    timestamp: string;
    correlationId: string | null;
    parentEventId: string | null;
    charge: {
      id: string;
      amountUsdc: string;
      status: string;
    } | null;
  }>;
  totals: {
    eventCount: number;
    totalQuantity: string;
    totalCostUnits: string;
    totalChargedUsdc: string;
  };
  summary: string;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Error thrown by Drip SDK operations.
 */
export class DripError extends Error {
  /**
   * Creates a new DripError.
   * @param message - Human-readable error message
   * @param statusCode - HTTP status code from the API
   * @param code - Machine-readable error code
   */
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
  ) {
    super(message);
    this.name = 'DripError';
    Object.setPrototypeOf(this, DripError.prototype);
  }
}

// ============================================================================
// Main SDK Class
// ============================================================================

/**
 * The main Drip SDK client.
 *
 * @example
 * ```typescript
 * import { Drip } from '@drip-sdk/node';
 *
 * const drip = new Drip({
 *   apiKey: process.env.DRIP_API_KEY!,
 * });
 *
 * // Create a customer
 * const customer = await drip.createCustomer({
 *   onchainAddress: '0x...',
 *   externalCustomerId: 'user_123',
 * });
 *
 * // Record usage and charge
 * const result = await drip.charge({
 *   customerId: customer.id,
 *   meter: 'api_calls',
 *   quantity: 100,
 * });
 *
 * console.log(`Charged ${result.charge.amountUsdc} USDC`);
 * ```
 */
export class Drip {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeout: number;

  /**
   * Creates a new Drip SDK client.
   *
   * @param config - Configuration options
   * @throws {Error} If apiKey is not provided
   *
   * @example
   * ```typescript
   * const drip = new Drip({
   *   apiKey: 'drip_live_abc123...',
   * });
   * ```
   */
  constructor(config: DripConfig) {
    if (!config.apiKey) {
      throw new Error('Drip API key is required');
    }

    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || 'https://api.drip.dev/v1';
    this.timeout = config.timeout || 30000;
  }

  /**
   * Makes an authenticated request to the Drip API.
   * @internal
   */
  private async request<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          ...options.headers,
        },
      });

      // Handle 204 No Content
      if (res.status === 204) {
        return { success: true } as T;
      }

      const data = await res.json();

      if (!res.ok) {
        throw new DripError(
          data.message || data.error || 'Request failed',
          res.status,
          data.code,
        );
      }

      return data as T;
    } catch (error) {
      if (error instanceof DripError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DripError('Request timed out', 408, 'TIMEOUT');
      }
      throw new DripError(
        error instanceof Error ? error.message : 'Unknown error',
        0,
        'UNKNOWN',
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ==========================================================================
  // Customer Methods
  // ==========================================================================

  /**
   * Creates a new customer in your Drip account.
   *
   * @param params - Customer creation parameters
   * @returns The created customer
   * @throws {DripError} If creation fails (e.g., duplicate customer)
   *
   * @example
   * ```typescript
   * const customer = await drip.createCustomer({
   *   onchainAddress: '0x1234567890abcdef...',
   *   externalCustomerId: 'user_123',
   *   metadata: { plan: 'pro' },
   * });
   * ```
   */
  async createCustomer(params: CreateCustomerParams): Promise<Customer> {
    return this.request<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Retrieves a customer by their Drip ID.
   *
   * @param customerId - The Drip customer ID
   * @returns The customer details
   * @throws {DripError} If customer not found (404)
   *
   * @example
   * ```typescript
   * const customer = await drip.getCustomer('cust_abc123');
   * console.log(customer.onchainAddress);
   * ```
   */
  async getCustomer(customerId: string): Promise<Customer> {
    return this.request<Customer>(`/customers/${customerId}`);
  }

  /**
   * Lists all customers for your business.
   *
   * @param options - Optional filtering and pagination
   * @returns List of customers
   *
   * @example
   * ```typescript
   * // List all customers
   * const { data: customers } = await drip.listCustomers();
   *
   * // List with filters
   * const { data: activeCustomers } = await drip.listCustomers({
   *   status: 'ACTIVE',
   *   limit: 50,
   * });
   * ```
   */
  async listCustomers(
    options?: ListCustomersOptions,
  ): Promise<ListCustomersResponse> {
    const params = new URLSearchParams();

    if (options?.limit) {
      params.set('limit', options.limit.toString());
    }
    if (options?.status) {
      params.set('status', options.status);
    }

    const query = params.toString();
    const path = query ? `/customers?${query}` : '/customers';

    return this.request<ListCustomersResponse>(path);
  }

  /**
   * Gets the current balance for a customer.
   *
   * @param customerId - The Drip customer ID
   * @returns Current balance in USDC and native token
   *
   * @example
   * ```typescript
   * const balance = await drip.getBalance('cust_abc123');
   * console.log(`Balance: ${balance.balanceUSDC} USDC`);
   * ```
   */
  async getBalance(customerId: string): Promise<BalanceResult> {
    return this.request<BalanceResult>(`/customers/${customerId}/balance`);
  }

  // ==========================================================================
  // Charge Methods
  // ==========================================================================

  /**
   * Records usage and charges a customer.
   *
   * This is the primary method for billing customers. It:
   * 1. Records the usage event
   * 2. Calculates the charge based on your pricing plan
   * 3. Executes the on-chain charge
   *
   * @param params - Charge parameters
   * @returns The charge result
   * @throws {DripError} If charge fails (insufficient balance, invalid customer, etc.)
   *
   * @example
   * ```typescript
   * const result = await drip.charge({
   *   customerId: 'cust_abc123',
   *   meter: 'api_calls',
   *   quantity: 100,
   *   idempotencyKey: 'req_unique_123',
   * });
   *
   * if (result.success) {
   *   console.log(`Charged ${result.charge.amountUsdc} USDC`);
   *   console.log(`TX: ${result.charge.txHash}`);
   * }
   * ```
   */
  async charge(params: ChargeParams): Promise<ChargeResult> {
    return this.request<ChargeResult>('/usage', {
      method: 'POST',
      body: JSON.stringify({
        customerId: params.customerId,
        usageType: params.meter,
        quantity: params.quantity,
        idempotencyKey: params.idempotencyKey,
        metadata: params.metadata,
      }),
    });
  }

  /**
   * Retrieves a specific charge by ID.
   *
   * @param chargeId - The charge ID
   * @returns The charge details
   * @throws {DripError} If charge not found (404)
   *
   * @example
   * ```typescript
   * const charge = await drip.getCharge('chg_abc123');
   * console.log(`Status: ${charge.status}`);
   * ```
   */
  async getCharge(chargeId: string): Promise<Charge> {
    return this.request<Charge>(`/charges/${chargeId}`);
  }

  /**
   * Lists charges for your business.
   *
   * @param options - Optional filtering and pagination
   * @returns List of charges
   *
   * @example
   * ```typescript
   * // List all charges
   * const { data: charges } = await drip.listCharges();
   *
   * // List charges for a specific customer
   * const { data: customerCharges } = await drip.listCharges({
   *   customerId: 'cust_abc123',
   *   status: 'CONFIRMED',
   * });
   * ```
   */
  async listCharges(options?: ListChargesOptions): Promise<ListChargesResponse> {
    const params = new URLSearchParams();

    if (options?.customerId) {
      params.set('customerId', options.customerId);
    }
    if (options?.status) {
      params.set('status', options.status);
    }
    if (options?.limit) {
      params.set('limit', options.limit.toString());
    }
    if (options?.offset) {
      params.set('offset', options.offset.toString());
    }

    const query = params.toString();
    const path = query ? `/charges?${query}` : '/charges';

    return this.request<ListChargesResponse>(path);
  }

  /**
   * Gets the current status of a charge.
   *
   * Useful for polling charge status after async operations.
   *
   * @param chargeId - The charge ID
   * @returns Current charge status
   *
   * @example
   * ```typescript
   * const status = await drip.getChargeStatus('chg_abc123');
   * if (status.status === 'CONFIRMED') {
   *   console.log('Charge confirmed!');
   * }
   * ```
   */
  async getChargeStatus(
    chargeId: string,
  ): Promise<{ status: ChargeStatus; txHash?: string }> {
    return this.request<{ status: ChargeStatus; txHash?: string }>(
      `/charges/${chargeId}/status`,
    );
  }

  // ==========================================================================
  // Checkout Methods (Fiat On-Ramp)
  // ==========================================================================

  /**
   * Creates a checkout session to add funds to a customer's account.
   *
   * This is the PRIMARY method for getting money into Drip. It returns a URL
   * to a hosted checkout page where customers can pay via:
   * - Bank transfer (ACH) - $0.50 flat fee, 1-2 business days
   * - Debit card - 1.5% fee, instant
   * - Direct USDC - no fee, instant
   *
   * After payment, the customer is redirected to your returnUrl with:
   * - session_id: The checkout session ID
   * - customer_id: The Drip customer ID
   * - status: "success" or "failed"
   *
   * @param params - Checkout parameters
   * @returns Checkout session with redirect URL
   *
   * @example
   * ```typescript
   * // Basic checkout
   * const { url } = await drip.checkout({
   *   customerId: 'cust_abc123',
   *   amount: 5000, // $50.00
   *   returnUrl: 'https://myapp.com/dashboard',
   * });
   *
   * // Redirect user to checkout
   * res.redirect(url);
   * ```
   *
   * @example
   * ```typescript
   * // Checkout for new customer
   * const { url, id } = await drip.checkout({
   *   externalCustomerId: 'user_123', // Your user ID
   *   amount: 10000, // $100.00
   *   returnUrl: 'https://myapp.com/welcome',
   *   metadata: { plan: 'pro' },
   * });
   * ```
   */
  async checkout(params: CheckoutParams): Promise<CheckoutResult> {
    const response = await this.request<{
      id: string;
      url: string;
      expires_at: string;
      amount_usd: number;
    }>('/checkout', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: params.customerId,
        external_customer_id: params.externalCustomerId,
        amount: params.amount,
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
        metadata: params.metadata,
      }),
    });

    return {
      id: response.id,
      url: response.url,
      expiresAt: response.expires_at,
      amountUsd: response.amount_usd,
    };
  }

  // ==========================================================================
  // Webhook Methods
  // ==========================================================================

  /**
   * Creates a new webhook endpoint.
   *
   * The webhook secret is only returned once at creation time.
   * Store it securely for verifying webhook signatures.
   *
   * @param config - Webhook configuration
   * @returns The created webhook with its secret
   *
   * @example
   * ```typescript
   * const webhook = await drip.createWebhook({
   *   url: 'https://api.yourapp.com/webhooks/drip',
   *   events: ['charge.succeeded', 'charge.failed'],
   *   description: 'Main webhook endpoint',
   * });
   *
   * // IMPORTANT: Save this secret securely!
   * console.log(`Webhook secret: ${webhook.secret}`);
   * ```
   */
  async createWebhook(
    config: CreateWebhookParams,
  ): Promise<CreateWebhookResponse> {
    return this.request<CreateWebhookResponse>('/webhooks', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  /**
   * Lists all webhook endpoints for your business.
   *
   * @returns List of webhooks with delivery statistics
   *
   * @example
   * ```typescript
   * const { data: webhooks } = await drip.listWebhooks();
   * webhooks.forEach(wh => {
   *   console.log(`${wh.url}: ${wh.stats?.successfulDeliveries} successful`);
   * });
   * ```
   */
  async listWebhooks(): Promise<ListWebhooksResponse> {
    return this.request<ListWebhooksResponse>('/webhooks');
  }

  /**
   * Retrieves a specific webhook by ID.
   *
   * @param webhookId - The webhook ID
   * @returns The webhook details with statistics
   * @throws {DripError} If webhook not found (404)
   *
   * @example
   * ```typescript
   * const webhook = await drip.getWebhook('wh_abc123');
   * console.log(`Events: ${webhook.events.join(', ')}`);
   * ```
   */
  async getWebhook(webhookId: string): Promise<Webhook> {
    return this.request<Webhook>(`/webhooks/${webhookId}`);
  }

  /**
   * Deletes a webhook endpoint.
   *
   * @param webhookId - The webhook ID to delete
   * @returns Success confirmation
   * @throws {DripError} If webhook not found (404)
   *
   * @example
   * ```typescript
   * await drip.deleteWebhook('wh_abc123');
   * console.log('Webhook deleted');
   * ```
   */
  async deleteWebhook(webhookId: string): Promise<DeleteWebhookResponse> {
    return this.request<DeleteWebhookResponse>(`/webhooks/${webhookId}`, {
      method: 'DELETE',
    });
  }

  /**
   * Tests a webhook by sending a test event.
   *
   * @param webhookId - The webhook ID to test
   * @returns Test result
   *
   * @example
   * ```typescript
   * const result = await drip.testWebhook('wh_abc123');
   * console.log(`Test status: ${result.status}`);
   * ```
   */
  async testWebhook(
    webhookId: string,
  ): Promise<{ message: string; deliveryId: string | null; status: string }> {
    return this.request<{
      message: string;
      deliveryId: string | null;
      status: string;
    }>(`/webhooks/${webhookId}/test`, {
      method: 'POST',
    });
  }

  /**
   * Rotates the signing secret for a webhook.
   *
   * After rotation, update your application to use the new secret.
   *
   * @param webhookId - The webhook ID
   * @returns The new secret
   *
   * @example
   * ```typescript
   * const { secret } = await drip.rotateWebhookSecret('wh_abc123');
   * console.log(`New secret: ${secret}`);
   * // Update your application with the new secret!
   * ```
   */
  async rotateWebhookSecret(
    webhookId: string,
  ): Promise<{ secret: string; message: string }> {
    return this.request<{ secret: string; message: string }>(
      `/webhooks/${webhookId}/rotate-secret`,
      { method: 'POST' },
    );
  }

  // ==========================================================================
  // Run & Event Methods (Execution Ledger)
  // ==========================================================================

  /**
   * Creates a new workflow definition.
   *
   * @param params - Workflow creation parameters
   * @returns The created workflow
   *
   * @example
   * ```typescript
   * const workflow = await drip.createWorkflow({
   *   name: 'Prescription Intake',
   *   slug: 'prescription_intake',
   *   productSurface: 'AGENT',
   * });
   * ```
   */
  async createWorkflow(params: CreateWorkflowParams): Promise<Workflow> {
    return this.request<Workflow>('/workflows', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Lists all workflows for your business.
   *
   * @returns List of workflows
   */
  async listWorkflows(): Promise<{ data: Workflow[]; count: number }> {
    return this.request<{ data: Workflow[]; count: number }>('/workflows');
  }

  /**
   * Starts a new agent run for tracking execution.
   *
   * @param params - Run parameters
   * @returns The started run
   *
   * @example
   * ```typescript
   * const run = await drip.startRun({
   *   customerId: 'cust_abc123',
   *   workflowId: 'wf_xyz789',
   *   correlationId: 'req_unique_123',
   * });
   *
   * // Emit events during execution...
   *
   * await drip.endRun(run.id, { status: 'COMPLETED' });
   * ```
   */
  async startRun(params: StartRunParams): Promise<RunResult> {
    return this.request<RunResult>('/runs', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Ends a run with a final status.
   *
   * @param runId - The run ID to end
   * @param params - End parameters including status
   * @returns Updated run info
   *
   * @example
   * ```typescript
   * await drip.endRun(run.id, {
   *   status: 'COMPLETED',
   * });
   *
   * // Or with error:
   * await drip.endRun(run.id, {
   *   status: 'FAILED',
   *   errorMessage: 'Customer validation failed',
   *   errorCode: 'VALIDATION_ERROR',
   * });
   * ```
   */
  async endRun(
    runId: string,
    params: EndRunParams,
  ): Promise<{
    id: string;
    status: RunStatus;
    endedAt: string | null;
    durationMs: number | null;
    eventCount: number;
    totalCostUnits: string | null;
  }> {
    return this.request(`/runs/${runId}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    });
  }

  /**
   * Gets a run's full timeline with events and computed totals.
   *
   * This is the key endpoint for debugging "what happened" in an execution.
   *
   * @param runId - The run ID
   * @returns Full timeline with events and summary
   *
   * @example
   * ```typescript
   * const { run, timeline, totals, summary } = await drip.getRunTimeline('run_abc123');
   *
   * console.log(`Status: ${run.status}`);
   * console.log(`Summary: ${summary}`);
   * console.log(`Total cost: ${totals.totalCostUnits}`);
   *
   * for (const event of timeline) {
   *   console.log(`${event.eventType}: ${event.quantity} ${event.units}`);
   * }
   * ```
   */
  async getRunTimeline(runId: string): Promise<RunTimeline> {
    return this.request<RunTimeline>(`/runs/${runId}`);
  }

  /**
   * Emits an event to a run.
   *
   * Events can be stored idempotently when an `idempotencyKey` is provided.
   * Use `Drip.generateIdempotencyKey()` for deterministic key generation.
   * If `idempotencyKey` is omitted, repeated calls may create duplicate events.
   *
   * @param params - Event parameters
   * @returns The created event
   *
   * @example
   * ```typescript
   * await drip.emitEvent({
   *   runId: run.id,
   *   eventType: 'agent.validate',
   *   quantity: 1,
   *   description: 'Validated prescription format',
   *   costUnits: 0.001,
   * });
   * ```
   */
  async emitEvent(params: EmitEventParams): Promise<EventResult> {
    return this.request<EventResult>('/events', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Emits multiple events in a single request.
   *
   * @param events - Array of events to emit
   * @returns Summary of created events
   *
   * @example
   * ```typescript
   * const result = await drip.emitEventsBatch([
   *   { runId: run.id, eventType: 'agent.step1', quantity: 1 },
   *   { runId: run.id, eventType: 'agent.step2', quantity: 100, units: 'tokens' },
   * ]);
   *
   * console.log(`Created: ${result.created}, Duplicates: ${result.duplicates}`);
   * ```
   */
  async emitEventsBatch(
    events: Array<Omit<EmitEventParams, 'runId'> & {
      runId?: string;
      customerId?: string;
      workflowId?: string;
    }>,
  ): Promise<{
    success: boolean;
    created: number;
    duplicates: number;
    events: Array<{ id: string; eventType: string; isDuplicate: boolean }>;
  }> {
    return this.request('/events/batch', {
      method: 'POST',
      body: JSON.stringify({ events }),
    });
  }

  // ==========================================================================
  // Simplified API Methods
  // ==========================================================================

  /**
   * Lists all available meters (usage types) for your business.
   *
   * Use this to discover what meter names are valid for the `charge()` method.
   * Meters are defined by your pricing plans.
   *
   * @returns List of available meters with their prices
   *
   * @example
   * ```typescript
   * const { data: meters } = await drip.listMeters();
   *
   * console.log('Available meters:');
   * for (const meter of meters) {
   *   console.log(`  ${meter.meter}: $${meter.unitPriceUsd}/unit`);
   * }
   *
   * // Use in charge():
   * await drip.charge({
   *   customerId: 'cust_123',
   *   meter: meters[0].meter,  // Use a valid meter name
   *   quantity: 100,
   * });
   * ```
   */
  async listMeters(): Promise<ListMetersResponse> {
    const response = await this.request<{
      data: Array<{
        id: string;
        name: string;
        unitType: string;
        unitPriceUsd: string;
        isActive: boolean;
      }>;
      count: number;
    }>('/pricing-plans');

    return {
      data: response.data.map((plan) => ({
        id: plan.id,
        name: plan.name,
        meter: plan.unitType,
        unitPriceUsd: plan.unitPriceUsd,
        isActive: plan.isActive,
      })),
      count: response.count,
    };
  }

  /**
   * Records a complete agent run in a single call.
   *
   * This is the **simplified API** that combines:
   * - Workflow creation (if needed)
   * - Run creation
   * - Event emission
   * - Run completion
   *
   * Use this instead of the individual `startRun()`, `emitEvent()`, `endRun()` calls
   * when you have all the run data available at once.
   *
   * @param params - Run parameters including events
   * @returns The created run with event summary
   *
   * @example
   * ```typescript
   * // Record a complete agent run in one call
   * const result = await drip.recordRun({
   *   customerId: 'cust_123',
   *   workflow: 'prescription_intake',  // Auto-creates if doesn't exist
   *   events: [
   *     { eventType: 'agent.start', description: 'Started processing' },
   *     { eventType: 'tool.ocr', quantity: 3, units: 'pages', costUnits: 0.15 },
   *     { eventType: 'tool.validate', quantity: 1, costUnits: 0.05 },
   *     { eventType: 'agent.complete', description: 'Finished successfully' },
   *   ],
   *   status: 'COMPLETED',
   * });
   *
   * console.log(`Run ${result.run.id}: ${result.summary}`);
   * console.log(`Events: ${result.events.created} created`);
   * ```
   *
   * @example
   * ```typescript
   * // Record a failed run with error details
   * const result = await drip.recordRun({
   *   customerId: 'cust_123',
   *   workflow: 'prescription_intake',
   *   events: [
   *     { eventType: 'agent.start', description: 'Started processing' },
   *     { eventType: 'tool.ocr', quantity: 1, units: 'pages' },
   *     { eventType: 'error', description: 'OCR failed: image too blurry' },
   *   ],
   *   status: 'FAILED',
   *   errorMessage: 'OCR processing failed',
   *   errorCode: 'OCR_QUALITY_ERROR',
   * });
   * ```
   */
  async recordRun(params: RecordRunParams): Promise<RecordRunResult> {
    const startTime = Date.now();

    // Step 1: Ensure workflow exists (get or create)
    let workflowId = params.workflow;
    let workflowName = params.workflow;

    // If it looks like a slug (no underscore prefix), try to find/create it
    if (!params.workflow.startsWith('wf_')) {
      try {
        // Try to find existing workflow by slug
        const workflows = await this.listWorkflows();
        const existing = workflows.data.find(
          (w) => w.slug === params.workflow || w.id === params.workflow,
        );

        if (existing) {
          workflowId = existing.id;
          workflowName = existing.name;
        } else {
          // Create new workflow with the slug
          const created = await this.createWorkflow({
            name: params.workflow.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
            slug: params.workflow,
            productSurface: 'AGENT',
          });
          workflowId = created.id;
          workflowName = created.name;
        }
      } catch {
        // If lookup fails, assume it's an ID
        workflowId = params.workflow;
      }
    }

    // Step 2: Create the run
    const run = await this.startRun({
      customerId: params.customerId,
      workflowId,
      externalRunId: params.externalRunId,
      correlationId: params.correlationId,
      metadata: params.metadata,
    });

    // Step 3: Emit all events in batch
    let eventsCreated = 0;
    let eventsDuplicates = 0;

    if (params.events.length > 0) {
      const batchEvents = params.events.map((event, index) => ({
        runId: run.id,
        eventType: event.eventType,
        quantity: event.quantity,
        units: event.units,
        description: event.description,
        costUnits: event.costUnits,
        metadata: event.metadata,
        idempotencyKey: params.externalRunId
          ? `${params.externalRunId}:${event.eventType}:${index}`
          : undefined,
      }));

      const batchResult = await this.emitEventsBatch(batchEvents);
      eventsCreated = batchResult.created;
      eventsDuplicates = batchResult.duplicates;
    }

    // Step 4: End the run
    const endResult = await this.endRun(run.id, {
      status: params.status,
      errorMessage: params.errorMessage,
      errorCode: params.errorCode,
    });

    const durationMs = Date.now() - startTime;

    // Build summary
    const eventSummary = params.events.length > 0
      ? `${eventsCreated} events recorded`
      : 'no events';
    const statusEmoji = params.status === 'COMPLETED' ? '✓' : params.status === 'FAILED' ? '✗' : '○';
    const summary = `${statusEmoji} ${workflowName}: ${eventSummary} (${endResult.durationMs ?? durationMs}ms)`;

    return {
      run: {
        id: run.id,
        workflowId,
        workflowName,
        status: params.status,
        durationMs: endResult.durationMs,
      },
      events: {
        created: eventsCreated,
        duplicates: eventsDuplicates,
      },
      totalCostUnits: endResult.totalCostUnits,
      summary,
    };
  }

  /**
   * Generates a deterministic idempotency key.
   *
   * Use this to ensure "one logical action = one event" even with retries.
   * The key is generated from customerId + runId + stepName + sequence.
   *
   * @param params - Key generation parameters
   * @returns A deterministic idempotency key
   *
   * @example
   * ```typescript
   * const key = Drip.generateIdempotencyKey({
   *   customerId: 'cust_123',
   *   runId: 'run_456',
   *   stepName: 'validate_prescription',
   *   sequence: 1,
   * });
   *
   * await drip.emitEvent({
   *   runId: 'run_456',
   *   eventType: 'agent.validate',
   *   idempotencyKey: key,
   * });
   * ```
   */
  static generateIdempotencyKey(params: {
    customerId: string;
    runId?: string;
    stepName: string;
    sequence?: number;
  }): string {
    const components = [
      params.customerId,
      params.runId ?? 'no_run',
      params.stepName,
      String(params.sequence ?? 0),
    ];

    // Simple hash function for deterministic key generation
    let hash = 0;
    const str = components.join('|');
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }

    return `drip_${Math.abs(hash).toString(36)}_${params.stepName.slice(0, 16)}`;
  }

  // ==========================================================================
  // Utility Methods
  // ==========================================================================

  /**
   * Verifies a webhook signature using HMAC-SHA256.
   *
   * Call this when receiving webhook events to ensure they're authentic.
   * This is an async method that uses the Web Crypto API for secure verification.
   *
   * @param payload - The raw request body (string)
   * @param signature - The x-drip-signature header value
   * @param secret - Your webhook secret
   * @returns Promise resolving to whether the signature is valid
   *
   * @example
   * ```typescript
   * app.post('/webhooks/drip', async (req, res) => {
   *   const isValid = await Drip.verifyWebhookSignature(
   *     req.rawBody,
   *     req.headers['x-drip-signature'],
   *     process.env.DRIP_WEBHOOK_SECRET!,
   *   );
   *
   *   if (!isValid) {
   *     return res.status(401).send('Invalid signature');
   *   }
   *
   *   // Process the webhook...
   * });
   * ```
   */
  static async verifyWebhookSignature(
    payload: string,
    signature: string,
    secret: string,
  ): Promise<boolean> {
    if (!payload || !signature || !secret) {
      return false;
    }

    try {
      const encoder = new TextEncoder();
      const keyData = encoder.encode(secret);
      const payloadData = encoder.encode(payload);

      // Import the secret as an HMAC key
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );

      // Sign the payload
      const signatureBuffer = await crypto.subtle.sign(
        'HMAC',
        cryptoKey,
        payloadData,
      );

      // Convert to hex string
      const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      // Constant-time comparison to prevent timing attacks
      if (signature.length !== expectedSignature.length) {
        return false;
      }

      let result = 0;
      for (let i = 0; i < signature.length; i++) {
        result |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
      }

      return result === 0;
    } catch {
      return false;
    }
  }

  /**
   * Synchronously verifies a webhook signature using HMAC-SHA256.
   *
   * This method uses Node.js crypto module and is only available in Node.js environments.
   * For edge runtimes or browsers, use the async `verifyWebhookSignature` method instead.
   *
   * @param payload - The raw request body (string)
   * @param signature - The x-drip-signature header value
   * @param secret - Your webhook secret
   * @returns Whether the signature is valid
   *
   * @example
   * ```typescript
   * app.post('/webhooks/drip', (req, res) => {
   *   const isValid = Drip.verifyWebhookSignatureSync(
   *     req.rawBody,
   *     req.headers['x-drip-signature'],
   *     process.env.DRIP_WEBHOOK_SECRET!,
   *   );
   *
   *   if (!isValid) {
   *     return res.status(401).send('Invalid signature');
   *   }
   *
   *   // Process the webhook...
   * });
   * ```
   */
  static verifyWebhookSignatureSync(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    if (!payload || !signature || !secret) {
      return false;
    }

    try {
      // Dynamic import to avoid bundling issues in edge runtimes
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const crypto = require('crypto') as typeof import('crypto');

      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      // Use timingSafeEqual for constant-time comparison
      const sigBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);

      if (sigBuffer.length !== expectedBuffer.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
    } catch {
      return false;
    }
  }

  // ==========================================================================
  // StreamMeter Factory
  // ==========================================================================

  /**
   * Creates a StreamMeter for accumulating usage and charging once.
   *
   * Perfect for LLM token streaming where you want to:
   * - Accumulate tokens locally (no API call per token)
   * - Charge once at the end of the stream
   * - Handle partial failures (charge for what was delivered)
   *
   * @param options - StreamMeter configuration
   * @returns A new StreamMeter instance
   *
   * @example
   * ```typescript
   * const meter = drip.createStreamMeter({
   *   customerId: 'cust_abc123',
   *   meter: 'tokens',
   * });
   *
   * // Accumulate tokens as they stream
   * for await (const chunk of llmStream) {
   *   meter.addSync(chunk.tokens);
   *   yield chunk;
   * }
   *
   * // Single charge at end
   * const result = await meter.flush();
   * console.log(`Charged ${result.charge?.amountUsdc} for ${result.quantity} tokens`);
   * ```
   *
   * @example
   * ```typescript
   * // With auto-flush threshold
   * const meter = drip.createStreamMeter({
   *   customerId: 'cust_abc123',
   *   meter: 'tokens',
   *   flushThreshold: 10000, // Charge every 10k tokens
   * });
   *
   * for await (const chunk of longStream) {
   *   await meter.add(chunk.tokens); // May auto-flush
   * }
   *
   * await meter.flush(); // Final flush for remaining tokens
   * ```
   */
  createStreamMeter(options: StreamMeterOptions): StreamMeter {
    return new StreamMeter(this.charge.bind(this), options);
  }
}

// Re-export StreamMeter types
export { StreamMeter } from './stream-meter.js';
export type { StreamMeterOptions, StreamMeterFlushResult } from './stream-meter.js';

// Default export for convenience
export default Drip;
