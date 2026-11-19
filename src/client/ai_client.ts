import OpenAI from 'openai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ASTNode, ASTNodeSchema } from '../schemas.js';
import {
  SYSTEM_PROMPT_GENERATOR,
  SYSTEM_PROMPT_DEBUGGER,
  buildGenerationPrompt,
  buildCorrectionPrompt,
} from './prompts.js';

const BASE_URL = process.env.KILO_BASE_URL ?? 'https://api.kilo.ai/api/gateway';
const MODEL = process.env.LLM_MODEL ?? 'kilo-auto/free';

function resolveClient(clientOverride?: any): OpenAI {
  if (clientOverride) {
    return clientOverride as OpenAI;
  }

  if (!process.env.KILO_API_KEY) {
    throw new Error(
      'KILO_API_KEY is missing. Set it in your environment before making live LLM calls.',
    );
  }

  return new OpenAI({
    apiKey: process.env.KILO_API_KEY,
    baseURL: BASE_URL,
  });
}

export async function generateStructuredOutput<T>({
  systemInstruction,
  userPrompt,
  schema,
  clientOverride,
}: {
  systemInstruction: string;
  userPrompt: string;
  schema: z.ZodType<T>;
  clientOverride?: any;
}): Promise<T> {
  const client = resolveClient(clientOverride);
  const jsonSchema = zodToJsonSchema(schema) as Record<string, unknown>;

  const response = await client.chat.completions.create({
    model: MODEL,
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
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('LLM returned empty response');
  }

  const parsed = JSON.parse(content);
  return schema.parse(parsed);
}

export async function requestAstGeneration(
  brief: string,
  contextJson?: string,
  clientOverride?: any,
): Promise<ASTNode> {
  const userPrompt = buildGenerationPrompt(brief, contextJson);
  return generateStructuredOutput({
    systemInstruction: SYSTEM_PROMPT_GENERATOR,
    userPrompt,
    schema: ASTNodeSchema,
    clientOverride,
  });
}

export async function requestAstCorrection(
  brokenAst: ASTNode,
  errors: string[],
  clientOverride?: any,
): Promise<ASTNode> {
  const brokenAstJson = JSON.stringify(brokenAst, null, 2);
  const userPrompt = buildCorrectionPrompt(brokenAstJson, errors);
  return generateStructuredOutput({
    systemInstruction: SYSTEM_PROMPT_DEBUGGER,
    userPrompt,
    schema: ASTNodeSchema,
    clientOverride,
  });
}
