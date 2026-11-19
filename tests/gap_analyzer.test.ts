import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ASTNodeSchema, GapAnalysisReportSchema } from '../src/schemas.js';

// Mock the AI client and prompts
vi.mock('../src/client/ai_client.js', () => ({
  generateStructuredOutput: vi.fn(),
}));

vi.mock('../src/client/prompts.js', () => ({
  SYSTEM_PROMPT_AUDITOR: 'AUDITOR_PROMPT',
  buildAuditPrompt: vi.fn((astJson, brief) => `AUDIT_PROMPT:${astJson}:${brief}`),
}));

import { analyzeCodeGaps, extractTargetSubgraphs } from '../src/ingestion/gap_analyzer.js';
import { generateStructuredOutput } from '../src/client/ai_client.js';
import { buildAuditPrompt } from '../src/client/prompts.js';

describe('gap_analyzer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create a minimal valid ASTNode for testing
  const createMockAst = (overrides: Partial<Record<string, unknown>> = {}): any => ({
    id: 'node_1',
    type: 'ModuleContainer',
    moduleName: 'test',
    exports: [],
    children: [
      {
        id: 'node_2',
        type: 'AsyncFunctionBlock',
        functionName: 'testFn',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [
          {
            id: 'node_3',
            type: 'ExpressionBlock',
            codeSnippet: 'console.log("hello")',
          },
        ],
      },
    ],
    ...overrides,
  });

  describe('analyzeCodeGaps', () => {
    it('calls generateStructuredOutput with correct parameters', async () => {
      const mockAst = createMockAst();
      const mockReport = {
        actions: [
          {
            targetNodeId: 'node_2',
            resolution: 'MUTATE_EXISTING' as const,
            reasoning: 'Need to add new parameter',
            specificationForMutation: 'Add wallet parameter',
          },
        ],
      };

      (generateStructuredOutput as any).mockResolvedValue(mockReport);

      const result = await analyzeCodeGaps(mockAst, 'Add wallet support', undefined);

      expect(buildAuditPrompt).toHaveBeenCalledWith(
        JSON.stringify(mockAst, null, 2),
        'Add wallet support'
      );
      expect(generateStructuredOutput).toHaveBeenCalledWith({
        systemInstruction: 'AUDITOR_PROMPT',
        userPrompt: expect.stringContaining('AUDIT_PROMPT:'),
        schema: GapAnalysisReportSchema,
        clientOverride: undefined,
      });
      expect(result).toEqual(mockReport);
    });

    it('throws when targetNodeId does not exist in AST', async () => {
      const mockAst = createMockAst();
      const mockReport = {
        actions: [
          {
            targetNodeId: 'nonexistent_node',
            resolution: 'MUTATE_EXISTING' as const,
            reasoning: 'Test',
          },
        ],
      };

      (generateStructuredOutput as any).mockResolvedValue(mockReport);

      await expect(analyzeCodeGaps(mockAst, 'Test brief')).rejects.toThrow(
        'Gap analysis returned invalid targetNodeId: "nonexistent_node"'
      );
    });

    it('passes clientOverride to generateStructuredOutput', async () => {
      const mockAst = createMockAst();
      const mockReport = { actions: [] };
      const mockClient = { custom: 'client' };

      (generateStructuredOutput as any).mockResolvedValue(mockReport);

      await analyzeCodeGaps(mockAst, 'Test', mockClient);

      expect(generateStructuredOutput).toHaveBeenCalledWith(
        expect.objectContaining({ clientOverride: mockClient })
      );
    });

    it('accepts KEEP_AS_IS and SPAWN_NEW resolutions without error', async () => {
      const mockAst = createMockAst();
      const mockReport = {
        actions: [
          { targetNodeId: 'node_1', resolution: 'KEEP_AS_IS' as const, reasoning: 'OK' },
          { targetNodeId: 'node_2', resolution: 'SPAWN_NEW' as const, reasoning: 'New feature' },
        ],
      };

      (generateStructuredOutput as any).mockResolvedValue(mockReport);

      const result = await analyzeCodeGaps(mockAst, 'Test');
      expect(result.actions).toHaveLength(2);
    });
  });

  describe('extractTargetSubgraphs', () => {
    it('returns empty map when no MUTATE_EXISTING actions', () => {
      const mockAst = createMockAst();
      const report = {
        actions: [
          { targetNodeId: 'node_1', resolution: 'KEEP_AS_IS' as const, reasoning: 'OK' },
          { targetNodeId: 'node_2', resolution: 'SPAWN_NEW' as const, reasoning: 'New' },
        ],
      };

      const result = extractTargetSubgraphs(mockAst, report);
      expect(result.size).toBe(0);
    });

    it('extracts subgraph for MUTATE_EXISTING action', () => {
      const mockAst = createMockAst();
      const report = {
        actions: [
          {
            targetNodeId: 'node_2',
            resolution: 'MUTATE_EXISTING' as const,
            reasoning: 'Modify function',
            specificationForMutation: 'Add param',
          },
        ],
      };

      const result = extractTargetSubgraphs(mockAst, report);
      expect(result.size).toBe(1);
      expect(result.has('node_2')).toBe(true);
      expect(result.get('node_2')?.id).toBe('node_2');
      expect(result.get('node_2')?.type).toBe('AsyncFunctionBlock');
    });

    it('extracts nested subgraph (ExpressionBlock inside function)', () => {
      const mockAst = createMockAst();
      const report = {
        actions: [
          {
            targetNodeId: 'node_3',
            resolution: 'MUTATE_EXISTING' as const,
            reasoning: 'Modify expression',
          },
        ],
      };

      const result = extractTargetSubgraphs(mockAst, report);
      expect(result.size).toBe(1);
      expect(result.get('node_3')?.id).toBe('node_3');
      expect(result.get('node_3')?.type).toBe('ExpressionBlock');
    });

    it('throws when MUTATE_EXISTING targetNodeId not found', () => {
      const mockAst = createMockAst();
      const report = {
        actions: [
          {
            targetNodeId: 'missing_node',
            resolution: 'MUTATE_EXISTING' as const,
            reasoning: 'Test',
          },
        ],
      };

      expect(() => extractTargetSubgraphs(mockAst, report)).toThrow(
        'Could not find node with id "missing_node" for MUTATE_EXISTING action.'
      );
    });

    it('handles TryCatchGuardian with try and catch branches', () => {
      const mockAst = {
        id: 'node_1',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'node_2',
            type: 'TryCatchGuardian',
            tryBranch: [
              { id: 'node_3', type: 'ExpressionBlock', codeSnippet: 'tryCode()' },
            ],
            catchBranch: [
              { id: 'node_4', type: 'ExpressionBlock', codeSnippet: 'catchCode()' },
            ],
            errorVariableName: 'err',
          },
        ],
      };

      const report = {
        actions: [
          { targetNodeId: 'node_3', resolution: 'MUTATE_EXISTING' as const, reasoning: 'Test' },
          { targetNodeId: 'node_4', resolution: 'MUTATE_EXISTING' as const, reasoning: 'Test' },
        ],
      };

      const result = extractTargetSubgraphs(mockAst, report);
      expect(result.size).toBe(2);
      expect(result.get('node_3')?.id).toBe('node_3');
      expect(result.get('node_4')?.id).toBe('node_4');
    });

    it('handles ConditionalBranch with true and false branches', () => {
      const mockAst = {
        id: 'node_1',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'node_2',
            type: 'ConditionalBranch',
            conditionExpression: 'x > 0',
            trueBranch: [
              { id: 'node_3', type: 'ExpressionBlock', codeSnippet: 'trueBranch()' },
            ],
            falseBranch: [
              { id: 'node_4', type: 'ExpressionBlock', codeSnippet: 'falseBranch()' },
            ],
          },
        ],
      };

      const report = {
        actions: [
          { targetNodeId: 'node_3', resolution: 'MUTATE_EXISTING' as const, reasoning: 'Test' },
          { targetNodeId: 'node_4', resolution: 'MUTATE_EXISTING' as const, reasoning: 'Test' },
        ],
      };

      const result = extractTargetSubgraphs(mockAst, report);
      expect(result.size).toBe(2);
    });

    it('handles LoopInterval body', () => {
      const mockAst = {
        id: 'node_1',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'node_2',
            type: 'LoopInterval',
            loopType: 'while',
            loopHeader: 'true',
            body: [
              { id: 'node_3', type: 'ExpressionBlock', codeSnippet: 'loopBody()' },
            ],
          },
        ],
      };

      const report = {
        actions: [
          { targetNodeId: 'node_3', resolution: 'MUTATE_EXISTING' as const, reasoning: 'Test' },
        ],
      };

      const result = extractTargetSubgraphs(mockAst, report);
      expect(result.size).toBe(1);
      expect(result.get('node_3')?.id).toBe('node_3');
    });

    it('handles Solana_ListenPumpFun callbackBody', () => {
      const mockAst = {
        id: 'node_1',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'node_2',
            type: 'Solana_ListenPumpFun',
            connectionVarName: 'conn',
            programAddress: 'addr',
            accountInfoParamName: 'info',
            callbackBody: [
              { id: 'node_3', type: 'ExpressionBlock', codeSnippet: 'callback()' },
            ],
          },
        ],
      };

      const report = {
        actions: [
          { targetNodeId: 'node_3', resolution: 'MUTATE_EXISTING' as const, reasoning: 'Test' },
        ],
      };

      const result = extractTargetSubgraphs(mockAst, report);
      expect(result.size).toBe(1);
      expect(result.get('node_3')?.id).toBe('node_3');
    });
  });
});
