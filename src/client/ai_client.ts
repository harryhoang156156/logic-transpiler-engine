import OpenAI from 'openai';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { z } from 'zod';
import { ASTNode, ASTNodeSchema } from '../schemas.js';
import { SYSTEM_PROMPT_GENERATOR, SYSTEM_PROMPT_DEBUGGER, buildGenerationPrompt, buildCorrectionPrompt } from './prompts.js';

let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    const apiKey = process.env.KILO_API_KEY;
    if (!apiKey) {
      throw new Error('KILO_API_KEY environment variable is required for live LLM calls');
    }
    const baseURL = process.env.KILO_BASE_URL || 'https://api.kilo.ai/api/gateway';
    openaiClient = new OpenAI({ apiKey, baseURL });
  }
  return openaiClient;
}

export async function generateStructuredOutput<T>(
  options: {
    systemInstruction: string;
    userPrompt: string;
    schema: z.ZodType<T>;
    clientOverride?: any;
  }
): Promise<T> {
  const { systemInstruction, userPrompt, schema, clientOverride } = options;
  
  const client = clientOverride || getOpenAIClient();
  const model = process.env.LLM_MODEL || 'kilo-auto/free';
  
  const jsonSchema = zodToJsonSchema(schema, { name: 'ast_output' });
  
  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: userPrompt }
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'ast_output',
        schema: jsonSchema,
        strict: true
      }
    }
  });
  
  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned empty response');
  }
  
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`Failed to parse LLM response as JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  
  return schema.parse(parsed);
}

export async function requestAstGeneration(
  brief: string,
  contextJson?: string,
  clientOverride?: any
): Promise<ASTNode> {
  const userPrompt = buildGenerationPrompt(brief, contextJson);
  return generateStructuredOutput({
    systemInstruction: SYSTEM_PROMPT_GENERATOR,
    userPrompt,
    schema: ASTNodeSchema,
    clientOverride
  });
}

export async function requestAstCorrection(
  brokenAst: ASTNode,
  errors: string[],
  clientOverride?: any
): Promise<ASTNode> {
  const brokenAstJson = JSON.stringify(brokenAst, null, 2);
  const userPrompt = buildCorrectionPrompt(brokenAstJson, errors);
  return generateStructuredOutput({
    systemInstruction: SYSTEM_PROMPT_DEBUGGER,
    userPrompt,
    schema: ASTNodeSchema,
    clientOverride
  });
}
