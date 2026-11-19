# Component Specification: Full-System Integration & Activation (`tests/integration.test.ts` + Cross-Module Audit)

## 1. Objective
Perform the final end-to-end integration and activation pass across the entire `src/` codebase. Audit all 9 implemented modules against `dependencies_and_connections.md`, reconcile any cross-file import, type, or signature mismatches, ensure compiled `dist/` execution works cleanly alongside `tsx`, verify CLI subprocess behavior (`src/main.ts`), and create a comprehensive end-to-end integration test suite (`tests/integration.test.ts`) that runs the real multi-module pipeline without mocking internal components.

## 2. Target Scope
* **Audited & Reconciled Modules:**
  * `src/schemas.ts`
  * `src/client/prompts.ts`
  * `src/client/ai_client.ts`
  * `src/ingestion/parser.ts`
  * `src/ingestion/gap_analyzer.ts`
  * `src/compiler/ts_emitter.ts`
  * `src/compiler/atomic_merger.ts`
  * `src/verification/compiler_guard.ts`
  * `src/main.ts`
* **New Integration Test Suite:** `tests/integration.test.ts`

## 3. Mandatory Integration & Activation Checks

### A. Cross-Module Signature, Build & Import Reconciliation
1. **Strict `NodeNext` ESM Relative Imports:** Verify every relative import across all 9 files in `src/` ends with `.js` (e.g., `import { ASTNodeSchema } from '../schemas.js'`) so both `tsx` (development) and `node dist/main.js` (compiled production) resolve modules without `ERR_MODULE_NOT_FOUND`.
2. **Third-Party ESM/CommonJS Interop (`ioredis`, `better-sqlite3`, `dotenv`):** Verify that `GLOBAL_TS_HEADER` in `src/compiler/ts_emitter.ts` uses the exact import syntax (`import { Redis } from 'ioredis'` vs. `import Redis from 'ioredis'`, and `import Database from 'better-sqlite3'`) that compiles cleanly under `"module": "NodeNext"` and `"strict": true` against the installed `node_modules` types.
3. **JSON Schema Compatibility (`zod-to-json-schema` -> OpenAI/Kilo Gateway):** Verify `src/client/ai_client.ts` converts `ASTNodeSchema` (including recursive `z.lazy()` branches) into a valid JSON Schema without throwing recursion or `$ref` errors, and strips any unsupported root metadata before passing it to `response_format`.
4. **Contract Alignment:** Verify every exported function name, parameter order, and return type in `src/` matches `dependencies_and_connections.md` so `src/main.ts` connects seamlessly to `parser.ts`, `gap_analyzer.ts`, `ai_client.ts`, `atomic_merger.ts`, `ts_emitter.ts`, and `compiler_guard.ts`.
5. **Environment & Secret Hygiene:**
   * Confirm `dotenv.config()` is invoked cleanly at the entry point of `src/main.ts` without polluting stdout (which could corrupt structured logs in CI).
   * Confirm `src/client/ai_client.ts` resolves `KILO_API_KEY`, `KILO_BASE_URL` (`https://kilo.ai`), and `LLM_MODEL` (`kilo-auto/free`) cleanly.
   * Ensure no error messages or logs ever print raw API key values.
6. **CLI Entry Point Verification (`src/main.ts` & `dist/main.js`):**
   * Ensure `src/main.ts` properly detects direct CLI execution (using `pathToFileURL(process.argv[1]).href === import.meta.url`), supports `--help` (printing usage flags and exiting with `0`), parses `--spec`, `--overview`, `--brief`, `--src`, `--out`, and `--retries`, and exits cleanly with `0` on success or `1` on failure.
   * Ensure importing `runEnginePipeline` inside Vitest does **not** accidentally trigger CLI argument parsing.

### B. Black Box Type-Resolution & Temp File Isolation
1. **Full Black Box Type Check:** Verify that code emitted by `ts_emitter.ts` containing all Solana (`@solana/web3.js`, `bs58`), SQLite (`better-sqlite3`), Redis (`ioredis`), and Node (`fs/promises`, `dotenv`) Black Box nodes passes `compiler_guard.ts` (`verifyTypeScriptCode`) with **zero TypeScript diagnostics** against the repository's installed `node_modules` types.
2. **Temp File Cleanup:** Confirm `compiler_guard.ts` always removes its temporary `.ts` verification file inside a `finally` block so failed runs never leave stray `.ts` files inside the repository root or `src/`.

## 4. Integration Test Requirements (`tests/integration.test.ts`)
Create `tests/integration.test.ts` (importing from `'vitest'`) that tests the **real, unmocked internal pipeline** (`parser` + `gap_analyzer` + `atomic_merger` + `ts_emitter` + `compiler_guard` + `main`), mocking **only** the external LLM network call (`clientOverride`), and cleaning up all temporary directories in `afterEach` blocks (using `fs.mkdtemp(path.join(os.tmpdir(), 'transpiler-int-'))`):

1. **Test 1 — Greenfield Full-Stack Bot Generation (Real `ts_emitter` + Real `compiler_guard`):**
   * Provide a `clientOverride` returning a complete `ModuleContainer` AST utilizing `Solana_EstablishConnection`, `Solana_ParseWallet`, `Solana_ListenPumpFun`, `Solana_SimulatePayload`, `Sqlite_InitDatabase`, `Sqlite_ExecuteWrite`, `Sqlite_QueryRead`, `Redis_InitClient`, `Redis_QueuePush`, `Redis_QueueBlockingPop`, and `File_AppendLog`.
   * Execute `runEnginePipeline` writing to a temporary `.ts` output file.
   * Assert `result.success === true`, the output file exists on disk, and `compiler_guard` validated the emitted code against real TypeScript compiler diagnostics with zero errors.
2. **Test 2 — Blueprint Ingestion & Atomic Modification Loop (Real `parser` -> `gap_analyzer` -> `atomic_merger` -> `ts_emitter` -> `compiler_guard`):**
   * Write a temporary existing `.ts` blueprint file containing two async functions.
   * Run `runEnginePipeline` with `sourceFilePath` pointing to that blueprint file and a `clientOverride` that marks one function `KEEP_AS_IS` and the other `MUTATE_EXISTING`, plus spawns one new function (`SPAWN_NEW`).
   * Assert the untouched function is preserved, the mutated and spawned functions are emitted cleanly, and `compiler_guard` passes with zero errors.
3. **Test 3 — Self-Healing Compiler Retry Loop & Failure Rollback:**
   * Configure `clientOverride` to return an AST with an intentional TypeScript error inside an `ExpressionBlock` on attempt 1, and a corrected AST on attempt 2. Assert `runEnginePipeline` catches the diagnostic via real `compiler_guard`, triggers `requestAstCorrection`, succeeds on attempt 2 (`result.attempts === 2`), and writes valid code to disk.
   * Also verify that if all retries (`maxRetries: 2`) fail `compiler_guard`, `runEnginePipeline` throws an error and **does not** write broken code to `outputFilePath`.
4. **Test 4 — CLI Subprocess Smoke Test (`npm start -- --help` & Error Exit Code):**
   * Spawn `npx tsx src/main.ts --help` via `node:child_process` (`execFile`) and assert exit code `0` and stdout output listing `--out`, `--spec`, `--overview`, `--brief`, and `--src`.
   * Spawn `npx tsx src/main.ts` with missing required `--out` flag and assert non-zero exit code (`!== 0`) without unhandled stack-trace crashes.
