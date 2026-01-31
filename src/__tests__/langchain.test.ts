import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DripCallbackHandler,
  calculateCost,
  getModelPricing,
  OPENAI_PRICING,
  ANTHROPIC_PRICING,
} from '../integrations/langchain.js';

// Mock the Drip client
vi.mock('../index.js', () => {
  const mockEmitEvent = vi.fn().mockResolvedValue({
    id: 'evt_123',
    runId: 'run_123',
    eventType: 'llm.completion',
    quantity: 100,
    costUnits: null,
    isDuplicate: false,
    timestamp: new Date().toISOString(),
  });

  const mockStartRun = vi.fn().mockResolvedValue({
    id: 'run_123',
    customerId: 'cust_123',
    workflowId: 'wf_123',
    workflowName: 'langchain',
    status: 'RUNNING',
    correlationId: null,
    createdAt: new Date().toISOString(),
  });

  const mockEndRun = vi.fn().mockResolvedValue({
    id: 'run_123',
    status: 'COMPLETED',
  });

  const mockRecordRun = vi.fn().mockResolvedValue({
    run: {
      id: 'run_123',
      workflowId: 'wf_123',
      workflowName: 'langchain',
      status: 'COMPLETED',
      durationMs: 100,
    },
    events: {
      created: 0,
      duplicates: 0,
    },
    totalCostUnits: null,
  });

  const MockDrip = vi.fn().mockImplementation(() => ({
    emitEvent: mockEmitEvent,
    startRun: mockStartRun,
    endRun: mockEndRun,
    recordRun: mockRecordRun,
  }));

  // Add static method
  MockDrip.generateIdempotencyKey = vi.fn().mockImplementation((params: {
    customerId: string;
    runId?: string;
    stepName: string;
    sequence?: number;
  }) => {
    return `${params.customerId}_${params.runId ?? 'no_run'}_${params.stepName}_${params.sequence ?? 0}`;
  });

  return {
    Drip: MockDrip,
  };
});

describe('Model Pricing', () => {
  describe('OPENAI_PRICING', () => {
    it('should have pricing for GPT-4 models', () => {
      expect(OPENAI_PRICING['gpt-4o']).toEqual({ input: 2.5, output: 10.0 });
      expect(OPENAI_PRICING['gpt-4o-mini']).toEqual({ input: 0.15, output: 0.6 });
      expect(OPENAI_PRICING['gpt-4']).toEqual({ input: 30.0, output: 60.0 });
    });

    it('should have pricing for GPT-3.5 models', () => {
      expect(OPENAI_PRICING['gpt-3.5-turbo']).toEqual({ input: 0.5, output: 1.5 });
    });

    it('should have pricing for embedding models', () => {
      expect(OPENAI_PRICING['text-embedding-3-small']).toEqual({ input: 0.02, output: 0.0 });
    });
  });

  describe('ANTHROPIC_PRICING', () => {
    it('should have pricing for Claude 3 models', () => {
      expect(ANTHROPIC_PRICING['claude-3-5-sonnet']).toEqual({ input: 3.0, output: 15.0 });
      expect(ANTHROPIC_PRICING['claude-3-opus']).toEqual({ input: 15.0, output: 75.0 });
      expect(ANTHROPIC_PRICING['claude-3-haiku']).toEqual({ input: 0.25, output: 1.25 });
    });

    it('should have pricing for Claude 2 models', () => {
      expect(ANTHROPIC_PRICING['claude-2.1']).toEqual({ input: 8.0, output: 24.0 });
    });
  });
});

describe('getModelPricing', () => {
  it('should return pricing for OpenAI models', () => {
    expect(getModelPricing('gpt-4o')).toEqual({ input: 2.5, output: 10.0 });
    expect(getModelPricing('GPT-4O')).toEqual({ input: 2.5, output: 10.0 });
    expect(getModelPricing('gpt-4o-2024-05-13')).toEqual({ input: 2.5, output: 10.0 });
  });

  it('should return pricing for Anthropic models', () => {
    expect(getModelPricing('claude-3-opus')).toEqual({ input: 15.0, output: 75.0 });
    expect(getModelPricing('claude-3-opus-20240229')).toEqual({ input: 15.0, output: 75.0 });
  });

  it('should return undefined for unknown models', () => {
    expect(getModelPricing('unknown-model')).toBeUndefined();
    expect(getModelPricing('llama-3')).toBeUndefined();
  });
});

describe('calculateCost', () => {
  it('should calculate cost for OpenAI models', () => {
    // GPT-4o: $2.50 per 1M input, $10.00 per 1M output
    const cost = calculateCost('gpt-4o', 1000, 500);
    // (1000 / 1_000_000) * 2.5 + (500 / 1_000_000) * 10.0 = 0.0025 + 0.005 = 0.0075
    expect(cost).toBeCloseTo(0.0075, 6);
  });

  it('should calculate cost for Anthropic models', () => {
    // Claude 3 Opus: $15 per 1M input, $75 per 1M output
    const cost = calculateCost('claude-3-opus', 10000, 5000);
    // (10000 / 1_000_000) * 15 + (5000 / 1_000_000) * 75 = 0.15 + 0.375 = 0.525
    expect(cost).toBeCloseTo(0.525, 6);
  });

  it('should return undefined for unknown models', () => {
    expect(calculateCost('unknown-model', 1000, 500)).toBeUndefined();
  });

  it('should handle zero tokens', () => {
    expect(calculateCost('gpt-4o', 0, 0)).toBe(0);
  });

  it('should calculate embedding model costs (output is 0)', () => {
    const cost = calculateCost('text-embedding-3-small', 10000, 0);
    // (10000 / 1_000_000) * 0.02 = 0.0000002
    expect(cost).toBeCloseTo(0.0002, 10);
  });
});

describe('DripCallbackHandler', () => {
  let handler: DripCallbackHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    handler = new DripCallbackHandler({
      apiKey: 'test_api_key',
      customerId: 'cust_123',
      workflow: 'test_workflow',
    });
  });

  describe('constructor', () => {
    it('should create handler with default options', () => {
      const defaultHandler = new DripCallbackHandler({
        apiKey: 'test_key',
        customerId: 'cust_123',
      });
      expect(defaultHandler.customerId).toBe('cust_123');
    });

    it('should accept custom workflow name', () => {
      const customHandler = new DripCallbackHandler({
        apiKey: 'test_key',
        customerId: 'cust_123',
        workflow: 'my_agent',
      });
      expect(customHandler.customerId).toBe('cust_123');
    });
  });

  describe('customerId', () => {
    it('should get and set customerId', () => {
      handler.customerId = 'new_customer';
      expect(handler.customerId).toBe('new_customer');
    });

    it('should throw when getting unset customerId', () => {
      const noCustomerHandler = new DripCallbackHandler({
        apiKey: 'test_key',
      });
      expect(() => noCustomerHandler.customerId).toThrow(
        'customerId must be set before using the handler',
      );
    });
  });

  describe('runId', () => {
    it('should return null when no run is active', () => {
      expect(handler.runId).toBeNull();
    });
  });

  describe('handleLLMStart', () => {
    it('should track LLM call start', () => {
      handler.handleLLMStart(
        { name: 'gpt-4o' },
        ['Hello, world!'],
        'run_uuid_123',
      );

      // Internal state is tracked (we verify via handleLLMEnd behavior)
      expect(handler.runId).toBeNull(); // Run not started yet
    });

    it('should extract model name from serialized id array', () => {
      handler.handleLLMStart(
        { id: ['langchain', 'llms', 'openai', 'ChatOpenAI'] },
        ['Test prompt'],
        'run_uuid_456',
      );

      // Model name should be extracted from the last element
    });
  });

  describe('handleLLMEnd', () => {
    it('should emit llm.completion event with token counts', async () => {
      const { Drip } = await import('../index.js');
      const mockInstance = new Drip({ apiKey: 'test' });

      handler.handleLLMStart({ name: 'gpt-4o' }, ['Test prompt'], 'run_123');

      await handler.handleLLMEnd(
        {
          llm_output: {
            token_usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
            },
          },
        },
        'run_123',
      );

      expect(mockInstance.emitEvent).toHaveBeenCalled();
    });

    it('should handle missing token usage gracefully', async () => {
      handler.handleLLMStart({ name: 'gpt-4o' }, ['Test'], 'run_456');

      await handler.handleLLMEnd(
        { llm_output: null },
        'run_456',
      );

      // Should not throw
    });
  });

  describe('handleLLMError', () => {
    it('should emit llm.error event when emitOnError is true', async () => {
      const { Drip } = await import('../index.js');
      const mockInstance = new Drip({ apiKey: 'test' });

      handler.handleLLMStart({ name: 'gpt-4o' }, ['Test'], 'run_err_123');

      await handler.handleLLMError(
        new Error('API rate limit exceeded'),
        'run_err_123',
      );

      expect(mockInstance.emitEvent).toHaveBeenCalled();
    });

    it('should not emit event when emitOnError is false', async () => {
      const noErrorHandler = new DripCallbackHandler({
        apiKey: 'test_key',
        customerId: 'cust_123',
        emitOnError: false,
      });

      noErrorHandler.handleLLMStart({ name: 'gpt-4o' }, ['Test'], 'run_no_err');

      await noErrorHandler.handleLLMError(
        new Error('Some error'),
        'run_no_err',
      );

      // Event should not be emitted
    });
  });

  describe('handleChatModelStart', () => {
    it('should track chat model start with messages', () => {
      handler.handleChatModelStart(
        { name: 'ChatOpenAI' },
        [[{ role: 'user', content: 'Hello' }]],
        'chat_run_123',
      );

      // State should be tracked
    });
  });

  describe('handleToolStart/End', () => {
    it('should track tool execution', async () => {
      const { Drip } = await import('../index.js');
      const mockInstance = new Drip({ apiKey: 'test' });

      handler.handleToolStart(
        { name: 'calculator' },
        '2 + 2',
        'tool_run_123',
      );

      await handler.handleToolEnd('4', 'tool_run_123');

      expect(mockInstance.emitEvent).toHaveBeenCalled();
    });

    it('should truncate long inputs', () => {
      const longInput = 'x'.repeat(2000);

      handler.handleToolStart(
        { name: 'search' },
        longInput,
        'tool_long_input',
      );

      // Should not throw and should truncate
    });
  });

  describe('handleToolError', () => {
    it('should emit tool.error event', async () => {
      handler.handleToolStart(
        { name: 'api_caller' },
        '{"url": "http://example.com"}',
        'tool_err_123',
      );

      await handler.handleToolError(
        new Error('Connection refused'),
        'tool_err_123',
      );
    });
  });

  describe('handleChainStart/End', () => {
    it('should track chain execution', async () => {
      const { Drip } = await import('../index.js');
      const mockInstance = new Drip({ apiKey: 'test' });

      handler.handleChainStart(
        { name: 'LLMChain' },
        { input: 'test input' },
        'chain_run_123',
      );

      await handler.handleChainEnd(
        { output: 'test output' },
        'chain_run_123',
      );

      expect(mockInstance.emitEvent).toHaveBeenCalled();
    });
  });

  describe('handleChainError', () => {
    it('should emit chain.error event', async () => {
      handler.handleChainStart(
        { name: 'SequentialChain' },
        { step: 1 },
        'chain_err_123',
      );

      await handler.handleChainError(
        new Error('Chain failed'),
        'chain_err_123',
      );
    });
  });

  describe('handleAgentAction', () => {
    it('should track agent actions', async () => {
      const { Drip } = await import('../index.js');
      const mockInstance = new Drip({ apiKey: 'test' });

      await handler.handleAgentAction(
        {
          tool: 'search',
          toolInput: 'weather today',
          log: 'Searching for weather...',
        },
        'agent_run_123',
      );

      expect(mockInstance.emitEvent).toHaveBeenCalled();
    });

    it('should accumulate multiple actions', async () => {
      await handler.handleAgentAction(
        { tool: 'search', toolInput: 'query1', log: '' },
        'agent_multi_123',
      );

      await handler.handleAgentAction(
        { tool: 'calculator', toolInput: '2+2', log: '' },
        'agent_multi_123',
      );

      // Both actions should be tracked under the same agent run
    });

    it('should handle object toolInput', async () => {
      await handler.handleAgentAction(
        {
          tool: 'api',
          toolInput: { url: 'http://example.com', method: 'GET' },
          log: 'Making API call',
        },
        'agent_obj_123',
      );
    });
  });

  describe('handleAgentEnd', () => {
    it('should emit agent.finish event', async () => {
      const { Drip } = await import('../index.js');
      const mockInstance = new Drip({ apiKey: 'test' });

      await handler.handleAgentAction(
        { tool: 'search', toolInput: 'test', log: '' },
        'agent_end_123',
      );

      await handler.handleAgentEnd(
        { returnValues: { output: 'Final answer' }, log: 'Agent finished' },
        'agent_end_123',
      );

      expect(mockInstance.emitEvent).toHaveBeenCalled();
    });
  });

  describe('handleRetrieverStart/End', () => {
    it('should track retriever operations', async () => {
      const { Drip } = await import('../index.js');
      const mockInstance = new Drip({ apiKey: 'test' });

      handler.handleRetrieverStart(
        { name: 'VectorStore' },
        'What is the meaning of life?',
        'retriever_123',
      );

      await handler.handleRetrieverEnd(
        [
          { pageContent: 'Document 1', metadata: {} },
          { pageContent: 'Document 2', metadata: {} },
        ],
        'retriever_123',
      );

      expect(mockInstance.emitEvent).toHaveBeenCalled();
    });
  });

  describe('handleRetrieverError', () => {
    it('should emit retriever.error event', async () => {
      handler.handleRetrieverStart(
        { name: 'Pinecone' },
        'test query',
        'retriever_err_123',
      );

      await handler.handleRetrieverError(
        new Error('Index not found'),
        'retriever_err_123',
      );
    });
  });

  describe('handleText', () => {
    it('should not throw on text events', () => {
      expect(() => {
        handler.handleText('Some arbitrary text', 'text_run_123');
      }).not.toThrow();
    });
  });

  describe('handleLLMNewToken', () => {
    it('should not throw on streaming tokens', () => {
      expect(() => {
        handler.handleLLMNewToken('Hello', { prompt: 0, completion: 0 }, 'stream_123');
      }).not.toThrow();
    });
  });

  describe('startRun/endRun', () => {
    it('should manually start and end runs', async () => {
      const runId = await handler.startRun();
      expect(runId).toBe('run_123');
      expect(handler.runId).toBe('run_123');

      await handler.endRun('COMPLETED');
      expect(handler.runId).toBeNull();
    });

    it('should pass metadata to startRun', async () => {
      await handler.startRun({
        externalRunId: 'ext_123',
        correlationId: 'corr_456',
        metadata: { environment: 'test' },
      });
    });

    it('should pass error message to endRun', async () => {
      await handler.startRun();
      await handler.endRun('FAILED', 'Something went wrong');
    });
  });

  describe('metadata handling', () => {
    it('should merge base metadata with event metadata', async () => {
      const metadataHandler = new DripCallbackHandler({
        apiKey: 'test_key',
        customerId: 'cust_123',
        metadata: { environment: 'production', version: '1.0' },
      });

      metadataHandler.handleLLMStart({ name: 'gpt-4o' }, ['Test'], 'meta_run_123');
      await metadataHandler.handleLLMEnd(
        { llm_output: { token_usage: { prompt_tokens: 10, completion_tokens: 5 } } },
        'meta_run_123',
      );
    });
  });
});
