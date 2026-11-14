# Component Specification: `src/client/prompts.ts`

## 1. Objective
Centralize all immutable system prompts and prompt-builder helper functions. These directives strictly constrain the LLM to operate purely as a structural JSON AST architect, preventing conversational filler, markdown fences, or raw syntax generation outside `ExpressionBlock` nodes.

## 2. Dependencies
* External: None
* Internal: None (Pure string templates)

## 3. Required Exports & Functions

### A. System Directives (String Constants)
1. **`SYSTEM_PROMPT_GENERATOR`**:
   * Instructs the model that it is a deterministic AST logic generator.
   * Explicitly forbids outputting markdown (` ```json `), explanations, or raw TypeScript boilerplate.
   * Mandates using the specialized `Solana_*`, `Sqlite_*`, `Redis_*`, and `File_AppendLog` Black Box nodes whenever RPC connections, wallet parsing, Pump.fun WebSocket listening, transaction simulation, SQLite state persistence (`better-sqlite3`), Redis work queue operations (`ioredis` `rpush`/`blpop`), or file logging are required.
   * Enforces parameterized SQL queries (`?` placeholders) inside `Sqlite_*` nodes to prevent SQL injection.
   * Enforces assigning unique, sequential `id` strings to every generated node.
2. **`SYSTEM_PROMPT_AUDITOR`**:
   * Instructs the model to act as a senior software architect performing a strategic gap analysis between an existing `ASTNode` JSON tree and a user feature brief.
   * Defines strict criteria for choosing `KEEP_AS_IS` (logic aligns), `MUTATE_EXISTING` (structure is compatible, parameters/inner logic need updates), or `SPAWN_NEW` (existing logic is tightly coupled to an incompatible paradigm; must create a new sibling node).
3. **`SYSTEM_PROMPT_DEBUGGER`**:
   * Instructs the model that its previously generated AST failed `tsc --noEmit` compilation.
   * Commands the model to analyze the compiler diagnostic strings, locate the exact offending `id` in the provided AST, and return a corrected, valid `ASTNode` tree.

### B. Prompt Formatting Helpers
1. **`buildGenerationPrompt(brief: string, contextNodes?: string): string`**: Formats the user's intent and optional existing node context.
2. **`buildAuditPrompt(existingAstJson: string, featureBrief: string): string`**: Packages the serialized AST and brief for gap analysis.
3. **`buildCorrectionPrompt(brokenAstJson: string, compilerErrors: string[]): string`**: Combines the failing JSON graph with `tsc` error logs.

## 4. Test Requirements (`tests/prompts.test.ts`)
* Verify all exported prompt constants are non-empty strings containing key architectural constraints (including `Solana_*`, `Sqlite_*`, and `Redis_*` directives).
* Verify helper functions properly interpolate inputs without throwing on special characters or empty optional arguments.
