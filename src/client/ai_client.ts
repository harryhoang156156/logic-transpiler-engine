import { config as dotenvConfig } from 'dotenv';
import { OpenAI } from 'openai';
import { z } from 'zod';
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
 * Internal marker used to remember that a property was originally optional.
 * It is stripped from the schema before it is sent to the LLM provider and is
 * only consulted by `stripNulls` when normalizing the model's response.
 */
const OPTIONAL_MARKER = 'x-optional';

/**
 * Recursively rewrites a JSON Schema so it satisfies OpenAI Structured Outputs
 * requirements: every object lists all of its properties in `required`,
 * disallows additional properties, and optional properties are expressed as
 * nullable so the model can emit `null` for them.
 *
 * Optional properties are tagged with `OPTIONAL_MARKER` so that `stripNulls`
 * can distinguish them from required-but-nullable properties (which also
 * contain a `null` branch but must keep their `null` values).
 */
function enforceStrictJsonSchema(node: any): any {
  if (Array.isArray(node)) {
    return node.map((item) => enforceStrictJsonSchema(item));
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }

  // Preserve $ref references as-is
  if ('$ref' in node) {
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
        // Wrap optional property in anyOf with null and tag it so that
        // stripNulls can tell it apart from a required nullable property.
        strictProps[key] = {
          anyOf: [propSchema, { type: 'null' }],
          [OPTIONAL_MARKER]: true,
        };
      }
    }
    result.properties = strictProps;
    result.required = allKeys;
    result.additionalProperties = false;
  }

  return result;
}

/**
 * Recursively removes the internal `OPTIONAL_MARKER` key from a schema so it
 * can be sent to the LLM provider without leaking implementation details.
 *
 * The marker is only ever attached to schema nodes (as a sibling of `anyOf`).
 * Keys inside `properties`, `definitions`, and `$defs` maps are
 * application-defined names, not schema keywords, so they must be preserved
 * verbatim — otherwise a property literally named `x-optional` would be
 * dropped from `properties` while remaining in `required` and
 * `additionalProperties: false`, producing an inconsistent schema.
 */
function stripMarkers(node: any): any {
  if (Array.isArray(node)) {
    return node.map((item) => stripMarkers(item));
  }
  if (node === null || typeof node !== 'object') {
    return node;
  }
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === OPTIONAL_MARKER) {
      continue;
    }
    if (
      (key === 'properties' || key === 'definitions' || key === '$defs') &&
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      // Preserve application-defined names (property/definition keys) as-is;
      // only recurse into their schema values.
      const map: Record<string, any> = {};
      for (const [name, subSchema] of Object.entries(
        value as Record<string, any>
      )) {
        map[name] = stripMarkers(subSchema);
      }
      result[key] = map;
    } else {
      result[key] = stripMarkers(value);
    }
  }
  return result;
}

function hasUnsupportedKeywords(node: any): boolean {
  if (Array.isArray(node)) {
    return node.some((item) => hasUnsupportedKeywords(item));
  }
  if (node === null || typeof node !== 'object') {
    return false;
  }

  // $ref nodes are opaque references; never treat their keys as schema keywords.
  if ('$ref' in node) {
    return false;
  }

  // `allOf`, `oneOf`, and `not` are unsupported in OpenAI strict mode when they
  // appear as schema keywords. Property names inside a `properties` map are
  // field names, not schema keywords, so they are inspected only via their
  // schema values below.
  if ('allOf' in node || 'oneOf' in node || 'not' in node) {
    return true;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object') {
      for (const propSchema of Object.values(value as Record<string, any>)) {
        if (hasUnsupportedKeywords(propSchema)) {
          return true;
        }
      }
    } else if (
      (key === 'definitions' || key === '$defs') &&
      value &&
      typeof value === 'object'
    ) {
      for (const defSchema of Object.values(value as Record<string, any>)) {
        if (hasUnsupportedKeywords(defSchema)) {
          return true;
        }
      }
    } else if (
      key === 'items' ||
      key === 'additionalProperties' ||
      key === 'anyOf'
    ) {
      if (hasUnsupportedKeywords(value)) {
        return true;
      }
    }
  }

  return false;
}

function toStrictJsonSchema(schema: z.ZodTypeAny): { schema: Record<string, any>; strict: boolean } {
  // Zod v4 native JSON Schema conversion (replaces zod-to-json-schema)
  // target: "draft-07" produces a schema compatible with OpenAI Structured Outputs
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-07' }) as Record<string, any>;
  
  // Strip root $schema metadata as required by OpenAI structured outputs
  delete jsonSchema.$schema;
  
  const unsupported = hasUnsupportedKeywords(jsonSchema);
  if (unsupported) {
    // Return the original converted schema; strict rewriting and null
    // normalization are exclusive to the strict path.
    return { schema: jsonSchema, strict: false };
  }
  const strictSchema = enforceStrictJsonSchema(jsonSchema);
  return { schema: strictSchema, strict: true };
}

function resolveRef(ref: string, rootSchema: any): any {
  if (!ref.startsWith('#/')) return null;
  const parts = ref.substring(2).split('/');
  let curr = rootSchema;
  for (const p of parts) {
    if (curr && typeof curr === 'object' && p in curr) {
      curr = curr[p];
    } else {
      return null;
    }
  }
  return curr;
}

/**
 * Recursively removes `null` values from parsed LLM output for properties
 * that were made nullable during strict-schema conversion (optional properties).
 * Uses the strict schema structure and resolves $ref recursively at every depth.
 * Also traverses into anyOf union branches to normalize nested nullable fields.
 * For discriminated unions (anyOf with multiple non-null branches), matches the
 * value against each branch before normalizing, preserving required nullable fields.
 *
 * Only properties tagged with `OPTIONAL_MARKER` are treated as optional; a
 * required-but-nullable property also has a `null` branch but keeps its value.
 */
function stripNulls(value: any, schema: any, rootSchema: any): any {
  if (value === null || value === undefined) {
    return value;
  }
  if (!schema) {
    return value;
  }
  if ('$ref' in schema) {
    const resolved = resolveRef(schema.$ref, rootSchema);
    return resolved ? stripNulls(value, resolved, rootSchema) : value;
  }

  if (Array.isArray(value) && schema.type === 'array') {
    const itemSchema = schema.items;
    return value.map((item) => stripNulls(item, itemSchema, rootSchema));
  }

  if (typeof value === 'object' && schema.properties) {
    const result: Record<string, any> = {};
    const properties = schema.properties;
    for (const [key, val] of Object.entries(value)) {
      const propSchema = properties[key];
      if (!propSchema) {
        result[key] = val;
        continue;
      }

      let resolvedPropSchema = propSchema;
      if ('$ref' in propSchema) {
        resolvedPropSchema = resolveRef(propSchema.$ref, rootSchema) || propSchema;
      }

      let isOptionalWrapper = false;
      let nonNullSubSchema = resolvedPropSchema;
      if (resolvedPropSchema.anyOf && Array.isArray(resolvedPropSchema.anyOf)) {
        const hasNullBranch = resolvedPropSchema.anyOf.some(
          (b: any) => b.type === 'null'
        );
        if (hasNullBranch) {
          // Only strip nulls for properties that were originally optional.
          // Required-but-nullable properties also have a null branch but must
          // keep their null values.
          isOptionalWrapper = resolvedPropSchema[OPTIONAL_MARKER] === true;
          const nonNullBranches = resolvedPropSchema.anyOf.filter(
            (b: any) => b.type !== 'null'
          );
          if (nonNullBranches.length === 1) {
            nonNullSubSchema = nonNullBranches[0];
          } else {
            nonNullSubSchema = { anyOf: nonNullBranches };
          }
        }
      }

      if (val === null && isOptionalWrapper) {
        continue;
      }

      result[key] = stripNulls(val, nonNullSubSchema, rootSchema);
    }
    return result;
  }

  // Handle anyOf unions (discriminated unions or other unions)
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    // For optional wrapper (has null branch), we already handled above in properties context
    // Here we handle top-level anyOf or nested anyOf without null branch
    const hasNullBranch = schema.anyOf.some((b: any) => b.type === 'null');
    if (hasNullBranch) {
      // This is an optional wrapper at non-property level - try each non-null branch
      const nonNullBranches = schema.anyOf.filter((b: any) => b.type !== 'null');
      for (const branchSchema of nonNullBranches) {
        const stripped = stripNulls(value, branchSchema, rootSchema);
        // Check if the branch schema matches (has properties or is object type)
        if (branchSchema.properties || branchSchema.type === 'object') {
          return stripped;
        }
      }
      return value;
    } else {
      // Discriminated union or other union without null - match value against each branch
      // Try each branch and use the first one that validates successfully
      for (const branchSchema of schema.anyOf) {
        try {
          // Create a temporary Zod schema from the branch to validate
          // We use a simple heuristic: if the branch has a discriminant property, check it
          const stripped = stripNulls(value, branchSchema, rootSchema);
          // If branch has properties, assume it's a match if value has those properties
          if (branchSchema.properties) {
            const branchProps = Object.keys(branchSchema.properties);
            const valueProps = value && typeof value === 'object' ? Object.keys(value) : [];
            const hasAllRequired = branchSchema.required?.every((r: string) => valueProps.includes(r)) ?? true;
            if (hasAllRequired && branchProps.some((p: string) => valueProps.includes(p))) {
              return stripped;
            }
          } else if (branchSchema.type === 'object' || branchSchema.type === undefined) {
            // Generic object branch - accept it
            return stripped;
          }
        } catch {
          // Branch didn't match, try next
          continue;
        }
      }
      return value;
    }
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

  const { schema: markedSchema, strict } = toStrictJsonSchema(schema);
  // Strip internal optionality markers before sending the schema to the
  // provider; keep the marked schema for response normalization.
  const openAiSchema = strict ? stripMarkers(markedSchema) : markedSchema;

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
        schema: openAiSchema,
        strict,
      },
    },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned empty response content.');
  }

  const parsed = JSON.parse(content);
  if (!strict) {
    // Fallback path: validate directly with Zod; no strict rewriting or
    // null normalization is applied.
    return schema.parse(parsed);
  }

  const stripped = stripNulls(parsed, markedSchema, markedSchema);
  return schema.parse(stripped);
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
