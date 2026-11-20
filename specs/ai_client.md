# Component Specification: `src/client/ai_client.ts`

## 1. Objective
Provide a unified, provider-agnostic LLM gateway using the official `openai` SDK configured to point at **Bifrost AI Gateway's** OpenAI-compatible endpoint (e.g., `http://localhost:8080/openai/v1` or a hosted Bifrost gateway URL). Never hardcode a specific LLM model ID inside source code; resolve the base URL, virtual/API key, and target model exclusively from `process.env` so routing and model selection can be controlled dynamically via GitHub Actions YAML inputs, `.env`, or Bifrost Virtual Key routing rules.

## 2. Dependencies
* External: `openai`, `zod`, `zod-to-json-schema`, `dotenv`
* Internal: `../schemas.js`, `./prompts.js`

## 3. Required Exports & Architecture

### A. Provider Configuration Resolver (`resolveBifrostConfig`)
Export a helper function `resolveBifrostConfig(env?: Record<string, string | undefined>): { baseURL: string; apiKey: string; model: string }` that reads from `env ?? process.env`:
* **`baseURL`**: Reads `env.BIFROST_BASE_URL` (falls back to `env.OPENAI_API_BASE` or `'http://localhost:8080/openai/v1'`). Normalizes trailing slashes: if the URL does not end with `/v1`, appends `/v1` cleanly.
* **`apiKey`**: Reads `env.BIFROST_API_KEY` (falls back to `env.OPENAI_API_KEY` or `'bifrost-local'` when running against an unauthenticated local Bifrost instance).
* **`model`**: Reads `env.LLM_MODEL` (falls back to `env.BIFROST_MODEL`). Throws a clear configuration error if neither environment variable is set when making a live API call (ensuring no model name is ever hardcoded in source).
* Instantiates `new OpenAI({ apiKey, baseURL })` (plus optional `defaultHeaders: { 'x-bf-vk': apiKey }` whenever `apiKey.startsWith('sk-bf-')` for Bifrost Virtual Key governance).

### B. Core Functions
1. **`generateStructuredOutput<T>(options: { systemInstruction: string; userPrompt: string; schema: z.ZodType<T>; modelOverride?: string; clientOverride?: any }): Promise<T>`**:
   * Resolves configuration via `resolveBifrostConfig()`, allowing `options.modelOverride` to override `LLM_MODEL` per call if passed.
   * Converts the Zod schema to standard JSON Schema via `zodToJsonSchema(options.schema)`.
   * Calls `client.chat.completions.create` with `model`, `messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: userPrompt }]`, and `response_format: { type: 'json_schema', json_schema: { name: 'ast_output', schema: jsonSchema, strict: true } }`.
   * Parses `response.choices[0].message.content` with `JSON.parse()` and validates it through `schema.parse()` before returning.
   * Accepts an optional `clientOverride` parameter for unit test dependency injection without hitting live endpoints.
2. **`requestAstGeneration(brief: string, contextJson?: string, clientOverride?: any): Promise<ASTNode>`**:
   * Wrapper calling `generateStructuredOutput` using `SYSTEM_PROMPT_GENERATOR`, `buildGenerationPrompt`, and `ASTNodeSchema`.
3. **`requestAstCorrection(brokenAst: ASTNode, errors: string[], clientOverride?: any): Promise<ASTNode>`**:
   * Wrapper calling `generateStructuredOutput` using `SYSTEM_PROMPT_DEBUGGER`, `buildCorrectionPrompt`, and `ASTNodeSchema`.

## 4. Test Requirements (`tests/ai_client.test.ts`)
* Test `resolveBifrostConfig` with custom `BIFROST_BASE_URL`, `BIFROST_API_KEY` (including `sk-bf-...` virtual key header attachment), and `LLM_MODEL`, and verify it throws if `LLM_MODEL` is missing.
* Use a mock `clientOverride` object to verify `requestAstGeneration` passes the exact expected parameters and validates valid JSON responses against `ASTNodeSchema`.
* Verify that if the mock LLM returns invalid JSON or schema-violating data, `generateStructuredOutput` throws a validation error.
