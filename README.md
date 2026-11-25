# Logic Transpiler Engine

A deterministic, AST-bounded TypeScript code-generation and auditing engine designed for automated Solana trading architectures.

Instead of letting LLMs output freeform TypeScript text—which leads to syntax errors, hallucinated library methods, and broken file merges—this engine forces models to populate a strict, recursive **Zod JSON schema** (`ASTNodeSchema`). A deterministic compiler emits formatted TypeScript with pre-verified "Black Box" library templates and runs a programmatic `tsc --noEmit` self-correction loop before writing any code to disk.

---

## Architecture Overview

```text
[Markdown Specs / CLI Brief] ──► src/main.ts
                                    │
   ┌────────────────────────────────┼────────────────────────────────┐
   ▼                                ▼                                ▼
[Greenfield Mode]           [Blueprint Modify Mode]          [Audit-Only Mode]
ai_client.ts                parser.ts -> gap_analyzer.ts     parser.ts -> gap_analyzer.ts
   │                                │                                │
   │                        atomic_merger.ts                 GapAnalysisReport (JSON)
   └────────────────┬───────────────┘
                    ▼
             ts_emitter.ts  (Deterministic TypeScript + Library Black Boxes)
                    │
                    ▼
           compiler_guard.ts (Programmatic tsc --noEmit verification loop)
                    │
                    ▼
          [Verified .ts Output]
```

### Core Modules
* **`src/schemas.ts`** — Master Zod discriminated union (`ASTNodeSchema`) enforcing 5 core structural containers (`ModuleContainer`, `AsyncFunctionBlock`, `TryCatchGuardian`, `ConditionalBranch`, `LoopInterval`), `ExpressionBlock`, and 11 pre-verified library Black Box nodes.
* **`src/client/prompts.ts`** — Immutable system directives (`GENERATOR`, `AUDITOR`, `DEBUGGER`) constraining LLM behavior.
* **`src/client/ai_client.ts`** — Provider-agnostic OpenAI-compatible structured output gateway designed for **Bifrost AI Gateway** (with zero hardcoded model IDs).
* **`src/ingestion/parser.ts`** — Uses the native TypeScript Compiler API (`ts.createSourceFile`) to parse existing `.ts` files into clean `ASTNode` JSON trees.
* **`src/ingestion/gap_analyzer.ts`** — Audits existing AST graphs against feature briefs or review rules, classifying nodes as `KEEP_AS_IS`, `MUTATE_EXISTING`, or `SPAWN_NEW`.
* **`src/compiler/atomic_merger.ts`** — Performs deep-cloned, transactional in-memory AST replacements (`REPLACE` / `APPEND_TO_MODULE`) with automatic rollback on invalid target IDs.
* **`src/compiler/ts_emitter.ts`** — Recursively transpiles validated `ASTNode` trees into formatted TypeScript with pre-verified library templates.
* **`src/verification/compiler_guard.ts`** — Runs programmatic `ts.createProgram` (`noEmit: true`) checks and feeds compiler diagnostics back into the AI correction loop.
* **`src/main.ts`** — CLI entry point and pipeline orchestrator supporting Greenfield creation, Blueprint modification, and `--audit-only` code review mode.

---

## Supported Library Black Boxes

The emitter deterministically injects syntax-verified code templates for:
* **`@solana/web3.js`** — `Connection`, `PublicKey`, `Keypair`, `Transaction`, `VersionedTransaction`, `SystemProgram`, `onProgramAccountChange()`, `simulateTransaction()`
* **`bs58`** — `decode()`
* **`better-sqlite3`** — `Database()`, `prepare()`, `Statement.run()`, `Statement.all()`, `Statement.get()`
* **`ioredis`** — `Redis()`, `rpush()`, `blpop()`
* **`dotenv` & `node:fs/promises`** — `config()`, `appendFile()`

---

## Setup & Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   Copy `.env.example` to `.env` for local runs (or configure as GitHub Actions secrets):
   ```bash
   cp .env.example .env
   ```
   ```env
   BIFROST_BASE_URL=http://localhost:8080/openai/v1
   BIFROST_API_KEY=sk-bf-your_virtual_key_here
   LLM_MODEL=your-provider/model-name
   ```

3. **Build & run test suite:**
   ```bash
   npm run build && npm run test
   ```

---

## CLI Usage

### 1. Greenfield Module Generation
Generate a new TypeScript module from a markdown specification and global architecture rules:
```bash
npm start -- \
  --overview architecture_overview.md \
  --spec specs/feature_spec.md \
  --out output/generated_module.ts
```

### 2. In-Place Blueprint Modification
Parse an existing `.ts` file, audit gaps against new instructions, apply atomic AST patches, and verify with `tsc`:
```bash
npm start -- \
  --overview architecture_overview.md \
  --src output/generated_module.ts \
  --out output/generated_module.ts \
  --brief "Add error logging to SQLite when transaction simulation fails"
```

### 3. Audit-Only Code Review Mode (`--audit-only`)
Run a reasoning model to inspect an existing `.ts` file against OPSEC, dataflow, or architectural rules and output a structured `GapAnalysisReport` JSON without modifying code:
```bash
npm start -- \
  --audit-only \
  --src output/generated_module.ts \
  --brief "Audit for unhandled RPC disconnects and private key exposure"
```

---

## Autonomous TDD Build Pipeline

This repository uses `.github/workflows/aider-loop.yml` to build and verify modules incrementally from `specs/` using Vitest (`npm run build && npm run test`) before opening Pull Requests against `main`.
