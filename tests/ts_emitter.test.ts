import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { emitTypeScript, GLOBAL_TS_HEADER } from '../src/compiler/ts_emitter.js';
import { ASTNode } from '../src/schemas.js';

describe('ts_emitter', () => {
  it('emits ModuleContainer with header', () => {
    const node: ASTNode = {
      id: '1',
      type: 'ModuleContainer',
      moduleName: 'test',
      exports: [],
      children: [
        {
          id: '2',
          type: 'ExpressionBlock',
          codeSnippet: 'console.log("hello")'
        }
      ]
    };
    const code = emitTypeScript(node);
    expect(code).toContain(GLOBAL_TS_HEADER);
    expect(code).toContain('console.log("hello");');
  });

  it('emits AsyncFunctionBlock', () => {
    const node: ASTNode = {
      id: '1',
      type: 'AsyncFunctionBlock',
      functionName: 'foo',
      parameters: [{ name: 'arg', tsType: 'string' }],
      returnType: 'Promise<string>',
      isExported: true,
      body: [
        {
          id: '2',
          type: 'ExpressionBlock',
          codeSnippet: 'return arg'
        }
      ]
    };
    const code = emitTypeScript(node, 0, false);
    expect(code).toContain('export async function foo(arg: string): Promise<string> {');
    expect(code).toContain('return arg;');
  });

  it('emits TryCatchGuardian', () => {
    const node: ASTNode = {
      id: '1',
      type: 'TryCatchGuardian',
      tryBranch: [{ id: '2', type: 'ExpressionBlock', codeSnippet: 'doSomething()' }],
      catchBranch: [{ id: '3', type: 'ExpressionBlock', codeSnippet: 'handleError(err)' }],
      errorVariableName: 'err'
    };
    const code = emitTypeScript(node, 0, false);
    expect(code).toContain('try {');
    expect(code).toContain('doSomething();');
    expect(code).toContain('} catch (err) {');
    expect(code).toContain('handleError(err);');
  });

  it('emits ConditionalBranch', () => {
    const node: ASTNode = {
      id: '1',
      type: 'ConditionalBranch',
      conditionExpression: 'x > 0',
      trueBranch: [{ id: '2', type: 'ExpressionBlock', codeSnippet: 'yes()' }],
      falseBranch: [{ id: '3', type: 'ExpressionBlock', codeSnippet: 'no()' }]
    };
    const code = emitTypeScript(node, 0, false);
    expect(code).toContain('if (x > 0) {');
    expect(code).toContain('yes();');
    expect(code).toContain('} else {');
    expect(code).toContain('no();');
  });

  it('emits LoopInterval (while, forOf, setInterval)', () => {
    const whileNode: ASTNode = {
      id: '1',
      type: 'LoopInterval',
      loopType: 'while',
      loopHeader: 'true',
      body: [{ id: '2', type: 'ExpressionBlock', codeSnippet: 'tick()' }]
    };
    expect(emitTypeScript(whileNode, 0, false)).toContain('while (true) {');

    const forOfNode: ASTNode = {
      id: '3',
      type: 'LoopInterval',
      loopType: 'forOf',
      loopHeader: 'const item of items',
      body: [{ id: '4', type: 'ExpressionBlock', codeSnippet: 'process(item)' }]
    };
    expect(emitTypeScript(forOfNode, 0, false)).toContain('for (const item of items) {');

    const setIntervalNode: ASTNode = {
      id: '5',
      type: 'LoopInterval',
      loopType: 'setInterval',
      loopHeader: '1000',
      body: [{ id: '6', type: 'ExpressionBlock', codeSnippet: 'poll()' }]
    };
    expect(emitTypeScript(setIntervalNode, 0, false)).toContain('setInterval(async () => {');
  });

  it('emits ExpressionBlock', () => {
    const node: ASTNode = {
      id: '1',
      type: 'ExpressionBlock',
      codeSnippet: 'const x = 1;'
    };
    expect(emitTypeScript(node, 0, false)).toBe('const x = 1;\n');
  });

  it('emits Solana nodes', () => {
    const conn: ASTNode = { id: '1', type: 'Solana_EstablishConnection', connectionVarName: 'conn', rpcEnvVar: 'RPC', commitment: 'confirmed' };
    expect(emitTypeScript(conn, 0, false)).toContain("const conn = new Connection(process.env.RPC || '', 'confirmed');");

    const wallet: ASTNode = { id: '2', type: 'Solana_ParseWallet', keypairVarName: 'kp', privateKeyEnvVar: 'PK' };
    expect(emitTypeScript(wallet, 0, false)).toContain("const kp = Keypair.fromSecretKey(bs58.decode(process.env.PK || ''));");

    const listen: ASTNode = {
      id: '3',
      type: 'Solana_ListenPumpFun',
      connectionVarName: 'conn',
      programAddress: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      accountInfoParamName: 'acc',
      callbackBody: [{ id: '4', type: 'ExpressionBlock', codeSnippet: 'console.log(acc)' }]
    };
    expect(emitTypeScript(listen, 0, false)).toContain('onProgramAccountChange');

    const sim: ASTNode = {
      id: '5',
      type: 'Solana_SimulatePayload',
      connectionVarName: 'conn',
      transactionVarName: 'tx',
      throwOnError: true
    };
    expect(emitTypeScript(sim, 0, false)).toContain('simulateTransaction(tx)');
  });

  it('emits File and SQLite/Redis nodes', () => {
    const logNode: ASTNode = { id: '1', type: 'File_AppendLog', filePath: 'a.txt', messageExpression: '"msg"' };
    expect(emitTypeScript(logNode, 0, false)).toContain("await fs.appendFile('a.txt'");

    const sqliteInit: ASTNode = { id: '2', type: 'Sqlite_InitDatabase', dbVarName: 'db', dbFilePath: 'test.db' };
    expect(emitTypeScript(sqliteInit, 0, false)).toContain("const db = new Database('test.db');");

    const sqliteWrite: ASTNode = { id: '3', type: 'Sqlite_ExecuteWrite', dbVarName: 'db', sqlQuery: 'INSERT...', paramsArrayExpression: '[]' };
    expect(emitTypeScript(sqliteWrite, 0, false)).toContain("db.prepare('INSERT...').run(...[]);");

    const sqliteRead: ASTNode = { id: '4', type: 'Sqlite_QueryRead', dbVarName: 'db', resultVarName: 'res', readMode: 'get', sqlQuery: 'SELECT...', paramsArrayExpression: '[]' };
    expect(emitTypeScript(sqliteRead, 0, false)).toContain("const res = db.prepare('SELECT...').get(...[]);");

    const redisInit: ASTNode = { id: '5', type: 'Redis_InitClient', redisVarName: 'redis', redisUrlEnvVar: 'REDIS_URL' };
    expect(emitTypeScript(redisInit, 0, false)).toContain("const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');");

    const redisPush: ASTNode = { id: '6', type: 'Redis_QueuePush', redisVarName: 'redis', queueKey: 'q', payloadExpression: 'data' };
    expect(emitTypeScript(redisPush, 0, false)).toContain("await redis.rpush('q', JSON.stringify(data));");

    const redisPop: ASTNode = { id: '7', type: 'Redis_QueueBlockingPop', redisVarName: 'redis', queueKey: 'q', resultVarName: 'res', timeoutSeconds: 5 };
    expect(emitTypeScript(redisPop, 0, false)).toContain("const res = await redis.blpop('q', 5);");
  });

  it('compiles full nested ModuleContainer with TypeScript compiler', () => {
    const fullModule: ASTNode = {
      id: 'root',
      type: 'ModuleContainer',
      moduleName: 'bot',
      exports: ['run'],
      children: [
        {
          id: 'fn',
          type: 'AsyncFunctionBlock',
          functionName: 'run',
          parameters: [],
          returnType: 'Promise<void>',
          isExported: true,
          body: [
            { id: 'c1', type: 'Solana_EstablishConnection', connectionVarName: 'connection', rpcEnvVar: 'RPC_URL', commitment: 'confirmed' },
            { id: 'c2', type: 'Sqlite_InitDatabase', dbVarName: 'db', dbFilePath: 'bot.db' },
            { id: 'c3', type: 'Redis_InitClient', redisVarName: 'redis', redisUrlEnvVar: 'REDIS_URL' },
            {
              id: 'c4',
              type: 'TryCatchGuardian',
              tryBranch: [
                {
                  id: 'c5',
                  type: 'Sqlite_QueryRead',
                  dbVarName: 'db',
                  resultVarName: 'rows',
                  readMode: 'all',
                  sqlQuery: 'SELECT * FROM queue',
                  paramsArrayExpression: '[]'
                }
              ],
              catchBranch: [
                {
                  id: 'c6',
                  type: 'File_AppendLog',
                  filePath: 'error.log',
                  messageExpression: 'error.message'
                }
              ],
              errorVariableName: 'error'
            }
          ]
        }
      ]
    };

    const emitted = emitTypeScript(fullModule);
    const { diagnostics } = ts.transpileModule(emitted, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext },
      reportDiagnostics: true,
    });
    const errors = diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) || [];
    expect(errors.length).toBe(0);
  });
});
