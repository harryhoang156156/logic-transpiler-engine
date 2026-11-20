import { config as dotenvConfig } from 'dotenv';
import { OpenAI } from 'openai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ASTNodeSchema, ASTNode } from '../schemas.js';
import {
  SYSTEM_PROMPT_GENERATOR,
  SYSTEM_PROMPT_DEBUGGER,
  buildGenerationPrompt,
  buildCorrectionPrompt,
} from './prompts.js';

dotenvConfig();

export interface BifrostConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

export function resolveBifrostConfig(
  env?: Record<string, string | undefined>
): BifrostConfig {
  const effectiveEnv = env ?? process.env;

  let baseURL = (
    effectiveEnv.BIFROST_BASE_URL ??
    effectiveEnv.OPENAI_API_BASE ??
    'http://localhost:8080/openai/v1'
  ).replace(/\/+$/, '');

  if (!baseURL.endsWith('/v1')) {
    baseURL = baseURL + '/v1';
  }

  const apiKey =
    effectiveEnv.BIFROST_API_KEY ??
    effectiveEnv.OPENAI_API_KEY ??
    'bifrost-local';

  const model = effectiveEnv.LLM_MODEL ?? effectiveEnv.BIFROST_MODEL ?? '';

  return { baseURL, apiKey, model };
}

function createOpenAIClient(baseURL: string, apiKey: string): OpenAI {
  const defaultHeaders: Record<string, string> = {};
  if (apiKey.startsWith('sk-bf-')) {
    defaultHeaders['x-bf-vk'] = apiKey;
  }
  return new OpenAI({ apiKey, baseURL, defaultHeaders });
}

/**
 * Recursively rewrites a JSON Schema so it satisfies OpenAI Structured Outputs
 * requirements: every object lists all of its properties in `required`,
 * disallows additional properties, and optional properties are expressed as
 * nullable so the model can emit `null` for them.
 */
function enforceStrictJsonSchema(node: any): any {
  if (Array.isArray(node)) {
    return node.map(enforceStrictJsonSchema);
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object') {
      const props: Record<string, any> = {};
      for (const [propName, propSchema] of Object.entries(
        value as Record<string, any>
      )) {
        props[propName] = enforceStrictJsonSchema(propSchema);
      }
      result.properties = props;
    } else if (key === 'definitions' || key === '$defs') {
      const defs: Record<string, any> = {};
      for (const [defName, defSchema] of Object.entries(
        value as Record<string, any>
      )) {
        defs[defName] = enforceStrictJsonSchema(defSchema);
      }
      result[key] = defs;
    } else if (
      key === 'items' ||
      key === 'additionalProperties' ||
      key === 'anyOf' ||
      key === 'oneOf' ||
      key === 'allOf' ||
      key === 'not'
    ) {
      result[key] = enforceStrictJsonSchema(value);
    } else {
      result[key] = value;
    }
  }

  if (result.properties && typeof result.properties === 'object') {
    const originalRequired: string[] = Array.isArray(result.required)
      ? result.required
      : [];
    const allKeys = Object.keys(result.properties);
    const strictProps: Record<string, any> = {};
    for (const key of allKeys) {
      const propSchema = result.properties[key];
      if (originalRequired.includes(key)) {
        strictProps[key] = propSchema;
      } else {
        strictProps[key] = { anyOf: [propSchema, { type: 'null' }] };
      }
    }
    result.properties = strictProps;
    result.required = allKeys;
    result.additionalProperties = false;
  }

  return result;
}

function toStrictJsonSchema(schema: z.ZodType<any>): Record<string, any> {
  const jsonSchema = zodToJsonSchema(schema, { $refStrategy: 'root' });
  return enforceStrictJsonSchema(jsonSchema) as Record<string, any>;
}

/**
 * Recursively removes `null` values from parsed LLM output so that optional
 * fields (which the strict JSON schema allows to be null) fall back to the
 * runtime Zod schema's defaults instead of failing validation.
 */
function stripNulls(value: any): any {
  if (Array.isArray(value)) {
    return value.map(stripNulls);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === null) {
        continue;
      }
      result[key] = stripNulls(val);
    }
    return result;
  }
  return value;
}

export async function generateStructuredOutput<T>({
  systemInstruction,
  userPrompt,
  schema,
  modelOverride,
  clientOverride,
}: {
  systemInstruction: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  modelOverride?: string;
  clientOverride?: any;
}): Promise<T> {
  const { baseURL, apiKey, model } = resolveBifrostConfig();
  const finalModel = modelOverride ?? model;

  if (!finalModel && !clientOverride) {
    throw new Error(
      'LLM_MODEL or BIFROST_MODEL must be set in environment variables.'
    );
  }

  const client = clientOverride ?? createOpenAIClient(baseURL, apiKey);

  const jsonSchema = toStrictJsonSchema(schema);

  const response = await client.chat.completions.create({
    model: finalModel,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userPrompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'ast_output',
        schema: jsonSchema,
        strict: true,
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned empty response content.');
  }

  const parsed = JSON.parse(content);
  return schema.parse(stripNulls(parsed));
}

const AstEnvelopeSchema = z.object({ ast: ASTNodeSchema });

export async function requestAstGeneration(
  brief: string,
  contextJson?: string,
  clientOverride?: any
): Promise<ASTNode> {
  const userPrompt = buildGenerationPrompt(brief, contextJson);
  const envelope = await generateStructuredOutput<{ ast: ASTNode }>({
    systemInstruction: SYSTEM_PROMPT_GENERATOR,
    userPrompt,
    schema: AstEnvelopeSchema,
    clientOverride,
  });
  return envelope.ast;
}

export async function requestAstCorrection(
  brokenAst: ASTNode,
  errors: string[],
  clientOverride?: any
): Promise<ASTNode> {
  const brokenAstJson = JSON.stringify(brokenAst, null, 2);
  const userPrompt = buildCorrectionPrompt(brokenAstJson, errors);
  const envelope = await generateStructuredOutput<{ ast: ASTNode }>({
    systemInstruction: SYSTEM_PROMPT_DEBUGGER,
    userPrompt,
    schema: AstEnvelopeSchema,
    clientOverride,
  });
  return envelope.ast;
}
