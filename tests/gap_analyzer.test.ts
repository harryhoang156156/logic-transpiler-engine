import { describe, it, expect } from 'vitest';
import { analyzeCodeGaps, extractTargetSubgraphs } from '../src/ingestion/gap_analyzer.js';
import { ASTNode } from '../src/schemas.js';

describe('gap_analyzer', () => {
  const sampleAst: ASTNode = {
    type: 'ModuleContainer',
    id: 'node_1',
    moduleName: 'test_module',
    exports: [],
    children: [
      {
        type: 'AsyncFunctionBlock',
        id: 'node_2',
        functionName: 'testFunc',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [],
      },
    ],
  };

  it('succeeds when valid targetNodeIds are returned', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    actions: [
                      {
                        targetNodeId: 'node_1',
                        resolution: 'KEEP_AS_IS',
                        reasoning: 'Keep module',
                      },
                      {
                        targetNodeId: 'node_2',
                        resolution: 'MUTATE_EXISTING',
                        reasoning: 'Needs update',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        },
      },
    };

    const report = await analyzeCodeGaps(sampleAst, 'Add feature', mockClient);
    expect(report.actions).toHaveLength(2);

    const subgraphs = extractTargetSubgraphs(sampleAst, report);
    expect(subgraphs.size).toBe(1);
    expect(subgraphs.get('node_2')?.id).toBe('node_2');
  });

  it('throws an error when LLM hallucinates a non-existent targetNodeId', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    actions: [
                      {
                        targetNodeId: 'node_1',
                        resolution: 'KEEP_AS_IS',
                        reasoning: 'Keep module',
                      },
                      {
                        targetNodeId: 'node_2',
                        resolution: 'KEEP_AS_IS',
                        reasoning: 'Keep func',
                      },
                      {
                        targetNodeId: 'non_existent',
                        resolution: 'MUTATE_EXISTING',
                        reasoning: 'Bad ID',
                      },
                    ],
                  }),
                },
              },
            ],
          }),
        },
      },
    };

    await expect(analyzeCodeGaps(sampleAst, 'Add feature', mockClient)).rejects.toThrow(
      /hallucinated non-existent targetNodeId/
    );
  });
});
