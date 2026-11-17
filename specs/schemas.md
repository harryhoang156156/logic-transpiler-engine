# Component Specification: `src/schemas.ts`

## 1. Objective
Define the immutable Zod schemas and inferred TypeScript types that govern the entire engine. This file acts as the strict contract enforced upon the LLM's structured outputs and validated across all internal pipeline stages.

## 2. Dependencies
* External: `zod`
* Internal: None

## 3. Required Exports & Data Structures

### A. Base Node Properties
Every node in the AST must include:
* `id`: `z.string()` (Unique identifier, e.g., `"node_01"`, required for `atomic_merger.ts` targeting).
* `intentTag`: `z.string().optional()` (Semantic description of the node's purpose, used by `gap_analyzer.ts`).

### B. Core Structural Containers (5 Mandatory Types)
Use `z.lazy()` for recursive child arrays (`children: z.lazy(() => z.array(ASTNodeSchema))`).
1. **`ModuleContainerSchema`**:
   * `type: z.literal('ModuleContainer')`
   * `moduleName: z.string()`
   * `exports: z.array(z.string()).default([])`
   * `children: z.lazy(() => z.array(ASTNodeSchema))`
2. **`AsyncFunctionBlockSchema`**:
   * `type: z.literal('AsyncFunctionBlock')`
   * `functionName: z.string()`
   * `parameters: z.array(z.object({ name: z.string(), tsType: z.string() }))`
   * `returnType: z.string().default('Promise<void>')`
   * `isExported: z.boolean().default(true)`
   * `body: z.lazy(() => z.array(ASTNodeSchema))`
3. **`TryCatchGuardianSchema`**:
   * `type: z.literal('TryCatchGuardian')`
   * `tryBranch: z.lazy(() => z.array(ASTNodeSchema))`
   * `catchBranch: z.lazy(() => z.array(ASTNodeSchema))`
   * `errorVariableName: z.string().default('error')`
4. **`ConditionalBranchSchema`**:
   * `type: z.literal('ConditionalBranch')`
   * `conditionExpression: z.string()`
   * `trueBranch: z.lazy(() => z.array(ASTNodeSchema))`
   * `falseBranch: z.lazy(() => z.array(ASTNodeSchema)).optional()`
5. **`LoopIntervalSchema`**:
   * `type: z.literal('LoopInterval')`
   * `loopType: z.enum(['while', 'forOf', 'setInterval'])`
   * `loopHeader: z.string()` (e.g., `"const item of items"` or `"true"` or `"1000"`)
   * `body: z.lazy(() => z.array(ASTNodeSchema))`

### C. Loose Token Node
6. **`ExpressionBlockSchema`**:
   * `type: z.literal('ExpressionBlock')`
   * `codeSnippet: z.string()` (Single statement or variable assignment; must not contain unbalanced braces).

### D. Solana, SQLite, Redis & Node.js "Black Box" Library Nodes
7. **`SolanaEstablishConnectionSchema`**:
   * `type: z.literal('Solana_EstablishConnection')`
   * `connectionVarName: z.string().default('connection')`
   * `rpcEnvVar: z.string().default('RPC_URL')`
   * `commitment: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed')`
8. **`SolanaParseWalletSchema`**:
   * `type: z.literal('Solana_ParseWallet')`
   * `keypairVarName: z.string().default('walletKeypair')`
   * `privateKeyEnvVar: z.string().default('PRIVATE_KEY')`
9. **`SolanaListenPumpFunSchema`**:
   * `type: z.literal('Solana_ListenPumpFun')`
   * `connectionVarName: z.string().default('connection')`
<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:4ed1c33aaf2cea5c3e905402b1fc24ff3c59f2a25449a96c63414c5a08acc60d -->

   * `programAddress: z.string().default('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P')`

<!-- /coderabbit-ai-generated:v1 -->
   * `accountInfoParamName: z.string().default('accountInfo')`
   * `callbackBody: z.lazy(() => z.array(ASTNodeSchema))`
10. **`SolanaSimulatePayloadSchema`**:
    * `type: z.literal('Solana_SimulatePayload')`
    * `connectionVarName: z.string().default('connection')`
    * `transactionVarName: z.string().default('transaction')`
    * `throwOnError: z.boolean().default(true)`
11. **`FileAppendLogSchema`**:
    * `type: z.literal('File_AppendLog')`
    * `filePath: z.string().default('logs.txt')`
    * `messageExpression: z.string()`
12. **`SqliteInitDatabaseSchema`**:
    * `type: z.literal('Sqlite_InitDatabase')`
    * `dbVarName: z.string().default('db')`
    * `dbFilePath: z.string().default('engine.db')`
13. **`SqliteExecuteWriteSchema`**:
    * `type: z.literal('Sqlite_ExecuteWrite')`
    * `dbVarName: z.string().default('db')`
    * `sqlQuery: z.string()` (Parameterized SQL string with `?` placeholders, e.g., `"INSERT INTO transactions (tx, amount) VALUES (?, ?)"`)
    * `paramsArrayExpression: z.string()` (TypeScript array literal expression, e.g., `"[txHash, amount]"`)
14. **`SqliteQueryReadSchema`**:
    * `type: z.literal('Sqlite_QueryRead')`
    * `dbVarName: z.string().default('db')`
    * `resultVarName: z.string()`
    * `readMode: z.enum(['all', 'get'])`
    * `sqlQuery: z.string()` (Parameterized SQL `SELECT` string with `?` placeholders)
    * `paramsArrayExpression: z.string().default('[]')`
15. **`RedisInitClientSchema`**:
    * `type: z.literal('Redis_InitClient')`
    * `redisVarName: z.string().default('redis')`
    * `redisUrlEnvVar: z.string().default('REDIS_URL')`
16. **`RedisQueuePushSchema`**:
    * `type: z.literal('Redis_QueuePush')`
    * `redisVarName: z.string().default('redis')`
    * `queueKey: z.string()`
    * `payloadExpression: z.string()`
17. **`RedisQueueBlockingPopSchema`**:
    * `type: z.literal('Redis_QueueBlockingPop')`
    * `redisVarName: z.string().default('redis')`
    * `queueKey: z.string()`
    * `resultVarName: z.string()`
    * `timeoutSeconds: z.number().default(0)`

### E. Master Discriminated Union & Auxiliary Schemas
* **`ASTNodeSchema`**: `z.ZodType<ASTNode>` combining all 17 node schemas above.
* **`GapResolutionItemSchema`**:
  * `targetNodeId: z.string()`
  * `resolution: z.enum(['KEEP_AS_IS', 'MUTATE_EXISTING', 'SPAWN_NEW'])`
  * `reasoning: z.string()`
  * `specificationForMutation: z.string().optional()`
* **`GapAnalysisReportSchema`**: `z.object({ actions: z.array(GapResolutionItemSchema) })`
* Export inferred TypeScript types for all schemas (`ASTNode`, `GapAnalysisReport`, `GapResolutionItem`, etc.).

## 4. Test Requirements (`tests/schemas.test.ts`)
* Verify valid nested JSON structures parse cleanly via `ASTNodeSchema.parse()`.
* Verify invalid node types or missing required fields throw a `ZodError`.
* Verify recursive nesting combining Solana, SQLite (`Sqlite_InitDatabase`, `Sqlite_ExecuteWrite`, `Sqlite_QueryRead`), and Redis (`Redis_InitClient`, `Redis_QueuePush`, `Redis_QueueBlockingPop`) nodes.
