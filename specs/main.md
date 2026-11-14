# Component Specification: `src/main.ts`

## 1. Objective
Serve as the top-level CLI entry point and pipeline orchestrator. Connects ingestion, gap analysis, AI generation, atomic merging, TypeScript emission, and the self-correcting `compiler_guard` retry loop into a single automated execution flow.

## 2. Dependencies
* External: `dotenv`, `node:fs/promises`, `node:path`
* Internal:
  * `./schemas.js`
  * `./client/ai_client.js`
  * `./ingestion/parser.js`
  * `./ingestion/gap_analyzer.js`
  * `./compiler/ts_emitter.js`
  * `./compiler/atomic_merger.js`
  * `./verification/compiler_guard.js`

## 3. Required Exports & Execution Pipeline

### A. Pipeline Orchestrator Function
**`runEnginePipeline(options: { brief: string; sourceFilePath?: string; outputFilePath: string; maxRetries?: number; clientOverride?: any }): Promise<{ success: boolean; finalCode: string; attempts: number }>`**

1. **Initialization**: Load `dotenv.config()`. Set `maxRetries = options.maxRetries ?? 3`.
2. **Mode Detection (Greenfield vs. Blueprint Modification)**:
   * **If `sourceFilePath` is provided**:
     1. Call `parseTypeScriptFile(sourceFilePath)` to obtain `rootAst`.
     2. Call `analyzeCodeGaps(rootAst, options.brief, options.clientOverride)` to get the `GapAnalysisReport`.
     3. Extract subgraphs for `MUTATE_EXISTING` items and generate updated nodes via `requestAstGeneration`.
     4. Generate new nodes for `SPAWN_NEW` items via `requestAstGeneration`.
     5. Combine all operations into `AtomicPatchOperation[]` and call `applyAtomicPatches(rootAst, patches)` to produce `currentAst`.
   * **If `sourceFilePath` is omitted (Greenfield)**:
     1. Call `requestAstGeneration(options.brief, undefined, options.clientOverride)` to produce `currentAst`.
3. **Emission & Self-Correction Loop**:
   * Loop from `attempt = 1` to `maxRetries`:
     1. Emit TypeScript string via `emitTypeScript(currentAst)`.
     2. Validate string via `verifyTypeScriptCode(emittedCode, process.cwd())`.
     3. If `verification.success === true`:
        * Write `emittedCode` to `options.outputFilePath` (creating parent directories with `fs.mkdir(..., { recursive: true })`).
        * Return `{ success: true, finalCode: emittedCode, attempts: attempt }`.
     4. If `verification.success === false` and `attempt < maxRetries`:
        * Call `requestAstCorrection(currentAst, verification.errors, options.clientOverride)` to update `currentAst` and continue loop.
4. **Failure Handling**: If all retries exhaust without passing `compiler_guard`, throw an explicit error detailing the final compiler diagnostics without writing broken code to `outputFilePath`.

### B. CLI Argument Parser
* When executed directly (`import.meta.url === ...`), parse CLI flags `--brief`, `--out`, and optional `--src`, `--retries`, then invoke `runEnginePipeline`.

## 4. Test Requirements (`tests/main.test.ts`)
* Test end-to-end greenfield pipeline using a mock `clientOverride` that first returns an AST with a type mismatch, verifies that `compiler_guard` catches it, and confirms that on attempt 2 (when the mock returns a fixed AST) `runEnginePipeline` succeeds and writes the verified `.ts` file to a temp output path.
* Test end-to-end modification pipeline (`sourceFilePath` provided) confirming `parser`, `gap_analyzer`, `atomic_merger`, and `ts_emitter` integrate seamlessly.
