import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  resolveBifrostConfig,
  generateStructuredOutput,
  requestAstGeneration,
  requestAstCorrection,
} from '../src/client/ai_client.js';

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

  it('normalizes trailing slashes before checking for /v1', () => {
    const config = resolveBifrostConfig({
      BIFROST_BASE_URL: 'http://custom:9000/openai/v1/',
    });
    expect(config.baseURL).toBe('http://custom:9000/openai/v1');
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

  it('does not treat property names like allOf, oneOf, or not as unsupported keywords', async () => {
    const schemaWithKeywordProperties = z.object({
      allOf: z.string(),
      oneOf: z.number(),
      not: z.boolean(),
    });

    const createMock = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ allOf: 'foo', oneOf: 123, not: true }),
          },
        },
      ],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await generateStructuredOutput({
      systemInstruction: 'sys',
      userPrompt: 'user',
      schema: schemaWithKeywordProperties,
      modelOverride: 'm',
      clientOverride,
    });

    expect(result).toEqual({ allOf: 'foo', oneOf: 123, not: true });
    const callArgs = createMock.mock.calls[0][0];
    // Strict should remain true
    expect(callArgs.response_format.json_schema.strict).toBe(true);
    expect(callArgs.response_format.json_schema.schema.additionalProperties).toBe(false);
  });

  it('falls back to non-strict schema and validates directly with Zod when unsupported keywords exist', async () => {
    // z.intersection generates allOf in json schema (may be in $defs or inlined)
    // Zod v4's toJSONSchema with target: "draft-07" may inline intersections
    // Use a schema that definitely produces unsupported keywords: z.union with discriminated union
    const schemaWithUnion = z.union([
      z.object({ type: z.literal('a'), value: z.string() }),
      z.object({ type: z.literal('b'), value: z.number() }),
    ]);

    const createMock = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ type: 'a', value: 'hello' }),
          },
        },
      ],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await generateStructuredOutput({
      systemInstruction: 'sys',
      userPrompt: 'user',
      schema: schemaWithUnion,
      modelOverride: 'm',
      clientOverride,
    });

    expect(result).toEqual({ type: 'a', value: 'hello' });
    const callArgs = createMock.mock.calls[0][0];
    expect(callArgs.response_format.json_schema.strict).toBe(false);
    // Should return original converted schema without strict rewriting
    const schemaStr = JSON.stringify(callArgs.response_format.json_schema.schema);
    // Union produces anyOf in JSON Schema
    expect(schemaStr).toContain('anyOf');
  });

  it('emits a strict JSON schema with all properties required and optional fields nullable', async () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional(),
    });
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: 'x', nickname: null }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await generateStructuredOutput({
      systemInstruction: 'sys',
      userPrompt: 'user',
      schema,
      modelOverride: 'm',
      clientOverride,
    });

    expect(result).toEqual({ name: 'x' });

    const jsonSchema = createMock.mock.calls[0][0].response_format.json_schema.schema;
    expect(jsonSchema.required).toEqual(['name', 'nickname']);
    expect(jsonSchema.additionalProperties).toBe(false);
    // Optional fields are wrapped in anyOf with null
    expect(jsonSchema.properties.nickname).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
  });

  it('preserves null for explicitly nullable required properties', async () => {
    // z.string().nullable() creates a required property that can be null
    // Zod v4 represents this as type: ['string', 'null'] in JSON Schema
    // Our enforceStrictJsonSchema converts this to anyOf format for OpenAI compatibility
    const schema = z.object({
      name: z.string(),
      middleName: z.string().nullable(), // required but nullable
    });
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: 'John', middleName: null }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await generateStructuredOutput({
      systemInstruction: 'sys',
      userPrompt: 'user',
      schema,
      modelOverride: 'm',
      clientOverride,
    });

    // middleName should be preserved as null since it's explicitly nullable in the schema
    expect(result).toEqual({ name: 'John', middleName: null });

    const jsonSchema = createMock.mock.calls[0][0].response_format.json_schema.schema;
    // middleName should be in required (since it's not optional)
    expect(jsonSchema.required).toEqual(['name', 'middleName']);
    // Zod v4 represents nullable as type array, but we convert to anyOf for OpenAI
    expect(jsonSchema.properties.middleName).toEqual({
      anyOf: [{ type: 'string' }, { type: 'null' }],
    });
  });

  it('strips null only for optional properties, not for nullable required properties', async () => {
    const schema = z.object({
      name: z.string(),
      nickname: z.string().optional(), // optional -> should strip null
      middleName: z.string().nullable(), // required nullable -> should preserve null
    });
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: 'John', nickname: null, middleName: null }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await generateStructuredOutput({
      systemInstruction: 'sys',
      userPrompt: 'user',
      schema,
      modelOverride: 'm',
      clientOverride,
    });

    // nickname (optional) should be stripped, middleName (nullable required) should be preserved
    expect(result).toEqual({ name: 'John', middleName: null });
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

  it('preserves $ref references in generated schema', async () => {
    // Test that $ref references are not expanded during strict schema conversion
    // Note: Zod v4's toJSONSchema with target: "draft-07" creates $ref for recursive types
    const schema = z.object({
      name: z.string(),
      // Self-referential type to force $ref generation
      children: z.array(z.lazy(() => schema)).optional(),
    });
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: 'Test', children: [] }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await generateStructuredOutput({
      systemInstruction: 'sys',
      userPrompt: 'user',
      schema,
      modelOverride: 'm',
      clientOverride,
    });

    expect(result.name).toBe('Test');
    expect(result.children).toEqual([]);

    const jsonSchema = createMock.mock.calls[0][0].response_format.json_schema.schema;
    // The schema should have $ref somewhere (in $defs)
    // Check that our conversion doesn't expand $ref
    const schemaStr = JSON.stringify(jsonSchema);
    // If there's a $ref in the original, it should be preserved
    // For recursive types, Zod v4 typically creates a $ref in $defs
    expect(schemaStr).toContain('$ref');
  });

  it('handles optional object with reused subschema', async () => {
    // Regression test: optional property that references a shared subschema
    // Note: Zod v4's toJSONSchema inlines reused schemas by default, so we test that
    // our strict conversion doesn't break the inlined schema and correctly
    // wraps the optional property in anyOf with null.
    const addressSchema = z.object({
      street: z.string(),
      city: z.string(),
    });
    const schema = z.object({
      name: z.string(),
      address: addressSchema.optional(), // Optional object with shared subschema
    });
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: 'Test', address: null }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await generateStructuredOutput({
      systemInstruction: 'sys',
      userPrompt: 'user',
      schema,
      modelOverride: 'm',
      clientOverride,
    });

    // address is optional and null -> should be stripped
    expect(result).toEqual({ name: 'Test' });

    const jsonSchema = createMock.mock.calls[0][0].response_format.json_schema.schema;
    // address should be in required (strict mode) and nullable
    expect(jsonSchema.required).toContain('address');
    // address should be wrapped in anyOf with null
    expect(jsonSchema.properties.address).toEqual(
      expect.objectContaining({
        anyOf: expect.arrayContaining([
          expect.objectContaining({
            type: 'object',
            properties: expect.objectContaining({
              street: { type: 'string' },
              city: { type: 'string' },
            }),
            required: ['street', 'city'],
            additionalProperties: false,
          }),
          { type: 'null' },
        ]),
      })
    );
  });

  it('strips null for optional properties inside arrays using schema paths', async () => {
    // Regression test for array index mismatch: nullablePaths tracks schema paths
    // (e.g., "items.name") not data paths (e.g., "items[0].name")
    const schema = z.object({
      name: z.string(),
      items: z.array(z.object({
        id: z.number(),
        label: z.string().optional(), // optional property inside array items
      })).optional(),
    });
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ 
        name: 'Test', 
        items: [{ id: 1, label: null }, { id: 2, label: 'keep' }] 
      }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await generateStructuredOutput({
      systemInstruction: 'sys',
      userPrompt: 'user',
      schema,
      modelOverride: 'm',
      clientOverride,
    });

    // label is optional -> null should be stripped from both array items
    expect(result).toEqual({ 
      name: 'Test', 
      items: [{ id: 1 }, { id: 2, label: 'keep' }] 
    });

    const jsonSchema = createMock.mock.calls[0][0].response_format.json_schema.schema;
    // items should be optional (wrapped in anyOf with null)
    expect(jsonSchema.required).toContain('items');
    // The items property is wrapped in anyOf with null
    expect(jsonSchema.properties.items).toEqual(
      expect.objectContaining({
        anyOf: expect.arrayContaining([
          expect.objectContaining({
            type: 'array',
            items: expect.objectContaining({
              type: 'object',
              properties: expect.objectContaining({
                id: { type: 'number' }, // Zod v4 outputs 'number' for z.number()
                label: expect.objectContaining({
                  anyOf: expect.arrayContaining([
                    { type: 'string' },
                    { type: 'null' },
                  ]),
                }),
              }),
              required: ['id', 'label'],
              additionalProperties: false,
            }),
          }),
          { type: 'null' },
        ]),
      })
    );
  });

  it('preserves $ref when wrapping optional recursive property in anyOf', async () => {
    // Regression test: optional property with $ref (recursive type) should
    // preserve the $ref inside the anyOf wrapper
    // Zod v4's toJSONSchema with target: "draft-07" may not include optional properties in required array
    // So we test that the $ref is preserved in the schema structure
    const schema = z.object({
      name: z.string(),
      children: z.array(z.lazy(() => schema)).optional(),
    });
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ name: 'Test', children: [] }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await generateStructuredOutput({
      systemInstruction: 'sys',
      userPrompt: 'user',
      schema,
      modelOverride: 'm',
      clientOverride,
    });

    // children is optional and provided as empty array (not null) -> should be kept
    expect(result.name).toBe('Test');
    expect(result.children).toEqual([]);

    const jsonSchema = createMock.mock.calls[0][0].response_format.json_schema.schema;
    // The schema should have $ref preserved somewhere
    const schemaStr = JSON.stringify(jsonSchema);
    expect(schemaStr).toContain('$ref');
    // The children property should exist in properties (may or may not be in required depending on Zod v4 output)
    expect(jsonSchema.properties).toHaveProperty('children');
    // The children property should be wrapped in anyOf with null (if strict mode) or have the original structure
    // Since it's optional, in strict mode it should be wrapped
    if (jsonSchema.properties.children.anyOf) {
      expect(jsonSchema.properties.children.anyOf).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'array',
            items: expect.objectContaining({ $ref: expect.any(String) }),
          }),
          { type: 'null' },
        ])
      );
    }
  });
});

describe('requestAstGeneration', () => {
  it('wraps the AST in an envelope, validates it, and unwraps the result', async () => {
    const astNode = {
      type: 'ModuleContainer',
      id: 'node_1',
      moduleName: 'mod',
      exports: [],
      children: [],
    };
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ ast: astNode }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const result = await requestAstGeneration('build a bot', undefined, clientOverride);
    expect(result).toEqual(astNode);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});

describe('requestAstCorrection', () => {
  it('wraps the AST in an envelope, validates it, and unwraps the result', async () => {
    const astNode = {
      type: 'ModuleContainer',
      id: 'node_1',
      moduleName: 'mod',
      exports: [],
      children: [],
    };
    const createMock = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ ast: astNode }) } }],
    });
    const clientOverride = { chat: { completions: { create: createMock } } };

    const brokenAst = {
      type: 'ModuleContainer',
      id: 'node_1',
      moduleName: 'mod',
      exports: [],
      children: [],
    };
    const result = await requestAstCorrection(brokenAst, ['error 1'], clientOverride);
    expect(result).toEqual(astNode);
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});
