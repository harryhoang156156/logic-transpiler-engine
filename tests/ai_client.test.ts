import { describe, it, expect, vi } from 'vitest';
import { ASTNodeSchema } from '../src/schemas.js';
import {
  generateStructuredOutput,
  requestAstGeneration,
  requestAstCorrection,
} from '../src/client/ai_client.js';

const mockCreate = vi.fn();
const mockClient = {
  chat: {
    completions: {
      create: mockCreate,
    },
  },
};

describe('ai_client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requestAstGeneration passes expected parameters and validates response', async () => {
    const brief = 'Create a Solana connection';
    const contextJson = '[]';
    const validAst = {
      id: 'root',
      type: 'ModuleContainer',
      moduleName: 'main',
      exports: [],
      children: [],
    };

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(validAst) } }],
    });

    const result = await requestAstGeneration(brief, contextJson, mockClient);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('kilo-auto/free');
    expect(callArgs.messages).toEqual([
      { role: 'system', content: expect.any(String) },
      { role: 'user', content: expect.stringContaining(brief) },
    ]);
    expect(callArgs.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'ast_output',
        schema: expect.any(Object),
        strict: true,
      },
    });

    const parseResult = ASTNodeSchema.safeParse(result);
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data).toEqual(validAst);
    }
  });

  it('generateStructuredOutput throws on invalid JSON', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: 'not valid json' } }],
    });

    await expect(
      generateStructuredOutput({
        systemInstruction: 'sys',
        userPrompt: 'user',
        schema: ASTNodeSchema,
        clientOverride: mockClient,
      }),
    ).rejects.toThrow();
  });

  it('generateStructuredOutput throws on schema-violating data', async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ id: 123 }) } }],
    });

    await expect(
      generateStructuredOutput({
        systemInstruction: 'sys',
        userPrompt: 'user',
        schema: ASTNodeSchema,
        clientOverride: mockClient,
      }),
    ).rejects.toThrow();
  });

  it('requestAstCorrection uses debugger prompt and validates response', async () => {
    const brokenAst = {
      id: 'broken-1',
      type: 'ModuleContainer',
      moduleName: 'test',
      exports: [],
      children: [],
    };
    const errors = ['syntax error'];
    const validAst = {
      id: 'root',
      type: 'ModuleContainer',
      moduleName: 'm',
      exports: [],
      children: [],
    };

    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(validAst) } }],
    });

    const result = await requestAstCorrection(brokenAst, errors, mockClient);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].role).toBe('system');
    expect(callArgs.messages[1].content).toContain('Broken AST');
    expect(callArgs.messages[1].content).toContain('Compiler Errors');

    const parseResult = ASTNodeSchema.safeParse(result);
    expect(parseResult.success).toBe(true);
  });
});
