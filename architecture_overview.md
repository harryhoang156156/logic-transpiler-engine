# System Architecture Overview: Bounded Code-Generation Engine (Solana Trading Specific)

## 1. System Intent & Core Constraints
This engine replaces probabilistic text-based code generation with deterministic, AST-like JSON tree compilation. LLMs are strictly prohibited from outputting freeform TypeScript syntax, markdown formatting, or conversational filler. Instead, the LLM populates a rigid, strongly-typed Zod JSON schema representing pure logical control flow and pre-verified library invocations ("Black Boxes"). A custom transpiler deterministically emits syntax-perfect TypeScript from this graph, followed by an automated programmatic compiler validation loop (`tsc --noEmit`).

## 2. Directory & File Topology
```text
logic-transpiler-engine/
├── architecture_overview.md
├── specs/
│   ├── schemas.md
│   ├── ai_client.md
│   ├── prompts.md
│   ├── parser.md
│   ├── gap_analyzer.md
│   ├── ts_emitter.md
│   ├── atomic_merger.md
│   ├── compiler_guard.md
│   └── main.md
└── src/
    ├── main.ts
    ├── schemas.ts
    ├── client/
    │   ├── ai_client.ts
    │   └── prompts.ts
    ├── ingestion/
    │   ├── parser.ts
    │   └── gap_analyzer.ts
    ├── compiler/
    │   ├── ts_emitter.ts
    │   └── atomic_merger.ts
    └── verification/
        └── compiler_guard.ts
```

## 3. Component Data Flow & Inter-Module Links

[CLI Input / Brief] ──► main.ts
│
├──► 1. Ingestion: parser.ts (Raw .ts -> ASTNode JSON)
│         │
├──► 2. Audit: gap_analyzer.ts ◄──► ai_client.ts (+ prompts.ts)
│         │ (Outputs Resolution Fork: KEEP / MUTATE / SPAWN)
│         │
├──► 3. Generation: ai_client.ts (+ prompts.ts) -> Validated ASTNode Subgraphs
│         │
├──► 4. Assembly: atomic_merger.ts (Patches Subgraphs into Root ASTNode Graph)
│         │
├──► 5. Transpilation: ts_emitter.ts (Root ASTNode Graph -> Formatted .ts String)
│         │
└──► 6. Verification: compiler_guard.ts (Programmatic tsc check)
├──► [PASS] -> Write final .ts file to target directory
└──► [FAIL] -> Extract diagnostics -> Loop back to ai_client.ts

### Explicit Dependency Matrix
* **`src/schemas.ts`**: Zero internal dependencies. Imported by every module in `src/` as the single source of truth for all data contracts (`ASTNode`, `GapAnalysisReport`, `CompilationResult`).
* **`src/client/prompts.ts`**: Zero internal dependencies. Imported exclusively by `ai_client.ts` and `gap_analyzer.ts` to enforce system directives.
* **`src/client/ai_client.ts`**: Imports `schemas.ts` and `prompts.ts`. Called by `main.ts`, `gap_analyzer.ts`, and the retry loop in `compiler_guard.ts`.
* **`src/ingestion/parser.ts`**: Imports `schemas.ts` and the `typescript` compiler API. Called by `main.ts` when modifying an existing blueprint file.
* **`src/ingestion/gap_analyzer.ts`**: Imports `schemas.ts`, `ai_client.ts`, and `prompts.ts`. Called by `main.ts` to compare ingested graphs against a feature brief.
* **`src/compiler/atomic_merger.ts`**: Imports `schemas.ts`. Called by `main.ts` to merge mutated/spawned subgraphs back into the root AST without leaving dangling references.
* **`src/compiler/ts_emitter.ts`**: Imports `schemas.ts`. Called by `main.ts` to translate the final `ASTNode` tree into a TypeScript string, including all Solana, SQLite (`better-sqlite3`), Redis (`ioredis`), and Node.js Black Box definitions.
* **`src/verification/compiler_guard.ts`**: Imports `schemas.ts` and `typescript`. Called by `main.ts` to validate emitted code before disk persistence.
* **`src/main.ts`**: Top-level orchestrator. Imports and connects all modules above.

## 4. Global Tech & Runtime Constraints
* **Runtime**: Node.js v20+ (`"type": "module"`, ES2022 target).
* **Language**: Strict TypeScript (`"strict": true`, `"moduleResolution": "NodeNext"`).
* **Core Dependencies**: `zod`, `zod-to-json-schema`, `openai`, `typescript`, `dotenv`.
* **Target Bot Libraries Supported in Emitter**: `@solana/web3.js`, `bs58`, `dotenv`, `fs/promises`, `better-sqlite3` (`@types/better-sqlite3`), `ioredis`.
* **Testing Mandate**: Every implementation file in `src/` must have a corresponding unit test file in `tests/` (using Node's native `node:test` and `node:assert` modules) to support automated `aider --test` execution.
