# Component Specification: `src/verification/compiler_guard.ts`

## 1. Objective
Implement the automated programmatic TypeScript verification sandbox. Evaluates emitted TypeScript strings using the native `typescript` Compiler API (`noEmit: true`) in memory/temp storage, catches type or reference errors, and formats diagnostic logs to drive the self-correcting AI loop.

## 2. Dependencies
* External: `typescript`, `node:fs/promises`, `node:path`, `node:os`
* Internal: `../schemas.js`

## 3. Required Exports & Logic

### A. Data Types
```typescript
export interface VerificationResult {
  success: boolean;
  errors: string[];
}
```

### B. Core Functions
1. **`verifyTypeScriptCode(code: string, projectRootDir?: string): Promise<VerificationResult>`**:
   * Writes `code` to a temporary `.ts` file inside the project's context (or `os.tmpdir()` if no `projectRootDir` is provided, ensuring `node_modules` types like `@solana/web3.js`, `better-sqlite3`, `ioredis`, and `@types/node` can be resolved when `projectRootDir` is supplied).
   * Initializes a TypeScript program via `ts.createProgram([tempFilePath], compilerOptions)` with `strict: true`, `target: ts.ScriptTarget.ES2022`, `moduleResolution: ts.ModuleKind.NodeNext`, `noEmit: true`, and `skipLibCheck: true`.
   * Collects diagnostics from `ts.getPreEmitDiagnostics(program)`.
   * Cleans up the temporary file in a `finally` block.
   * If `diagnostics.length === 0`, returns `{ success: true, errors: [] }`.
   * Otherwise, maps each diagnostic into a clear, readable string containing line number, error code, and flattened message (`ts.flattenDiagnosticMessageText`), returning `{ success: false, errors }`.

## 4. Test Requirements (`tests/compiler_guard.test.ts`)
* Pass valid TypeScript code (e.g., `const x: number = 42; export { x };`) and assert `{ success: true, errors: [] }`.
* Pass intentionally broken TypeScript code (e.g., `const x: number = "not_a_number";`) and assert `success === false` with `errors.length > 0` containing type mismatch details.
