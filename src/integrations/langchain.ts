/**
 * Drip LangChain integration.
 *
 * This module provides callback handlers for tracking LangChain LLM, tool,
 * chain, and agent usage with automatic billing through the Drip API.
 *
 * @example
 * ```typescript
 * import { DripCallbackHandler } from '@drip-sdk/node/langchain';
 * import { ChatOpenAI } from '@langchain/openai';
 *
 * const handler = new DripCallbackHandler({
 *   apiKey: 'drip_sk_...',
 *   customerId: 'cus_123',
 *   workflow: 'chatbot',
 * });
 *
 * const llm = new ChatOpenAI({
 *   callbacks: [handler],
 * });
 *
 * const response = await llm.invoke('Hello, world!');
 * // Usage is automatically tracked and billed
 * ```
 *
 * @packageDocumentation
 */

import { Drip } from '../index.js';

// =============================================================================
// Model Pricing
// =============================================================================

/**
 * Pricing per 1M tokens for a model.
 */
export interface ModelPricing {
  /** Cost per 1M input/prompt tokens in USD */
  input: number;
  /** Cost per 1M output/completion tokens in USD */
  output: number;
}

/**
 * OpenAI pricing per 1M tokens (as of late 2024).
 */
export const OPENAI_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'gpt-4': { input: 30.0, output: 60.0 },
  'gpt-4-32k': { input: 60.0, output: 120.0 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 },
  'gpt-3.5-turbo-16k': { input: 3.0, output: 4.0 },
  // Embedding models
  'text-embedding-3-small': { input: 0.02, output: 0.0 },
  'text-embedding-3-large': { input: 0.13, output: 0.0 },
  'text-embedding-ada-002': { input: 0.1, output: 0.0 },
} as const;

/**
 * Anthropic pricing per 1M tokens.
 */
export const ANTHROPIC_PRICING: Record<string, ModelPricing> = {
  'claude-3-5-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-opus': { input: 15.0, output: 75.0 },
  'claude-3-sonnet': { input: 3.0, output: 15.0 },
  'claude-3-haiku': { input: 0.25, output: 1.25 },
  'claude-2.1': { input: 8.0, output: 24.0 },
  'claude-2.0': { input: 8.0, output: 24.0 },
  'claude-instant-1.2': { input: 0.8, output: 2.4 },
} as const;

/**
 * Get pricing for a model by name.
 *
 * @param modelName - The model name/identifier.
 * @returns Pricing object with input/output costs per 1M tokens, or undefined if unknown.
 */
export function getModelPricing(modelName: string): ModelPricing | undefined {
  const modelLower = modelName.toLowerCase();

  // Check OpenAI models
  for (const [key, pricing] of Object.entries(OPENAI_PRICING)) {
    if (modelLower.includes(key)) {
      return pricing;
    }
  }

  // Check Anthropic models
  for (const [key, pricing] of Object.entries(ANTHROPIC_PRICING)) {
    if (modelLower.includes(key)) {
      return pricing;
    }
  }

  return undefined;
}

/**
 * Calculate the cost for a model invocation.
 *
 * @param modelName - The model name.
 * @param inputTokens - Number of input/prompt tokens.
 * @param outputTokens - Number of output/completion tokens.
 * @returns Cost in USD, or undefined if pricing is unknown.
 */
export function calculateCost(
  modelName: string,
  inputTokens: number,
  outputTokens: number,
): number | undefined {
  const pricing = getModelPricing(modelName);
  if (pricing === undefined) {
    return undefined;
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return inputCost + outputCost;
}

// =============================================================================
// Tracking State Types
// =============================================================================

/**
 * State for tracking an LLM call.
 */
interface LLMCallState {
  runId: string;
  model: string;
  startTime: number;
  prompts: string[];
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  error: string | null;
}

/**
 * State for tracking a tool call.
 */
interface ToolCallState {
  runId: string;
  toolName: string;
  startTime: number;
  inputStr: string;
  outputStr: string;
  error: string | null;
}

/**
 * State for tracking a chain execution.
 */
interface ChainCallState {
  runId: string;
  chainType: string;
  startTime: number;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  error: string | null;
}

/**
 * State for tracking agent execution.
 */
interface AgentCallState {
  runId: string;
  startTime: number;
  actions: Array<{
    tool: string;
    toolInput: string;
    log: string | null;
  }>;
  finalOutput: string | null;
  error: string | null;
}

// =============================================================================
// LangChain Types (minimal type definitions to avoid direct dependency)
// =============================================================================

/**
 * Serialized representation from LangChain.
 */
interface Serialized {
  name?: string;
  id?: string[];
}

/**
 * LLM result from LangChain.
 */
interface LLMResult {
  llm_output?: {
    token_usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  } | null;
}

/**
 * Agent action from LangChain.
 */
interface AgentAction {
  tool: string;
  toolInput: string | Record<string, unknown>;
  log: string;
}

/**
 * Agent finish from LangChain.
 */
interface AgentFinish {
  returnValues: Record<string, unknown>;
  log: string;
}

/**
 * Document from LangChain.
 */
interface Document {
  pageContent: string;
  metadata: Record<string, unknown>;
}

// =============================================================================
// Callback Handler Configuration
// =============================================================================

/**
 * Configuration options for DripCallbackHandler.
 */
export interface DripCallbackHandlerOptions {
  /**
   * Drip API key. Falls back to DRIP_API_KEY environment variable.
   */
  apiKey?: string;

  /**
   * The customer ID to bill usage to.
   * Can be set later via the `customerId` property.
   */
  customerId?: string;

  /**
   * Workflow name or ID for grouping runs.
   * @default "langchain"
   */
  workflow?: string;

  /**
   * Base URL for the Drip API.
   */
  baseUrl?: string;

  /**
   * Whether to automatically create runs when LLM calls start.
   * @default true
   */
  autoCreateRun?: boolean;

  /**
   * Whether to emit events on errors.
   * @default true
   */
  emitOnError?: boolean;

  /**
   * Additional metadata to attach to all events.
   */
  metadata?: Record<string, unknown>;
}

// =============================================================================
// DripCallbackHandler
// =============================================================================

/**
 * LangChain callback handler for Drip usage tracking.
 *
 * This handler automatically tracks LLM calls, tool usage, chain executions,
 * and agent actions, emitting events to the Drip API for billing.
 *
 * @example
 * ```typescript
 * import { DripCallbackHandler } from '@drip-sdk/node/langchain';
 * import { ChatOpenAI } from '@langchain/openai';
 *
 * const handler = new DripCallbackHandler({
 *   apiKey: 'drip_sk_...',
 *   customerId: 'cus_123',
 *   workflow: 'chatbot',
 * });
 *
 * const llm = new ChatOpenAI({
 *   callbacks: [handler],
 * });
 *
 * const response = await llm.invoke('Hello!');
 * ```
 */
export class DripCallbackHandler {
  private readonly _client: Drip;
  private _customerId: string | undefined;
  private readonly _workflow: string;
  private readonly _autoCreateRun: boolean;
  private readonly _emitOnError: boolean;
  private readonly _baseMetadata: Record<string, unknown>;

  // Active tracking state
  private _currentRunId: string | null = null;
  private readonly _llmCalls: Map<string, LLMCallState> = new Map();
  private readonly _toolCalls: Map<string, ToolCallState> = new Map();
  private readonly _chainCalls: Map<string, ChainCallState> = new Map();
  private readonly _agentCalls: Map<string, AgentCallState> = new Map();

  constructor(options: DripCallbackHandlerOptions = {}) {
    this._client = new Drip({
      apiKey: options.apiKey ?? process.env.DRIP_API_KEY ?? '',
      baseUrl: options.baseUrl,
    });
    this._customerId = options.customerId;
    this._workflow = options.workflow ?? 'langchain';
    this._autoCreateRun = options.autoCreateRun ?? true;
    this._emitOnError = options.emitOnError ?? true;
    this._baseMetadata = options.metadata ?? {};
  }

  /**
   * Get the customer ID.
   * @throws Error if customer ID is not set.
   */
  get customerId(): string {
    if (this._customerId === undefined) {
      throw new Error('customerId must be set before using the handler');
    }
    return this._customerId;
  }

  /**
   * Set the customer ID.
   */
  set customerId(value: string) {
    this._customerId = value;
  }

  /**
   * Get the current run ID.
   */
  get runId(): string | null {
    return this._currentRunId;
  }

  /**
   * Manually start a new run.
   *
   * @param options - Run options.
   * @returns The created run ID.
   */
  async startRun(options: {
    externalRunId?: string;
    correlationId?: string;
    metadata?: Record<string, unknown>;
  } = {}): Promise<string> {
    const result = await this._client.recordRun({
      customerId: this.customerId,
      workflow: this._workflow,
      events: [],
      status: 'COMPLETED',
      externalRunId: options.externalRunId,
      correlationId: options.correlationId,
      metadata: { ...this._baseMetadata, ...(options.metadata ?? {}) },
    });
    this._currentRunId = result.run.id;
    return this._currentRunId;
  }

  /**
   * Manually end the current run.
   *
   * @param status - Final status.
   * @param errorMessage - Error message for failed runs.
   */
  async endRun(
    status: 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMEOUT' = 'COMPLETED',
    errorMessage?: string,
  ): Promise<void> {
    if (this._currentRunId) {
      await this._client.endRun(this._currentRunId, {
        status,
        errorMessage,
      });
      this._currentRunId = null;
    }
  }

  /**
   * Ensure a run exists, creating one if autoCreateRun is enabled.
   */
  private async _ensureRun(): Promise<string> {
    if (this._currentRunId === null) {
      if (this._autoCreateRun) {
        const result = await this._client.startRun({
          customerId: this.customerId,
          workflowId: this._workflow,
          metadata: this._baseMetadata,
        });
        this._currentRunId = result.id;
      } else {
        throw new Error('No active run. Call startRun() first.');
      }
    }
    return this._currentRunId;
  }

  /**
   * Emit an event to the Drip API.
   */
  private async _emitEvent(params: {
    eventType: string;
    quantity?: number;
    units?: string;
    description?: string;
    costUnits?: number;
    metadata?: Record<string, unknown>;
    idempotencySuffix?: string;
  }): Promise<void> {
    const runId = await this._ensureRun();

    let idempotencyKey: string | undefined;
    if (params.idempotencySuffix) {
      idempotencyKey = Drip.generateIdempotencyKey({
        customerId: this.customerId,
        stepName: `${params.eventType}:${params.idempotencySuffix}`,
        runId,
      });
    }

    await this._client.emitEvent({
      runId,
      eventType: params.eventType,
      quantity: params.quantity,
      units: params.units,
      description: params.description,
      costUnits: params.costUnits,
      idempotencyKey,
      metadata: { ...this._baseMetadata, ...(params.metadata ?? {}) },
    });
  }

  // ===========================================================================
  // LLM Callbacks
  // ===========================================================================

  /**
   * Called when LLM starts running.
   */
  handleLLMStart(
    serialized: Serialized,
    prompts: string[],
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
  ): void {
    const modelName = serialized.name ?? serialized.id?.at(-1) ?? 'unknown';

    this._llmCalls.set(runId, {
      runId,
      model: modelName,
      startTime: Date.now(),
      prompts,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      error: null,
    });
  }

  /**
   * Called when LLM ends running.
   */
  async handleLLMEnd(
    response: LLMResult,
    runId: string,
    _parentRunId?: string,
  ): Promise<void> {
    const state = this._llmCalls.get(runId);
    this._llmCalls.delete(runId);

    if (!state) {
      return;
    }

    const latencyMs = Date.now() - state.startTime;

    // Extract token usage
    const tokenUsage = response.llm_output?.token_usage ?? {};
    const inputTokens = tokenUsage.prompt_tokens ?? 0;
    const outputTokens = tokenUsage.completion_tokens ?? 0;
    const totalTokens = tokenUsage.total_tokens ?? (inputTokens + outputTokens);

    // Calculate cost
    const cost = calculateCost(state.model, inputTokens, outputTokens);

    // Emit event
    await this._emitEvent({
      eventType: 'llm.completion',
      quantity: totalTokens,
      units: 'tokens',
      description: `LLM call to ${state.model}`,
      costUnits: cost,
      metadata: {
        model: state.model,
        inputTokens,
        outputTokens,
        latencyMs,
        promptCount: state.prompts.length,
      },
      idempotencySuffix: runId,
    });
  }

  /**
   * Called when LLM errors.
   */
  async handleLLMError(
    error: Error,
    runId: string,
    _parentRunId?: string,
  ): Promise<void> {
    const state = this._llmCalls.get(runId);
    this._llmCalls.delete(runId);

    if (!state) {
      return;
    }

    if (this._emitOnError) {
      const latencyMs = Date.now() - state.startTime;
      await this._emitEvent({
        eventType: 'llm.error',
        quantity: 1,
        units: 'errors',
        description: `LLM error: ${error.name}`,
        metadata: {
          model: state.model,
          errorType: error.name,
          errorMessage: error.message,
          latencyMs,
        },
        idempotencySuffix: runId,
      });
    }
  }

  /**
   * Called on new LLM token (streaming).
   * Tokens are tracked at completion, not per-token.
   */
  handleLLMNewToken(
    _token: string,
    _idx: { prompt: number; completion: number },
    _runId: string,
    _parentRunId?: string,
  ): void {
    // Tokens tracked at completion, not per-token
  }

  // ===========================================================================
  // Chat Model Callbacks
  // ===========================================================================

  /**
   * Called when chat model starts running.
   */
  handleChatModelStart(
    serialized: Serialized,
    messages: unknown[][],
    runId: string,
    _parentRunId?: string,
    _extraParams?: Record<string, unknown>,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
  ): void {
    const modelName = serialized.name ?? serialized.id?.at(-1) ?? 'unknown';

    // Convert messages to string representation for tracking
    const prompts = messages.map((msgList) => JSON.stringify(msgList));

    this._llmCalls.set(runId, {
      runId,
      model: modelName,
      startTime: Date.now(),
      prompts,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      error: null,
    });
  }

  // ===========================================================================
  // Tool Callbacks
  // ===========================================================================

  /**
   * Called when tool starts running.
   */
  handleToolStart(
    serialized: Serialized,
    inputStr: string,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
  ): void {
    const toolName = serialized.name ?? 'unknown_tool';

    this._toolCalls.set(runId, {
      runId,
      toolName,
      startTime: Date.now(),
      inputStr: inputStr.slice(0, 1000), // Truncate long inputs
      outputStr: '',
      error: null,
    });
  }

  /**
   * Called when tool ends running.
   */
  async handleToolEnd(
    output: string,
    runId: string,
    _parentRunId?: string,
  ): Promise<void> {
    const state = this._toolCalls.get(runId);
    this._toolCalls.delete(runId);

    if (!state) {
      return;
    }

    const latencyMs = Date.now() - state.startTime;

    await this._emitEvent({
      eventType: 'tool.call',
      quantity: 1,
      units: 'calls',
      description: `Tool: ${state.toolName}`,
      metadata: {
        toolName: state.toolName,
        latencyMs,
        inputPreview: state.inputStr.slice(0, 200),
        outputPreview: String(output).slice(0, 200),
      },
      idempotencySuffix: runId,
    });
  }

  /**
   * Called when tool errors.
   */
  async handleToolError(
    error: Error,
    runId: string,
    _parentRunId?: string,
  ): Promise<void> {
    const state = this._toolCalls.get(runId);
    this._toolCalls.delete(runId);

    if (!state) {
      return;
    }

    if (this._emitOnError) {
      const latencyMs = Date.now() - state.startTime;
      await this._emitEvent({
        eventType: 'tool.error',
        quantity: 1,
        units: 'errors',
        description: `Tool error: ${state.toolName}`,
        metadata: {
          toolName: state.toolName,
          errorType: error.name,
          errorMessage: error.message,
          latencyMs,
        },
        idempotencySuffix: runId,
      });
    }
  }

  // ===========================================================================
  // Chain Callbacks
  // ===========================================================================

  /**
   * Called when chain starts running.
   */
  handleChainStart(
    serialized: Serialized,
    inputs: Record<string, unknown>,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
  ): void {
    const chainType = serialized.name ?? serialized.id?.at(-1) ?? 'unknown';

    this._chainCalls.set(runId, {
      runId,
      chainType,
      startTime: Date.now(),
      inputs,
      outputs: {},
      error: null,
    });
  }

  /**
   * Called when chain ends running.
   */
  async handleChainEnd(
    outputs: Record<string, unknown>,
    runId: string,
    _parentRunId?: string,
  ): Promise<void> {
    const state = this._chainCalls.get(runId);
    this._chainCalls.delete(runId);

    if (!state) {
      return;
    }

    const latencyMs = Date.now() - state.startTime;

    await this._emitEvent({
      eventType: 'chain.execution',
      quantity: 1,
      units: 'executions',
      description: `Chain: ${state.chainType}`,
      metadata: {
        chainType: state.chainType,
        latencyMs,
        inputKeys: Object.keys(state.inputs),
        outputKeys: Object.keys(outputs),
      },
      idempotencySuffix: runId,
    });
  }

  /**
   * Called when chain errors.
   */
  async handleChainError(
    error: Error,
    runId: string,
    _parentRunId?: string,
  ): Promise<void> {
    const state = this._chainCalls.get(runId);
    this._chainCalls.delete(runId);

    if (!state) {
      return;
    }

    if (this._emitOnError) {
      const latencyMs = Date.now() - state.startTime;
      await this._emitEvent({
        eventType: 'chain.error',
        quantity: 1,
        units: 'errors',
        description: `Chain error: ${state.chainType}`,
        metadata: {
          chainType: state.chainType,
          errorType: error.name,
          errorMessage: error.message,
          latencyMs,
        },
        idempotencySuffix: runId,
      });
    }
  }

  // ===========================================================================
  // Agent Callbacks
  // ===========================================================================

  /**
   * Called when agent takes an action.
   */
  async handleAgentAction(
    action: AgentAction,
    runId: string,
    _parentRunId?: string,
  ): Promise<void> {
    let state = this._agentCalls.get(runId);

    if (!state) {
      state = {
        runId,
        startTime: Date.now(),
        actions: [],
        finalOutput: null,
        error: null,
      };
      this._agentCalls.set(runId, state);
    }

    const toolInput = typeof action.toolInput === 'string'
      ? action.toolInput
      : JSON.stringify(action.toolInput);

    state.actions.push({
      tool: action.tool,
      toolInput: toolInput.slice(0, 500),
      log: action.log?.slice(0, 500) ?? null,
    });

    // Emit action event
    await this._emitEvent({
      eventType: 'agent.action',
      quantity: 1,
      units: 'actions',
      description: `Agent action: ${action.tool}`,
      metadata: {
        tool: action.tool,
        actionCount: state.actions.length,
      },
      idempotencySuffix: `${runId}:${state.actions.length}`,
    });
  }

  /**
   * Called when agent finishes.
   */
  async handleAgentEnd(
    finish: AgentFinish,
    runId: string,
    _parentRunId?: string,
  ): Promise<void> {
    const state = this._agentCalls.get(runId);
    this._agentCalls.delete(runId);

    let latencyMs = 0;
    let actionCount = 0;

    if (state) {
      latencyMs = Date.now() - state.startTime;
      actionCount = state.actions.length;
    }

    await this._emitEvent({
      eventType: 'agent.finish',
      quantity: actionCount || 1,
      units: 'actions',
      description: 'Agent run completed',
      metadata: {
        latencyMs,
        actionCount,
        outputPreview: JSON.stringify(finish.returnValues).slice(0, 500),
      },
      idempotencySuffix: runId,
    });
  }

  // ===========================================================================
  // Retriever Callbacks
  // ===========================================================================

  /**
   * Called when retriever starts running.
   */
  handleRetrieverStart(
    serialized: Serialized,
    query: string,
    runId: string,
    _parentRunId?: string,
    _tags?: string[],
    _metadata?: Record<string, unknown>,
  ): void {
    const retrieverName = serialized.name ?? 'retriever';

    // Track as a tool call
    this._toolCalls.set(runId, {
      runId,
      toolName: `retriever:${retrieverName}`,
      startTime: Date.now(),
      inputStr: query.slice(0, 1000),
      outputStr: '',
      error: null,
    });
  }

  /**
   * Called when retriever ends running.
   */
  async handleRetrieverEnd(
    documents: Document[],
    runId: string,
    _parentRunId?: string,
  ): Promise<void> {
    const state = this._toolCalls.get(runId);
    this._toolCalls.delete(runId);

    if (!state) {
      return;
    }

    const latencyMs = Date.now() - state.startTime;

    await this._emitEvent({
      eventType: 'retriever.query',
      quantity: documents.length,
      units: 'documents',
      description: `Retriever: ${state.toolName}`,
      metadata: {
        retriever: state.toolName,
        queryPreview: state.inputStr.slice(0, 200),
        documentCount: documents.length,
        latencyMs,
      },
      idempotencySuffix: runId,
    });
  }

  /**
   * Called when retriever errors.
   */
  async handleRetrieverError(
    error: Error,
    runId: string,
    _parentRunId?: string,
  ): Promise<void> {
    const state = this._toolCalls.get(runId);
    this._toolCalls.delete(runId);

    if (!state) {
      return;
    }

    if (this._emitOnError) {
      const latencyMs = Date.now() - state.startTime;
      await this._emitEvent({
        eventType: 'retriever.error',
        quantity: 1,
        units: 'errors',
        description: `Retriever error: ${state.toolName}`,
        metadata: {
          retriever: state.toolName,
          errorType: error.name,
          errorMessage: error.message,
          latencyMs,
        },
        idempotencySuffix: runId,
      });
    }
  }

  // ===========================================================================
  // Text Callbacks
  // ===========================================================================

  /**
   * Called when arbitrary text is received.
   * Optional: override to track text events if needed.
   */
  handleText(
    _text: string,
    _runId: string,
    _parentRunId?: string,
  ): void {
    // Optional: track text events if needed
  }
}

// =============================================================================
// Exports
// =============================================================================

export {
  DripCallbackHandler as default,
};
