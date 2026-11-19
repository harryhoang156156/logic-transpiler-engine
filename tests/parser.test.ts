import { describe, it, expect, beforeEach } from 'vitest';
import { parseTypeScriptCode } from '../src/ingestion/parser.js';
import { ASTNodeSchema } from '../src/schemas.js';

describe('parser.ts', () => {
  beforeEach(() => {
    // Reset any internal state if needed
  });

  it('should parse a multi-construct TypeScript sample and produce valid ASTNode', () => {
    const sampleCode = `
import { Connection, PublicKey } from '@solana/web3.js';
import * as fs from 'fs/promises';

async function processWallet(privateKey: string): Promise<void> {
  const connection = new Connection('https://api.mainnet-beta.solana.com');
  
  try {
    const wallet = parseWallet(privateKey);
    
    if (wallet.publicKey.toBase58().length > 0) {
      console.log('Valid wallet');
    } else {
      console.log('Invalid wallet');
    }
    
    for (const item of ['a', 'b', 'c']) {
      await fs.writeFile(\`log-\${item}.txt\`, item);
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

function parseWallet(key: string) {
  return { publicKey: new PublicKey(key) };
}

const CONFIG = { retries: 3 };
`;

    const ast = parseTypeScriptCode(sampleCode, 'test-module');

    // Validate against schema
    const result = ASTNodeSchema.safeParse(ast);
    expect(result.success).toBe(true);

    // Check root is ModuleContainer
    expect(ast.type).toBe('ModuleContainer');
    expect(ast.moduleName).toBe('test-module');
    expect(Array.isArray(ast.children)).toBe(true);

    // Should have 3 top-level children: async function, function, const
    // (imports are skipped)
    expect(ast.children.length).toBe(3);

    // First child: AsyncFunctionBlock (processWallet)
    const processWallet = ast.children[0];
    expect(processWallet.type).toBe('AsyncFunctionBlock');
    expect(processWallet.functionName).toBe('processWallet');
    expect(processWallet.parameters).toEqual([
      { name: 'privateKey', tsType: 'string' }
    ]);
    expect(processWallet.returnType).toBe('Promise<void>');
    expect(processWallet.isExported).toBe(false);
    expect(Array.isArray(processWallet.body)).toBe(true);

    // Check nested structure inside processWallet
    // Should have 2 children: ExpressionBlock (connection) + TryCatchGuardian
    expect(processWallet.body.length).toBe(2);
    
    // First child in body: ExpressionBlock for connection declaration
    const connectionDecl = processWallet.body[0];
    expect(connectionDecl.type).toBe('ExpressionBlock');
    expect(connectionDecl.codeSnippet).toContain('const connection = new Connection');
    
    // Second child in body: TryCatchGuardian
    const tryCatch = processWallet.body[1];
    expect(tryCatch.type).toBe('TryCatchGuardian');
    expect(tryCatch.tryBranch.length).toBeGreaterThan(0);
    expect(tryCatch.catchBranch.length).toBeGreaterThan(0);

    // Inside tryBranch: ExpressionBlock (wallet), ConditionalBranch, LoopInterval
    const tryBranch = tryCatch.tryBranch;
    expect(tryBranch[0].type).toBe('ExpressionBlock');
    expect(tryBranch[0].codeSnippet).toContain('const wallet = parseWallet');
    expect(tryBranch[1].type).toBe('ConditionalBranch');
    expect(tryBranch[2].type).toBe('LoopInterval');

    // Check ConditionalBranch
    const conditional = tryBranch[1];
    expect(conditional.conditionExpression).toContain('wallet.publicKey.toBase58().length > 0');
    expect(conditional.trueBranch.length).toBe(1);
    expect(conditional.falseBranch?.length).toBe(1);

    // Check LoopInterval
    const loop = tryBranch[2];
    expect(loop.loopType).toBe('forOf');
    expect(loop.loopHeader).toContain('item of');
    expect(loop.body.length).toBe(1);

    // Second child: AsyncFunctionBlock (parseWallet) - not async but parsed as AsyncFunctionBlock
    const parseWalletFn = ast.children[1];
    expect(parseWalletFn.type).toBe('AsyncFunctionBlock');
    expect(parseWalletFn.functionName).toBe('parseWallet');

    // Third child: ExpressionBlock (const CONFIG)
    const config = ast.children[2];
    expect(config.type).toBe('ExpressionBlock');
    expect(config.codeSnippet).toContain('CONFIG');
    expect(config.codeSnippet).toContain('retries: 3');
    // Should not have trailing semicolon
    expect(config.codeSnippet).not.toMatch(/;\s*$/);
  });

  it('should skip import declarations', () => {
    const code = `
import { foo } from 'bar';
import * as baz from 'qux';
const x = 1;
`;

    const ast = parseTypeScriptCode(code);
    // Only the const declaration should remain
    expect(ast.children.length).toBe(1);
    expect(ast.children[0].type).toBe('ExpressionBlock');
    expect(ast.children[0].codeSnippet).toContain('const x = 1');
  });

  it('should handle while loops', () => {
    const code = `
while (condition) {
  doSomething();
}
`;

    const ast = parseTypeScriptCode(code);
    expect(ast.children.length).toBe(1);
    const loop = ast.children[0];
    expect(loop.type).toBe('LoopInterval');
    expect(loop.loopType).toBe('while');
    expect(loop.loopHeader).toBe('condition');
    expect(loop.body.length).toBe(1);
    expect(loop.body[0].type).toBe('ExpressionBlock');
  });

  it('should handle try/catch with error variable', () => {
    const code = `
try {
  risky();
} catch (err) {
  handle(err);
}
`;

    const ast = parseTypeScriptCode(code);
    expect(ast.children.length).toBe(1);
    const tryCatch = ast.children[0];
    expect(tryCatch.type).toBe('TryCatchGuardian');
    expect(tryCatch.errorVariableName).toBe('err');
    expect(tryCatch.tryBranch.length).toBe(1);
    expect(tryCatch.catchBranch.length).toBe(1);
  });

  it('should handle if/else if/else chains', () => {
    const code = `
if (a) {
  foo();
} else if (b) {
  bar();
} else {
  baz();
}
`;

    const ast = parseTypeScriptCode(code);
    expect(ast.children.length).toBe(1);
    const conditional = ast.children[0];
    expect(conditional.type).toBe('ConditionalBranch');
    expect(conditional.conditionExpression).toBe('a');
    expect(conditional.trueBranch.length).toBe(1);
    expect(conditional.falseBranch?.length).toBe(1);
    
    // The else if becomes a nested ConditionalBranch in falseBranch
    const elseIf = conditional.falseBranch![0];
    expect(elseIf.type).toBe('ConditionalBranch');
    expect(elseIf.conditionExpression).toBe('b');
  });

  it('should generate sequential node IDs', () => {
    const code = `
const a = 1;
const b = 2;
const c = 3;
`;

    const ast = parseTypeScriptCode(code);
    const ids = ast.children.map(c => c.id);
    expect(ids).toEqual(['node_1', 'node_2', 'node_3']);
    expect(ast.id).toBe('node_4'); // ModuleContainer gets the last ID
  });

  it('should strip trailing semicolons from ExpressionBlock', () => {
    const code = `
const x = 1;
const y = 2;
`;

    const ast = parseTypeScriptCode(code);
    for (const child of ast.children) {
      expect(child.type).toBe('ExpressionBlock');
      expect(child.codeSnippet).not.toMatch(/;\s*$/);
    }
  });

  it('should preserve functions with default parameters as ExpressionBlock', () => {
    const code = `
function greet(name: string = 'world') {
  return name;
}
`;

    const ast = parseTypeScriptCode(code);
    expect(ast.children.length).toBe(1);
    const fn = ast.children[0];
    expect(fn.type).toBe('ExpressionBlock');
    expect(fn.codeSnippet).toContain('function greet');
    expect(fn.codeSnippet).toContain("name: string = 'world'");
  });

  it('should preserve functions with optional parameters as ExpressionBlock', () => {
    const code = `
function greet(name?: string) {
  return name;
}
`;

    const ast = parseTypeScriptCode(code);
    expect(ast.children.length).toBe(1);
    const fn = ast.children[0];
    expect(fn.type).toBe('ExpressionBlock');
    expect(fn.codeSnippet).toContain('name?: string');
  });

  it('should preserve functions with rest parameters as ExpressionBlock', () => {
    const code = `
function greet(...names: string[]) {
  return names;
}
`;

    const ast = parseTypeScriptCode(code);
    expect(ast.children.length).toBe(1);
    const fn = ast.children[0];
    expect(fn.type).toBe('ExpressionBlock');
    expect(fn.codeSnippet).toContain('...names: string[]');
  });

  it('should preserve functions with type parameters as ExpressionBlock', () => {
    const code = `
function identity<T>(value: T): T {
  return value;
}
`;

    const ast = parseTypeScriptCode(code);
    expect(ast.children.length).toBe(1);
    const fn = ast.children[0];
    expect(fn.type).toBe('ExpressionBlock');
    expect(fn.codeSnippet).toContain('function identity<T>');
  });

  it('should preserve for-await-of loops as ExpressionBlock', () => {
    const code = `
async function run() {
  for await (const item of items) {
    console.log(item);
  }
}
`;

    const ast = parseTypeScriptCode(code);
    expect(ast.children.length).toBe(1);
    const fn = ast.children[0];
    expect(fn.type).toBe('AsyncFunctionBlock');
    expect(fn.body.length).toBe(1);
    const loop = fn.body[0];
    expect(loop.type).toBe('ExpressionBlock');
    expect(loop.codeSnippet).toContain('for await');
  });

  it('should preserve the terminating semicolon for a for-await loop with an empty body', () => {
    const code = `
async function run() {
  for await (const item of items);
}
`;

    const ast = parseTypeScriptCode(code);
    expect(ast.children.length).toBe(1);
    const fn = ast.children[0];
    expect(fn.type).toBe('AsyncFunctionBlock');
    expect(fn.body.length).toBe(1);
    const loop = fn.body[0];
    expect(loop.type).toBe('ExpressionBlock');
    expect(loop.codeSnippet).toContain('for await');
    // The terminating semicolon is the loop body itself and must be preserved
    // so the emitted snippet remains valid TypeScript.
    expect(loop.codeSnippet).toMatch(/;\s*$/);
  });

  it('should preserve try/finally statements as ExpressionBlock', () => {
    const code = `
try {
  risky();
} finally {
  cleanup();
}
`;

    const ast = parseTypeScriptCode(code);
    expect(ast.children.length).toBe(1);
    const stmt = ast.children[0];
    expect(stmt.type).toBe('ExpressionBlock');
    expect(stmt.codeSnippet).toContain('finally');
    expect(stmt.codeSnippet).toContain('cleanup()');
  });
});
