import { describe, it, expect, assertType } from 'vitest';
import type { ASTNode, BaseNode, ExpressionBlock } from '../src/schemas.js';
import { ZodError } from 'zod';
import {
  ASTNodeSchema,
  GapAnalysisReportSchema,
  GapResolutionItemSchema,
} from '../src/schemas.js';

describe('ASTNodeSchema', () => {
  it('parses a valid nested JSON structure', () => {
    const validModule = {
      id: 'mod_01',
      intentTag: 'root module',
      type: 'ModuleContainer',
      moduleName: 'bot',
      exports: ['main'],
      children: [
        {
          id: 'fn_01',
          intentTag: 'entry point',
          type: 'AsyncFunctionBlock',
          functionName: 'main',
          parameters: [],
          returnType: 'Promise<void>',
          isExported: true,
          body: [
            {
              id: 'try_01',
              type: 'TryCatchGuardian',
              tryBranch: [
                {
                  id: 'expr_01',
                  type: 'ExpressionBlock',
                  codeSnippet: 'console.log("starting");',
                },
              ],
              catchBranch: [
                {
                  id: 'log_01',
                  type: 'File_AppendLog',
                  filePath: 'logs.txt',
                  messageExpression: 'String(error)',
                },
              ],
              errorVariableName: 'error',
            },
          ],
        },
      ],
    };

    const result = ASTNodeSchema.parse(validModule);
    expect(result.type).toBe('ModuleContainer');
    expect(result.id).toBe('mod_01');
  });

  it('parses a valid structure with conditional and loop nodes', () => {
    const node = {
      id: 'fn_loop',
      type: 'AsyncFunctionBlock',
      functionName: 'runner',
      parameters: [{ name: 'items', tsType: 'string[]' }],
      body: [
        {
          id: 'loop_01',
          type: 'LoopInterval',
          loopType: 'forOf',
          loopHeader: 'const item of items',
          body: [
            {
              id: 'cond_01',
              type: 'ConditionalBranch',
              conditionExpression: 'item.length > 0',
              trueBranch: [
                {
                  id: 'expr_02',
                  type: 'ExpressionBlock',
                  codeSnippet: 'console.log(item);',
                },
              ],
              falseBranch: [
                {
                  id: 'expr_03',
                  type: 'ExpressionBlock',
                  codeSnippet: 'console.log("empty");',
                },
              ],
            },
          ],
        },
      ],
    };

    const result = ASTNodeSchema.parse(node);
    expect(result.type).toBe('AsyncFunctionBlock');
  });

  it('throws ZodError for invalid node type', () => {
    const invalid = {
      id: 'bad_01',
      type: 'UnknownNodeType',
    };

    expect(() => ASTNodeSchema.parse(invalid)).toThrow(ZodError);
  });

  it('throws ZodError for missing required fields', () => {
    const missingFields = {
      id: 'mod_bad',
      type: 'ModuleContainer',
      // missing moduleName and children
    };

    expect(() => ASTNodeSchema.parse(missingFields)).toThrow(ZodError);
  });

  it('throws ZodError when ExpressionBlock is missing codeSnippet', () => {
    const invalid = {
      id: 'expr_bad',
      type: 'ExpressionBlock',
    };

    expect(() => ASTNodeSchema.parse(invalid)).toThrow(ZodError);
  });

  it.each([
    'if (ready) { run();',
    'run(); }',
    '} {',
    'const value = { nested: { count: 1 };',
    'const value = `result: ${ { count: 1 }`;',
  ])('rejects unbalanced snippet: %s', (codeSnippet) => {
    expect(() => ASTNodeSchema.parse({
      id: 'expr_unbalanced', type: 'ExpressionBlock', codeSnippet,
    })).toThrow(ZodError);
  });

  it.each([
    'const value = { nested: { count: 1 } };',
    'console.log("{");',
    "console.log('}');",
    '/* { */ run(); // } }',
    'const value = `literal { ${JSON.stringify({ count: 1 })}`;',
    'const pattern = /[{}]/;',
    'const result: number = await work();',
    'return { count: 1 };',
  ])('accepts valid snippet: %s', (codeSnippet) => {
    const result = ASTNodeSchema.parse({
      id: 'expr_valid', type: 'ExpressionBlock', codeSnippet,
    });
    if (result.type !== 'ExpressionBlock') throw new Error('Unexpected node type');
    assertType<ExpressionBlock>(result);
    assertType<BaseNode>(result);
    assertType<ASTNode>(result);
    expect(result.codeSnippet).toBe(codeSnippet);
  });

  it('defaults the Pump listener to the documented program address', () => {
    const result = ASTNodeSchema.parse({
      id: 'listen_default', type: 'Solana_ListenPumpFun', callbackBody: [],
    });
    expect(result).toMatchObject({
      programAddress: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    });
  });

  it('applies default values correctly', () => {
    const moduleNode = {
      id: 'mod_defaults',
      type: 'ModuleContainer',
      moduleName: 'testMod',
      children: [],
    };

    const result = ASTNodeSchema.parse(moduleNode);
    expect(result).toMatchObject({
      type: 'ModuleContainer',
      exports: [],
    });

    const fnNode = {
      id: 'fn_defaults',
      type: 'AsyncFunctionBlock',
      functionName: 'doWork',
      parameters: [],
      body: [],
    };

    const fnResult = ASTNodeSchema.parse(fnNode);
    expect(fnResult).toMatchObject({
      type: 'AsyncFunctionBlock',
      returnType: 'Promise<void>',
      isExported: true,
    });
  });

  it('verifies recursive nesting combining Solana, SQLite, and Redis nodes', () => {
    const complexNode = {
      id: 'mod_complex',
      type: 'ModuleContainer',
      moduleName: 'tradingBot',
      exports: ['run'],
      children: [
        {
          id: 'fn_run',
          type: 'AsyncFunctionBlock',
          functionName: 'run',
          parameters: [],
          body: [
            {
              id: 'sol_conn',
              type: 'Solana_EstablishConnection',
              connectionVarName: 'connection',
              rpcEnvVar: 'RPC_URL',
              commitment: 'confirmed',
            },
            {
              id: 'sol_wallet',
              type: 'Solana_ParseWallet',
              keypairVarName: 'walletKeypair',
              privateKeyEnvVar: 'PRIVATE_KEY',
            },
            {
              id: 'sqlite_init',
              type: 'Sqlite_InitDatabase',
              dbVarName: 'db',
              dbFilePath: 'engine.db',
            },
            {
              id: 'redis_init',
              type: 'Redis_InitClient',
              redisVarName: 'redis',
              redisUrlEnvVar: 'REDIS_URL',
            },
            {
              id: 'listen_01',
              type: 'Solana_ListenPumpFun',
              connectionVarName: 'connection',
              callbackBody: [
                {
                  id: 'sqlite_write',
                  type: 'Sqlite_ExecuteWrite',
                  dbVarName: 'db',
                  sqlQuery: 'INSERT INTO transactions (tx, amount) VALUES (?, ?)',
                  paramsArrayExpression: '[txHash, amount]',
                },
                {
                  id: 'sqlite_read',
                  type: 'Sqlite_QueryRead',
                  dbVarName: 'db',
                  resultVarName: 'rows',
                  readMode: 'all',
                  sqlQuery: 'SELECT * FROM transactions WHERE tx = ?',
                  paramsArrayExpression: '[txHash]',
                },
                {
                  id: 'redis_push',
                  type: 'Redis_QueuePush',
                  redisVarName: 'redis',
                  queueKey: 'signals',
                  payloadExpression: 'JSON.stringify(signal)',
                },
                {
                  id: 'redis_pop',
                  type: 'Redis_QueueBlockingPop',
                  redisVarName: 'redis',
                  queueKey: 'signals',
                  resultVarName: 'popped',
                  timeoutSeconds: 5,
                },
                {
                  id: 'simulate_01',
                  type: 'Solana_SimulatePayload',
                  connectionVarName: 'connection',
                  transactionVarName: 'transaction',
                  throwOnError: true,
                },
              ],
            },
          ],
        },
      ],
    };

    const result = ASTNodeSchema.parse(complexNode);
    expect(result.type).toBe('ModuleContainer');
    if (result.type !== 'ModuleContainer') throw new Error('Unexpected node type');
    expect(result.moduleName).toBe('tradingBot');
  });
});

describe('GapResolutionItemSchema', () => {
  it('parses a valid resolution item', () => {
    const item = {
      targetNodeId: 'node_01',
      resolution: 'MUTATE_EXISTING',
      reasoning: 'Needs updated RPC endpoint handling',
      specificationForMutation: 'Add retry logic',
    };

    const result = GapResolutionItemSchema.parse(item);
    expect(result.resolution).toBe('MUTATE_EXISTING');
    expect(result.specificationForMutation).toBe('Add retry logic');
  });

  it('parses a valid resolution item without optional specification', () => {
    const item = {
      targetNodeId: 'node_02',
      resolution: 'KEEP_AS_IS',
      reasoning: 'Already correct',
    };

    const result = GapResolutionItemSchema.parse(item);
    expect(result.specificationForMutation).toBeUndefined();
  });

  it('throws ZodError for invalid resolution enum', () => {
    const item = {
      targetNodeId: 'node_03',
      resolution: 'INVALID_ACTION',
      reasoning: 'test',
    };

    expect(() => GapResolutionItemSchema.parse(item)).toThrow(ZodError);
  });
});

describe('GapAnalysisReportSchema', () => {
  it('parses a valid gap analysis report', () => {
    const report = {
      actions: [
        {
          targetNodeId: 'node_01',
          resolution: 'KEEP_AS_IS',
          reasoning: 'No changes needed',
        },
        {
          targetNodeId: 'node_02',
          resolution: 'SPAWN_NEW',
          reasoning: 'Missing Redis integration',
          specificationForMutation: 'Add Redis queue consumer',
        },
      ],
    };

    const result = GapAnalysisReportSchema.parse(report);
    expect(result.actions).toHaveLength(2);
    expect(result.actions[1].resolution).toBe('SPAWN_NEW');
  });

  it('parses an empty actions array', () => {
    const report = { actions: [] };
    const result = GapAnalysisReportSchema.parse(report);
    expect(result.actions).toEqual([]);
  });

  it('throws ZodError when actions is missing', () => {
    expect(() => GapAnalysisReportSchema.parse({})).toThrow(ZodError);
  });
});
