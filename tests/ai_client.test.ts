import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  resolveBifrostConfig,
  generateStructuredOutput,
  requestAstGeneration,
  requestAstCorrection,
} from '../src/client/ai_client.js';
import { ASTNodeSchema } from '../src/schemas.js';

describe('resolveBifrostConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BIFROST_BASE_URL;
    delete process.env.OPENAI_API_BASE;
    delete process.env.BIFROST_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LLM_MODEL;
    delete process.env.BIFROST_MODEL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses defaults when no env vars are set', () => {
    const config = resolveBifrostConfig();
    expect(config.baseURL).toBe('http://localhost:8080/openai/v1');
    expect(config.apiKey).toBe('bifrost-local');
    expect(config.model).toBe('');
  });

  it('reads custom BIFROST_BASE_URL and appends /v1 if missing', () => {
    const config = resolveBifrostConfig({ BIFROST_BASE_URL: 'http://custom:9000' });
    expect(config.baseURL).toBe('http://custom:9000/v1');
  });

  it('keeps /v1 if already present', () => {
    const config = resolveBifrostConfig({ BIFROST_BASE_URL: 'http://custom:9000/v1' });
    expect(config.baseURL).toBe('http://custom:9000/v1');
  });

  it('reads BIFROST_API_KEY and LLM_MODEL', () => {
    const config = resolveBifrostConfig({
      BIFROST_API_KEY: 'sk-bf-123',
      LLM_MODEL: 'my-model',
    });
    expect(config.apiKey).toBe('sk-bf-123');
    expect(config.model).toBe('my-model');
  });

  it('falls back to OPENAI_API_BASE and OPENAI_API_KEY', () => {
    const config = resolveBifrostConfig({
      OPENAI_API_BASE: 'http://openai:8080',
      OPENAI_API_KEY: 'sk-openai',
      BIFROST_MODEL: 'fallback-model',
    });
    expect(config.baseURL).toBe('http://openai:8080/v1');
    expect(config.apiKey).toBe('sk-openai');
    expect(config.model).toBe('fallback-model');
  });
});

describe('generateStructuredOutput', () => {
  const mockSchema = z.object({ name: z.string(), value: z.number() });

  it('passes expected parameters to the client and validates output', async () => {
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: 'test', value: 42 }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await generateStructuredOutput({
      systemInstruction: 'You are a helper.',
      userPrompt: 'Generate something.',
      schema: mockSchema,
      modelOverride: 'test-model',
      clientOverride,
    });

    expect(result).toEqual({ name: 'test', value: 42 });
    expect(createMock).toHaveBeenCalledTimes(1);
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.model).toBe('test-model');
    expect(callArgs.messages).toEqual([
      { role: 'system', content: 'You are a helper.' },
      { role: 'user', content: 'Generate something.' },
    ]);
    expect(callArgs.response_format).toEqual({
      type: 'json_schema',
      json_schema: {
        name: 'ast_output',
        schema: expect.any(Object),
        strict: true,
      },
    });
  });

  it('throws if the LLM returns invalid JSON', async () => {
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    await expect(
      generateStructuredOutput({
        systemInstruction: 'sys',
        userPrompt: 'user',
        schema: mockSchema,
        clientOverride,
      })
    ).rejects.toThrow();
  });

  it('throws if the LLM returns schema-violating data', async () => {
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: 'test', value: 'not-a-number' }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    await expect(
      generateStructuredOutput({
        systemInstruction: 'sys',
        userPrompt: 'user',
        schema: mockSchema,
        clientOverride,
      })
    ).rejects.toThrow();
  });
});

describe('requestAstGeneration', () => {
  it('calls the LLM client with generator prompts and validates against ASTNodeSchema', async () => {
    const astNode = {
      type: 'ModuleContainer',
      id: 'node_1',
      moduleName: 'mod',
      exports: [],
      children: [],
    };
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(astNode) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await requestAstGeneration('build a bot', undefined, clientOverride);
    expect(result).toEqual(astNode);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe('requestAstCorrection', () => {
  it('calls the LLM client with debugger prompts and validates against ASTNodeSchema', async () => {
    const astNode = {
      type: 'ModuleContainer',
      id: 'node_1',
      moduleName: 'mod',
      exports: [],
      children: [],
    };
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(astNode) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const brokenAst = { type: 'ModuleContainer', id: 'node_1', moduleName: 'mod', exports: [], children: [] };
    const result = await requestAstCorrection(brokenAst, ['error 1'], clientOverride);
    expect(result).toEqual(astNode);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
}
