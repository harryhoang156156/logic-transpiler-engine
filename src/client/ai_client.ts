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

  let baseURL =
    effectiveEnv.BIFROST_BASE_URL ??
    effectiveEnv.OPENAI_API_BASE ??
    'http://localhost:8080/openai/v1';

  if (!baseURL.endsWith('/v1')) {
    baseURL = baseURL.replace(/\/+$/, '') + '/v1';
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

  const jsonSchema = zodToJsonSchema(schema);

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
  return schema.parse(parsed);
}

export async function requestAstGeneration(
  brief: string,
  contextJson?: string,
  clientOverride?: any
): Promise<ASTNode> {
  const userPrompt = buildGenerationPrompt(brief, contextJson);
  return generateStructuredOutput<ASTNode>({
    systemInstruction: SYSTEM_PROMPT_GENERATOR,
    userPrompt,
    schema: ASTNodeSchema,
    clientOverride,
  });
}

export async function requestAstCorrection(
  brokenAst: ASTNode,
  errors: string[],
  clientOverride?: any
): Promise<ASTNode> {
  const brokenAstJson = JSON.stringify(brokenAst, null, 2);
  const userPrompt = buildCorrectionPrompt(brokenAstJson, errors);
  return generateStructuredOutput<ASTNode>({
    systemInstruction: SYSTEM_PROMPT_DEBUGGER,
    userPrompt,
    schema: ASTNodeSchema,
    clientOverride,
  });
}
