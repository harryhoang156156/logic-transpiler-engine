# Component Specification: `src/compiler/ts_emitter.ts`

## 1. Objective
Implement the deterministic Transpiler Code Emitter. Recursively traverses a validated `ASTNode` tree and emits cleanly indented, syntax-perfect TypeScript source code, injecting mandatory global headers and pre-verified Solana, SQLite (`better-sqlite3`), Redis (`ioredis`), and Node.js "Black Box" library snippets.

## 2. Dependencies
* External: None
* Internal: `../schemas.js`

## 3. Required Exports & Emission Rules

### A. Global File Header
Define `GLOBAL_TS_HEADER` constant prepended automatically when compiling a root `ModuleContainer`:
```typescript
import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
import fs from 'fs/promises';
import Database from 'better-sqlite3';
import { Redis } from 'ioredis';
dotenv.config();
```

### B. Core Recursive Function
**`emitTypeScript(node: ASTNode, indentLevel?: number, includeHeader?: boolean): string`**
Uses `const pad = '  '.repeat(indentLevel);` and handles every discriminated union case:
1. **`ModuleContainer`**: If `includeHeader` is true (default for root), prepend `GLOBAL_TS_HEADER + '\n'`. Emit each child in `node.children` separated by newlines.
2. **`AsyncFunctionBlock`**: Emit `${pad}${node.isExported ? 'export ' : ''}async function ${node.functionName}(${params}): ${node.returnType} {\n`, recursively emit `node.body` at `indentLevel + 1`, close with `${pad}}\n`.
3. **`TryCatchGuardian`**: Emit `${pad}try {\n`, recursively emit `node.tryBranch` at `indentLevel + 1`, emit `${pad}} catch (${node.errorVariableName}) {\n`, recursively emit `node.catchBranch` at `indentLevel + 1`, close with `${pad}}\n`.
4. **`ConditionalBranch`**: Emit `${pad}if (${node.conditionExpression}) {\n`, emit `trueBranch` at `indentLevel + 1`, and if `falseBranch` exists and has items, emit `${pad}} else {\n` + `falseBranch` at `indentLevel + 1`, close with `${pad}}\n`.
5. **`LoopInterval`**:
   * If `while`: `${pad}while (${node.loopHeader}) {\n` ... `${pad}}\n`
   * If `forOf`: `${pad}for (${node.loopHeader}) {\n` ... `${pad}}\n`
   * If `setInterval`: `${pad}setInterval(async () => {\n` ... `${pad}}, ${node.loopHeader});\n`
6. **`ExpressionBlock`**: Strip trailing semicolons from `node.codeSnippet.trim()` if present, then emit `${pad}${cleanSnippet};\n`.
7. **`Solana_EstablishConnection`**:
   Emit `${pad}const ${node.connectionVarName} = new Connection(process.env.${node.rpcEnvVar} || '', '${node.commitment}');\n`
8. **`Solana_ParseWallet`**:
   Emit `${pad}const ${node.keypairVarName} = Keypair.fromSecretKey(bs58.decode(process.env.${node.privateKeyEnvVar} || ''));\n`
9. **`Solana_ListenPumpFun`**:
   Emit:
   ```typescript
   ${pad}const subscriptionId = ${node.connectionVarName}.onProgramAccountChange(
   ${pad}  new PublicKey('${node.programAddress}'),
   ${pad}  async (${node.accountInfoParamName}) => {
   ${emittedCallbackBody}
   ${pad}  },
   ${pad}  'confirmed'
   ${pad});
   ```
10. **`Solana_SimulatePayload`**:
    Emit:
    ```typescript
    ${pad}const simulation = await ${node.connectionVarName}.simulateTransaction(${node.transactionVarName});
    ${node.throwOnError ? `${pad}if (simulation.value.err) throw new Error(\`Transaction simulation failed: \${JSON.stringify(simulation.value.err)}\`);\n` : ''}
    ```
11. **`File_AppendLog`**:
    Emit `${pad}await fs.appendFile('${node.filePath}', \`\${new Date().toISOString()} - \${${node.messageExpression}}\\n\`);\n`
12. **`Sqlite_InitDatabase`**:
    Emit `${pad}const ${node.dbVarName} = new Database('${node.dbFilePath}');\n`
13. **`Sqlite_ExecuteWrite`**:
    Emit `${pad}${node.dbVarName}.prepare('${node.sqlQuery}').run(...${node.paramsArrayExpression});\n`
14. **`Sqlite_QueryRead`**:
    Emit `${pad}const ${node.resultVarName} = ${node.dbVarName}.prepare('${node.sqlQuery}').${node.readMode}(...${node.paramsArrayExpression});\n`
15. **`Redis_InitClient`**:
    Emit `${pad}const ${node.redisVarName} = new Redis(process.env.${node.redisUrlEnvVar} || 'redis://127.0.0.1:6379');\n`
16. **`Redis_QueuePush`**:
    Emit `${pad}await ${node.redisVarName}.rpush('${node.queueKey}', JSON.stringify(${node.payloadExpression}));\n`
17. **`Redis_QueueBlockingPop`**:
    Emit `${pad}const ${node.resultVarName} = await ${node.redisVarName}.blpop('${node.queueKey}', ${node.timeoutSeconds});\n`

## 4. Test Requirements (`tests/ts_emitter.test.ts`)
* Test each of the 17 node types individually to verify exact string formatting and indentation.
* Test a full nested `ModuleContainer` containing Solana, SQLite (`Sqlite_InitDatabase`, `Sqlite_ExecuteWrite`, `Sqlite_QueryRead`), and Redis (`Redis_InitClient`, `Redis_QueuePush`, `Redis_QueueBlockingPop`) nodes and verify the output compiles cleanly when passed to TypeScript's syntax scanner (`ts.transpileModule`).
