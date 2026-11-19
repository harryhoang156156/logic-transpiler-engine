# System Dependency Graph & Inter-Module Contracts

## 1. Purpose
This document defines the exact import hierarchy, exported function signatures, and data contracts connecting all 9 TypeScript modules in `src/`. Every module must strictly follow these boundaries to prevent circular dependencies, broken relative `.js` ESM imports, or mismatched types during assembly.

---

## 2. Layered Dependency Hierarchy (Strict Acyclic Graph)

Dependencies flow strictly downward from Layer 4 to Layer 0. No module may ever import from a higher layer or create circular references.

```text
LAYER 4 (Orchestrator):      src/main.ts
                                 │
          ┌──────────────────────┼──────────────────────┬──────────────────────┐
          ▼                      ▼                      ▼                      ▼
LAYER 3 (Pipelines):   src/ingestion/          src/compiler/          src/verification/
                       gap_analyzer.ts         atomic_merger.ts       compiler_guard.ts
                                 │             ts_emitter.ts
          ┌──────────────────────┤                      │                      │
          ▼                      ▼                      │                      │
LAYER 2 (Gateways):    src/client/             src/ingestion/                   │
                       ai_client.ts            parser.ts                        │
                          │      │               │      │                      │
                          │      ▼               │      │                      │
LAYER 1 (Directives):     │   src/client/        │      │                      │
                          │   prompts.ts         │      │                      │
                          ▼                      ▼      ▼                      ▼
LAYER 0 (Contracts):   ─────────────────────── src/schemas.ts ──────────────────────
```

---

## 3. Module-by-Module Connection Specifications

### Layer 0: `src/schemas.ts`
* **Internal Imports:** None (Zero internal dependencies).
* **External Imports:** `zod`
* **Consumed By:** Every module in `src/` (`ai_client.ts`, `parser.ts`, `gap_analyzer.ts`, `ts_emitter.ts`, `atomic_merger.ts`, `compiler_guard.ts`, `main.ts`).
* **Exported Contracts:**
  * `ASTNodeSchema` & inferred `ASTNode` type (17 discriminated union variants: 5 structural containers, `ExpressionBlock`, and 11 Solana/SQLite/Redis/File Black Box nodes).
  * `GapResolutionItemSchema` & `GapResolutionItem` type.
  * `GapAnalysisReportSchema` & `GapAnalysisReport` type.

### Layer 1: `src/client/prompts.ts`
* **Internal Imports:** None (Zero internal dependencies).
* **External Imports:** None.
* **Consumed By:** `src/client/ai_client.ts` (and optionally `src/ingestion/gap_analyzer.ts`).
* **Exported Contracts:**
  * Constants: `SYSTEM_PROMPT_GENERATOR`, `SYSTEM_PROMPT_AUDITOR`, `SYSTEM_PROMPT_DEBUGGER`.
  * Functions:
    * `buildGenerationPrompt(brief: string, contextNodes?: string): string`
    * `buildAuditPrompt(existingAstJson: string, featureBrief: string): string`
    * `buildCorrectionPrompt(brokenAstJson: string, compilerErrors: string[]): string`

### Layer 2: `src/client/ai_client.ts`
* **Internal Imports:**
  * `../schemas.js` (`ASTNodeSchema`, `ASTNode`)
  * `./prompts.js` (`SYSTEM_PROMPT_GENERATOR`, `SYSTEM_PROMPT_DEBUGGER`, `buildGenerationPrompt`, `buildCorrectionPrompt`)
* **External Imports:** `openai`, `zod`, `zod-to-json-schema`, `dotenv`
* **Consumed By:** `src/ingestion/gap_analyzer.ts`, `src/main.ts`
* **Exported Contracts:**
  * `generateStructuredOutput<T>(options: { systemInstruction: string; userPrompt: string; schema: z.ZodType<T>; clientOverride?: any }): Promise<T>`
  * `requestAstGeneration(brief: string, contextJson?: string, clientOverride?: any): Promise<ASTNode>`
  * `requestAstCorrection(brokenAst: ASTNode, errors: string[], clientOverride?: any): Promise<ASTNode>`
* **Data Flow:** Receives raw text prompts + Zod schemas from callers → enforces Kilo Gateway (`https://kilo.ai`, model `kilo-auto/free`) JSON Schema structured output → parses and validates via `schema.parse()` → returns strictly typed objects.

### Layer 2: `src/ingestion/parser.ts`
* **Internal Imports:**
  * `../schemas.js` (`ASTNodeSchema`, `ASTNode`)
* **External Imports:** `typescript`, `node:fs/promises`
* **Consumed By:** `src/main.ts`
* **Exported Contracts:**
  * `parseTypeScriptCode(sourceCode: string, moduleName?: string): ASTNode`
  * `parseTypeScriptFile(filePath: string): Promise<ASTNode>`
* **Data Flow:** Reads existing `.ts` blueprint files from disk → converts TypeScript AST into a root `ModuleContainer` `ASTNode` with sequential IDs (`node_1`, `node_2`, ...) and stripped top-level imports → hands clean `ASTNode` graph to `main.ts`.

### Layer 3: `src/ingestion/gap_analyzer.ts`
* **Internal Imports:**
  * `../schemas.js` (`ASTNode`, `GapAnalysisReportSchema`, `GapAnalysisReport`)
  * `../client/ai_client.js` (`generateStructuredOutput`)
  * `../client/prompts.js` (`SYSTEM_PROMPT_AUDITOR`, `buildAuditPrompt`)
* **External Imports:** None.
* **Consumed By:** `src/main.ts`
* **Exported Contracts:**
  * `analyzeCodeGaps(existingAst: ASTNode, featureBrief: string, clientOverride?: any): Promise<GapAnalysisReport>`
  * `extractTargetSubgraphs(rootAst: ASTNode, report: GapAnalysisReport): Map<string, ASTNode>`
* **Data Flow:** Takes `rootAst` (produced by `parser.ts`) + feature brief → calls `generateStructuredOutput` with `GapAnalysisReportSchema` → verifies every returned `targetNodeId` exists in `rootAst` → extracts matching subtrees for `MUTATE_EXISTING` targets so `main.ts` can pass them to `requestAstGeneration`.

### Layer 3: `src/compiler/atomic_merger.ts`
* **Internal Imports:**
  * `../schemas.js` (`ASTNodeSchema`, `ASTNode`)
* **External Imports:** None.
* **Consumed By:** `src/main.ts`
* **Exported Contracts:**
  * Type: `AtomicPatchOperation` (`{ action: 'REPLACE' | 'APPEND_TO_MODULE'; targetNodeId?: string; newNode: ASTNode }`)
  * Function: `applyAtomicPatches(rootAst: ASTNode, operations: AtomicPatchOperation[]): ASTNode`
* **Data Flow:** Receives `rootAst` (from `parser.ts`) + array of mutated/spawned `ASTNode` patches (generated by `ai_client.ts`) → deep-clones `rootAst` → validates all target IDs exist before modifying → applies all replacements/insertions transactionally → validates final tree with `ASTNodeSchema.parse()`.

### Layer 3: `src/compiler/ts_emitter.ts`
* **Internal Imports:**
  * `../schemas.js` (`ASTNode`)
* **External Imports:** None.
* **Consumed By:** `src/main.ts`
* **Exported Contracts:**
  * Constant: `GLOBAL_TS_HEADER`
  * Function: `emitTypeScript(node: ASTNode, indentLevel?: number, includeHeader?: boolean): string`
* **Data Flow:** Receives validated `ASTNode` tree (from `ai_client.ts` or `atomic_merger.ts`) → recursively emits formatted TypeScript code with deterministic Solana (`@solana/web3.js`, `bs58`), SQLite (`better-sqlite3`), Redis (`ioredis`), and Node (`fs/promises`, `dotenv`) Black Box templates → returns complete `.ts` source string to `main.ts`.

### Layer 3: `src/verification/compiler_guard.ts`
* **Internal Imports:**
  * `../schemas.js` (optional type references)
* **External Imports:** `typescript`, `node:fs/promises`, `node:path`, `node:os`
* **Consumed By:** `src/main.ts`
* **Exported Contracts:**
  * Type: `VerificationResult` (`{ success: boolean; errors: string[] }`)
  * Function: `verifyTypeScriptCode(code: string, projectRootDir?: string): Promise<VerificationResult>`
* **Data Flow:** Receives emitted TypeScript string from `ts_emitter.ts` (via `main.ts`) → writes temp `.ts` file inside `projectRootDir` so `node_modules` types resolve → executes `ts.createProgram` + `ts.getPreEmitDiagnostics` → deletes temp file → returns `{ success, errors }` to `main.ts`.

### Layer 4: `src/main.ts`
* **Internal Imports:**
  * `./schemas.js`
  * `./client/ai_client.js`
  * `./ingestion/parser.js`
  * `./ingestion/gap_analyzer.js`
  * `./compiler/ts_emitter.js`
  * `./compiler/atomic_merger.js`
  * `./verification/compiler_guard.js`
* **External Imports:** `dotenv`, `node:fs/promises`, `node:path`, `node:url`
* **Consumed By:** CLI / GitHub Actions workflow (`npm start -- ...`).
* **Exported Contracts:**
  * `runEnginePipeline(options: { brief?: string; specFilePath?: string; overviewFilePath?: string; sourceFilePath?: string; outputFilePath: string; maxRetries?: number; clientOverride?: any }): Promise<{ success: boolean; finalCode: string; attempts: number }>`

---

## 4. End-to-End Runtime Execution Sequences

### Sequence A: Greenfield File Creation (`--src` omitted or non-existent)
1. `main.ts` reads `--overview` and `--spec` markdown files into `effectiveBrief`.
2. `main.ts` calls `ai_client.requestAstGeneration(effectiveBrief)` → returns `currentAst`.
3. **Verification Loop (`1..maxRetries`)**:
   * `main.ts` calls `ts_emitter.emitTypeScript(currentAst)` → returns `emittedCode`.
   * `main.ts` calls `compiler_guard.verifyTypeScriptCode(emittedCode, process.cwd())`.
   * On failure: `main.ts` calls `ai_client.requestAstCorrection(currentAst, errors)` → updates `currentAst` and repeats.
   * On success: `main.ts` writes `emittedCode` to `--out` path and exits `0`.

### Sequence B: Atomic Blueprint Modification (`--src` exists on disk)
1. `main.ts` calls `parser.parseTypeScriptFile(sourceFilePath)` → returns `rootAst`.
2. `main.ts` calls `gap_analyzer.analyzeCodeGaps(rootAst, effectiveBrief)` → returns `GapAnalysisReport`.
3. `main.ts` calls `gap_analyzer.extractTargetSubgraphs(rootAst, report)` to isolate `MUTATE_EXISTING` subtrees.
4. For each `MUTATE_EXISTING` and `SPAWN_NEW` item, `main.ts` calls `ai_client.requestAstGeneration(...)` to build `AtomicPatchOperation[]`.
5. `main.ts` calls `atomic_merger.applyAtomicPatches(rootAst, patches)` → returns merged `currentAst`.
6. 6. Enters Verification Loop (identical to Sequence A Step 3) and writes verified .ts output to --out.
