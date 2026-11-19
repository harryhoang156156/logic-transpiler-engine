# Component Specification: `src/main.ts`

## 1. Objective
Serve as the top-level CLI entry point and pipeline orchestrator. Connects ingestion, gap analysis, AI generation, atomic merging, TypeScript emission, and the self-correcting `compiler_guard` retry loop into a single automated execution flow designed for both local CLI usage and GitHub Actions workflows—including a dedicated `--audit-only` review mode for reasoning-based reviewer agents.

## 2. Dependencies
* External: `dotenv`, `node:fs/promises`, `node:path`, `node:url`
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
**`runEnginePipeline(options: { brief?: string; specFilePath?: string; overviewFilePath?: string; sourceFilePath?: string; outputFilePath?: string; maxRetries?: number; auditOnly?: boolean; clientOverride?: any }): Promise<{ success: boolean; finalCode: string; attempts: number }>`**

1. **Initialization & Brief Assembly**:
   * Load `dotenv.config()`. Set `maxRetries = options.maxRetries ?? 3`.
   * Validate that `options.outputFilePath` is provided whenever `options.auditOnly` is not `true` (throw a descriptive error if omitted in build/modify modes).
   * Construct `effectiveBrief`:
     * Read `options.overviewFilePath` from disk if provided and prepend it as global architectural context.
     * Read `options.specFilePath` from disk if provided and append its markdown contents.
     * Append `options.brief` if provided.
     * Throw a descriptive error if none of `brief` or `specFilePath` yields non-empty instructions.
2. **Mode Detection (Audit-Only, Blueprint Modification, or Greenfield)**:
   * **If `options.auditOnly` is true**:
     1. Require `options.sourceFilePath` to exist on disk (throw a descriptive error if missing).
     2. Call `parseTypeScriptFile(sourceFilePath)` to obtain `rootAst`.
     3. Call `analyzeCodeGaps(rootAst, effectiveBrief, options.clientOverride)` to get the `GapAnalysisReport`.
     4. Serialize `GapAnalysisReport` as formatted JSON (`JSON.stringify(report, null, 2)`). If `options.outputFilePath` is provided, write the JSON report to disk (creating parent directories with `fs.mkdir(..., { recursive: true })`).
     5. Return early (`{ success: true, finalCode: serializedReport, attempts: 0 }`) without mutating or emitting TypeScript code.
   * **Else if `sourceFilePath` is provided** (and the file exists on disk):
     1. Call `parseTypeScriptFile(sourceFilePath)` to obtain `rootAst`.
     2. Call `analyzeCodeGaps(rootAst, effectiveBrief, options.clientOverride)` to get the `GapAnalysisReport`.
     3. Extract subgraphs for `MUTATE_EXISTING` items and generate updated nodes via `requestAstGeneration`.
     4. Generate new nodes for `SPAWN_NEW` items via `requestAstGeneration`.
     5. Combine all operations into `AtomicPatchOperation[]` and call `applyAtomicPatches(rootAst, patches)` to produce `currentAst`.
   * **Else (`sourceFilePath` omitted or does not exist yet on disk — Greenfield)**:
     1. Call `requestAstGeneration(effectiveBrief, undefined, options.clientOverride)` to produce `currentAst`.
3. **Emission & Self-Correction Loop**:
   * Loop from `attempt = 1` to `maxRetries`:
     1. Emit TypeScript string via `emitTypeScript(currentAst)`.
     2. Validate string via `verifyTypeScriptCode(emittedCode, process.cwd())`.
     3. If `verification.success === true`:
        * Write `emittedCode` to `options.outputFilePath!` (creating parent directories with `fs.mkdir(..., { recursive: true })`).
        * Return `{ success: true, finalCode: emittedCode, attempts: attempt }`.
     4. If `verification.success === false` and `attempt < maxRetries`:
        * Call `requestAstCorrection(currentAst, verification.errors, options.clientOverride)` to update `currentAst` and continue loop.
4. **Failure Handling**: If all retries exhaust without passing `compiler_guard`, throw an explicit error detailing the final compiler diagnostics without writing broken code to `outputFilePath`.

### B. CLI Argument Parser
* When executed directly (`import.meta.url === pathToFileURL(process.argv).href`), parse CLI flags:
  * `--out <path>` (required unless `--audit-only` is set: target `.ts` file or JSON report path to write)
  * `--spec <path>` (optional: path to markdown specification or review criteria file)
  * `--overview <path>` (optional: path to global architecture/rules markdown file)
  * `--brief <text>` (optional: inline prompt string)
  * `--src <path>` (optional: existing `.ts` file to audit or modify in-place; if path does not exist yet and `--audit-only` is false, gracefully fall back to Greenfield creation mode)
  * `--retries <number>` (optional: defaults to `3`)
  * `--audit-only` (optional boolean flag: runs `parseTypeScriptFile` and `analyzeCodeGaps` using `--spec` / `--brief` as review criteria, prints the formatted `GapAnalysisReport` JSON to stdout or writes it to `--out`, and exits `0` immediately without mutating or emitting TypeScript code)
* Support `--help` (prints usage instructions and exits `0`).
* Exit with code `0` on success and code `1` with clear `console.error` diagnostics on failure.

## 4. Test Requirements (`tests/main.test.ts`)
* Test end-to-end greenfield pipeline using a mock `clientOverride` that first returns an AST with a type mismatch, verifies that `compiler_guard` catches it, and confirms that on attempt 2 (when the mock returns a fixed AST) `runEnginePipeline` succeeds and writes the verified `.ts` file to a temp output path.
* Test `--spec` and `--overview` file ingestion: write temporary markdown files, run `runEnginePipeline({ specFilePath, overviewFilePath, outputFilePath, clientOverride })`, and verify the combined contents were passed to the AI client.
* Test end-to-end modification pipeline (`sourceFilePath` provided) confirming `parser`, `gap_analyzer`, `atomic_merger`, and `ts_emitter` integrate seamlessly.
* Test `--audit-only` mode (`auditOnly: true`): pass an existing `.ts` file and a mock `clientOverride` returning a `GapAnalysisReport`, confirm `runEnginePipeline` returns `{ success: true, attempts: 0 }` with serialized JSON report and does not overwrite the source `.ts` file.
