import { describe, expect, it } from 'vitest';
import { ASTNodeSchema, GapAnalysisReportSchema, GapResolutionItemSchema } from '../src/schemas.js';

// Minimal inputs and expected defaults from specs/schemas.md. Exercise the public
// union so a schema accidentally omitted from it also fails these tests.
const cases = [
  { type: 'ModuleContainer', fields: { moduleName: 'worker', children: [] }, defaults: { exports: [] } },
  { type: 'AsyncFunctionBlock', fields: { functionName: 'run', parameters: [], body: [] }, defaults: { returnType: 'Promise<void>', isExported: true } },
  { type: 'TryCatchGuardian', fields: { tryBranch: [], catchBranch: [] }, defaults: { errorVariableName: 'error' } },
  { type: 'ConditionalBranch', fields: { conditionExpression: 'ready', trueBranch: [] }, defaults: {} },
  { type: 'LoopInterval', fields: { loopType: 'while', loopHeader: 'ready', body: [] }, defaults: {} },
  { type: 'ExpressionBlock', fields: { codeSnippet: 'run();' }, defaults: {} },
  { type: 'Solana_EstablishConnection', fields: {}, defaults: { connectionVarName: 'connection', rpcEnvVar: 'RPC_URL', commitment: 'confirmed' } },
  { type: 'Solana_ParseWallet', fields: {}, defaults: { keypairVarName: 'walletKeypair', privateKeyEnvVar: 'PRIVATE_KEY' } },
  { type: 'Solana_ListenPumpFun', fields: { callbackBody: [] }, defaults: { connectionVarName: 'connection', programAddress: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', accountInfoParamName: 'accountInfo' } },
  { type: 'Solana_SimulatePayload', fields: {}, defaults: { connectionVarName: 'connection', transactionVarName: 'transaction', throwOnError: true } },
  { type: 'File_AppendLog', fields: { messageExpression: 'String(error)' }, defaults: { filePath: 'logs.txt' } },
  { type: 'Sqlite_InitDatabase', fields: {}, defaults: { dbVarName: 'db', dbFilePath: 'engine.db' } },
  { type: 'Sqlite_ExecuteWrite', fields: { sqlQuery: 'INSERT INTO events VALUES (?)', paramsArrayExpression: '[event]' }, defaults: { dbVarName: 'db' } },
  { type: 'Sqlite_QueryRead', fields: { resultVarName: 'rows', readMode: 'all', sqlQuery: 'SELECT * FROM events' }, defaults: { dbVarName: 'db', paramsArrayExpression: '[]' } },
  { type: 'Redis_InitClient', fields: {}, defaults: { redisVarName: 'redis', redisUrlEnvVar: 'REDIS_URL' } },
  { type: 'Redis_QueuePush', fields: { queueKey: 'events', payloadExpression: 'JSON.stringify(event)' }, defaults: { redisVarName: 'redis' } },
  { type: 'Redis_QueueBlockingPop', fields: { queueKey: 'events', resultVarName: 'event' }, defaults: { redisVarName: 'redis', timeoutSeconds: 0 } },
];

function expectIssue(input: unknown, path: (string | number)[]) {
  const result = ASTNodeSchema.safeParse(input);
  expect(result.success).toBe(false);
  if (result.success) throw new Error('Expected validation to fail');
  expect(result.error.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({ path }),
  ]));
}

describe.each(cases)('$type validation', ({ type, fields, defaults }) => {
  const input = { id: 'node', type, ...fields };

  it('parses minimal input with exactly the documented defaults', () => {
    expect(ASTNodeSchema.parse(input)).toEqual({ ...input, ...defaults });
  });

  it('preserves the optional intent tag', () => {
    expect(ASTNodeSchema.parse({ ...input, intentTag: 'process events' })).toEqual({
      ...input, ...defaults, intentTag: 'process events',
    });
  });

  for (const field of ['id', 'type', ...Object.keys(fields)]) {
    it(`rejects missing required ${field}`, () => {
      const invalid: Record<string, unknown> = { ...input };
      delete invalid[field];
      expectIssue(invalid, [field]);
    });
  }

  for (const field of ['id', 'intentTag', ...Object.keys(fields), ...Object.keys(defaults)]) {
    it(`rejects null for ${field} instead of applying a default`, () => {
      expectIssue({ ...input, [field]: null }, [field]);
    });
    it(`rejects an object for ${field} without coercion`, () => {
      expectIssue({ ...input, [field]: {} }, [field]);
    });
  }

  for (const [field, value] of Object.entries(defaults)) {
    it(`defaults explicitly undefined ${field}`, () => {
      expect(ASTNodeSchema.parse({ ...input, [field]: undefined })).toEqual({ ...input, ...defaults });
    });
    it(`preserves an explicit override of ${field}`, () => {
      const override = Array.isArray(value) ? ['run']
        : typeof value === 'boolean' ? false
        : typeof value === 'number' ? 3
        : field === 'commitment' ? 'finalized' : 'custom';
      expect(ASTNodeSchema.parse({ ...input, [field]: override })).toEqual({
        ...input, ...defaults, [field]: override,
      });
    });
  }
});

const recursiveSlots = [
  ['ModuleContainer', 'children'], ['AsyncFunctionBlock', 'body'],
  ['TryCatchGuardian', 'tryBranch'], ['TryCatchGuardian', 'catchBranch'],
  ['ConditionalBranch', 'trueBranch'], ['ConditionalBranch', 'falseBranch'],
  ['LoopInterval', 'body'], ['Solana_ListenPumpFun', 'callbackBody'],
];

describe.each(recursiveSlots)('%s.%s recursion', (type, slot) => {
  const fixture = cases.find((item) => item.type === type)!;
  const parent = { id: 'parent', type, ...fixture.fields };

  it('parses children and applies defaults within nested nodes', () => {
    const parsed = ASTNodeSchema.parse({ ...parent, [slot]: [
      { id: 'nested', type: 'ModuleContainer', moduleName: 'nested', children: [
        { id: 'db', type: 'Sqlite_InitDatabase' },
      ] },
    ] });
    expect(parsed).toMatchObject({ [slot]: [{ exports: [], children: [
      { id: 'db', type: 'Sqlite_InitDatabase', dbVarName: 'db', dbFilePath: 'engine.db' },
    ] }] });
  });

  it('reports the full path to an invalid descendant', () => {
    expectIssue({ ...parent, [slot]: [
      { id: 'nested', type: 'ModuleContainer', moduleName: 'nested', children: [
        { id: 'invalid', type: 'Redis_QueuePush', payloadExpression: 'event' },
      ] },
    ] }, [slot, 0, 'children', 0, 'queueKey']);
  });

  it.each([null, 42, { id: 'child' }])('rejects malformed child %j', (child) => {
    expect(ASTNodeSchema.safeParse({ ...parent, [slot]: [child] }).success).toBe(false);
  });
});

describe('structured field constraints', () => {
  it.each(['while', 'forOf', 'setInterval'])('accepts loop mode %s', (loopType) => {
    expect(ASTNodeSchema.safeParse({ id: 'loop', type: 'LoopInterval', loopType, loopHeader: 'items', body: [] }).success).toBe(true);
  });

  it.each(['processed', 'confirmed', 'finalized'])('accepts commitment %s', (commitment) => {
    expect(ASTNodeSchema.parse({ id: 'rpc', type: 'Solana_EstablishConnection', commitment })).toMatchObject({ commitment });
  });

  it.each(['all', 'get'])('accepts read mode %s', (readMode) => {
    expect(ASTNodeSchema.parse({ id: 'read', type: 'Sqlite_QueryRead', resultVarName: 'rows', sqlQuery: 'SELECT 1', readMode })).toMatchObject({ readMode });
  });

  it.each([
    { type: 'LoopInterval', loopType: 'for', loopHeader: 'items', body: [] },
    { type: 'Solana_EstablishConnection', commitment: 'recent' },
    { type: 'Sqlite_QueryRead', resultVarName: 'rows', sqlQuery: 'SELECT 1', readMode: 'first' },
    { type: 'ModuleContainer', moduleName: 'worker', children: [], exports: [42] },
    { type: 'AsyncFunctionBlock', functionName: 'run', body: [], parameters: [{ name: 'event' }] },
    { type: 'AsyncFunctionBlock', functionName: 'run', body: [], parameters: [{ name: 42, tsType: 'string' }] },
    { type: 'Redis_QueueBlockingPop', queueKey: 'events', resultVarName: 'event', timeoutSeconds: '5' },
    { type: 'Redis_QueueBlockingPop', queueKey: 'events', resultVarName: 'event', timeoutSeconds: NaN },
    { type: 'Solana_SimulatePayload', throwOnError: 'false' },
  ])('rejects invalid structured fields: %j', (fields) => {
    expect(ASTNodeSchema.safeParse({ id: 'invalid', ...fields }).success).toBe(false);
  });

  it('leaves an omitted false branch absent and preserves an explicit empty branch', () => {
    const input = { id: 'if', type: 'ConditionalBranch', conditionExpression: 'ready', trueBranch: [] };
    expect(ASTNodeSchema.parse(input)).not.toHaveProperty('falseBranch');
    expect(ASTNodeSchema.parse({ ...input, falseBranch: [] })).toHaveProperty('falseBranch', []);
  });
});

describe('ExpressionBlock syntax validation', () => {
  it.each(['const = 1;', 'const x = "unterminated;', '/* unterminated', 'const x = ;'])('rejects invalid syntax beyond brace balancing: %s', (codeSnippet) => {
    expectIssue({ id: 'expression', type: 'ExpressionBlock', codeSnippet }, ['codeSnippet']);
  });

  it('checks syntax without executing the snippet or requiring identifiers to resolve', () => {
    const codeSnippet = 'throw new Error("must not execute"); unknownFunction();';
    expect(ASTNodeSchema.parse({ id: 'expression', type: 'ExpressionBlock', codeSnippet })).toHaveProperty('codeSnippet', codeSnippet);
  });
});

describe('gap resolution validation', () => {
  const item = { targetNodeId: 'target', resolution: 'KEEP_AS_IS', reasoning: 'Already implemented' };

  it.each(['KEEP_AS_IS', 'MUTATE_EXISTING', 'SPAWN_NEW'])('accepts %s with and without optional mutation details', (resolution) => {
    expect(GapResolutionItemSchema.parse({ ...item, resolution })).toEqual({ ...item, resolution });
    expect(GapResolutionItemSchema.parse({ ...item, resolution, specificationForMutation: 'Add logging' })).toEqual({ ...item, resolution, specificationForMutation: 'Add logging' });
  });

  for (const field of ['targetNodeId', 'resolution', 'reasoning']) {
    it(`requires ${field}`, () => {
      const invalid: Record<string, unknown> = { ...item };
      delete invalid[field];
      expect(GapResolutionItemSchema.safeParse(invalid).success).toBe(false);
    });
  }

  it.each(['targetNodeId', 'resolution', 'reasoning', 'specificationForMutation'])('rejects non-string %s', (field) => {
    for (const value of [null, 42, {}, []]) {
      expect(GapResolutionItemSchema.safeParse({ ...item, [field]: value }).success).toBe(false);
    }
  });

  it.each([null, {}, 'actions', [null], [{ ...item, resolution: 'DELETE' }]])('rejects malformed report actions %j', (actions) => {
    expect(GapAnalysisReportSchema.safeParse({ actions }).success).toBe(false);
  });

  it('rejects a report containing an invalid action after a valid action', () => {
    const result = GapAnalysisReportSchema.safeParse({ actions: [item, { ...item, reasoning: 42 }] });
    expect(result.success).toBe(false);
    if (result.success) throw new Error('Expected invalid report');
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['actions', 1, 'reasoning'] }),
    ]));
  });
});
