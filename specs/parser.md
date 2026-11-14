# Component Specification: `src/ingestion/parser.ts`

## 1. Objective
Implement the Reverse Ingestion Pipeline. Uses the native `typescript` Compiler API (`ts.createSourceFile`) to read existing `.ts` files (such as open-source blueprints) and convert them into the engine's simplified, decontaminated `ASTNode` JSON tree.

## 2. Dependencies
* External: `typescript`, `node:fs/promises`
* Internal: `../schemas.js`

## 3. Required Exports & Logic

### A. Core Functions
1. **`parseTypeScriptCode(sourceCode: string, moduleName?: string): ASTNode`**:
   * Creates a `ts.SourceFile` using `ts.createSourceFile('ingested.ts', sourceCode, ts.ScriptTarget.ES2022, true)`.
   * Iterates top-level statements and wraps them inside a root `ModuleContainer` node with auto-generated sequential IDs (`node_1`, `node_2`, etc.).
   * Maps native TypeScript AST constructs to engine schemas:
     * `ts.FunctionDeclaration` (with `async` modifier or standard) -> `AsyncFunctionBlock` (extracting name, parameters, return type, and recursively parsing the function body).
     * `ts.TryStatement` -> `TryCatchGuardian` (recursively parsing `tryBlock` and `catchClause`).
     * `ts.IfStatement` -> `ConditionalBranch` (extracting condition text via `.getText(sourceFile)` and recursively parsing `thenStatement` and `elseStatement`).
     * `ts.ForOfStatement` / `ts.WhileStatement` -> `LoopInterval` (extracting loop header and recursively parsing statement body).
     * Fallback for variable declarations, expression statements, return statements, and unknown constructs -> `ExpressionBlock` containing the clean `.getText(sourceFile)` string (stripping trailing semicolons so `ts_emitter.ts` can re-apply them cleanly).
     * Skips top-level `ts.ImportDeclaration` statements (since `ts_emitter.ts` manages global library headers deterministically).
2. **`parseTypeScriptFile(filePath: string): Promise<ASTNode>`**:
   * Reads file contents from disk and passes them to `parseTypeScriptCode`.

## 4. Test Requirements (`tests/parser.test.ts`)
* Pass a multi-construct sample TypeScript string (containing imports, an `async function`, a `try/catch`, an `if/else`, a `for..of` loop, and `const` assignments) into `parseTypeScriptCode`.
* Assert the returned object passes `ASTNodeSchema.parse()` and accurately reflects the nested hierarchy without retaining raw import statements.
