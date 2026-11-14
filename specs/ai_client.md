# Component Specification: `src/client/ai_client.ts`

## 1. Objective
Provide an LLM gateway using the official `openai` SDK configured to point at NVIDIA NIM's OpenAI-compatible endpoint (`https://integrate.api.nvidia.com/v1`). Enforces Structured Outputs (`response_format` JSON Schema) bound directly to Zod schemas so the API physically cannot return malformed JSON.

## 2. Dependencies
* External: `openai`, `zod`, `zod-to-json-schema`, `dotenv`
* Internal: `../schemas.js`, `./prompts.js`

## 3. Required Exports & Architecture

### A. Configuration & Client Initialization
* Read `NVIDIA_API_KEY`, `NVIDIA_BASE_URL` (defaulting to `'https://integrate.api.nvidia.com/v1'`), and `LLM_MODEL` (defaulting to `'qwen/qwen3-coder-480b-a35b-instruct'`) from `process.env`.
* Instantiate `new OpenAI({ apiKey: process.env.NVIDIA_API_KEY, baseURL: process.env.NVIDIA_BASE_URL })`.
* Throw a clear initialization error if `NVIDIA_API_KEY` is missing when making a live call.

### B. Core Functions
1. **`generateStructuredOutput<T>(options: { systemInstruction: string; userPrompt: string; schema: z.ZodType<T>; clientOverride?: any }): Promise<T>`**:
   * Converts the Zod schema to standard JSON Schema via `zodToJsonSchema(options.schema)`.
   * Calls `client.chat.completions.create` with `model`, `messages: [{ role: 'system', content: systemInstruction }, { role: 'user', content: userPrompt }]`, and `response_format: { type: 'json_schema', json_schema: { name: 'ast_output', schema: jsonSchema, strict: true } }`.
   * Parses `response.choices[0].message.content` with `JSON.parse()` and validates it through `schema.parse()` before returning.
   * Accepts an optional `clientOverride` parameter for unit test dependency injection.
2. **`requestAstGeneration(brief: string, contextJson?: string, clientOverride?: any): Promise<ASTNode>`**:
   * Wrapper calling `generateStructuredOutput` using `SYSTEM_PROMPT_GENERATOR`, `buildGenerationPrompt`, and `ASTNodeSchema`.
3. **`requestAstCorrection(brokenAst: ASTNode, errors: string[], clientOverride?: any): Promise<ASTNode>`**:
   * Wrapper calling `generateStructuredOutput` using `SYSTEM_PROMPT_DEBUGGER`, `buildCorrectionPrompt`, and `ASTNodeSchema`.

## 4. Test Requirements (`tests/ai_client.test.ts`)
* Use a mock `clientOverride` object to verify `requestAstGeneration` passes the exact expected parameters and validates valid JSON responses against `ASTNodeSchema`.
* Verify that if the mock LLM returns invalid JSON or schema-violating data, `generateStructuredOutput` throws a validation error.
