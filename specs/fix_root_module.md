# Fix Greenfield Root ModuleContainer Handling

## Target Files
- `src/client/prompts.ts`
- `src/main.ts`
- `tests/main.test.ts` (or `tests/integration.test.ts`)

## Requirements
1. In `src/client/prompts.ts`, update `SYSTEM_PROMPT_GENERATOR` and `buildGenerationPrompt` to explicitly instruct the model that full-module generation MUST always return a root node with `type: "ModuleContainer"` containing functions/statements inside its `body` array (never a bare `AsyncFunctionBlock` at the root).
2. In `src/main.ts` (before `validateRootModuleContainer` in Greenfield mode), if the LLM returns a valid non-`ModuleContainer` `ASTNode` (such as an `AsyncFunctionBlock`), deterministically wrap it inside a valid `ModuleContainer` (`{ id: 'module_root', type: 'ModuleContainer', moduleName: 'generated_module', body: [astNode] }`, matching the exact `ModuleContainer` fields in `src/schemas.ts`) instead of throwing an error, and validate with `ASTNodeSchema.parse()`.
3. Add a Vitest test verifying that Greenfield mode auto-wraps a bare `AsyncFunctionBlock` into a `ModuleContainer` and emits valid TypeScript.
