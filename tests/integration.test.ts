import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runEnginePipeline } from '../src/main.js';
import { verifyTypeScriptCode } from '../src/verification/compiler_guard.js';
import { parseTypeScriptFile } from '../src/ingestion/parser.js';
import { applyAtomicPatches, AtomicPatchOperation } from '../src/compiler/atomic_merger.js';
import { ASTNode, ModuleContainer, AsyncFunctionBlock } from '../src/schemas.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

let tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'transpiler-int-'));
  tempDirs.push(dir);
  return dir;
}

async function cleanup(): Promise<void> {
  for (const dir of tempDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {}
  }
  tempDirs = [];
}

beforeEach(async () => {
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

function createMockClient(responses: Array<{ content: string }>) {
  let callIndex = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const response = responses[Math.min(callIndex, responses.length - 1)];
          callIndex += 1;
          return {
            choices: [{ message: { content: response.content } }],
          };
        },
      },
    },
  };
}

function findNodeByName(node: ASTNode, name: string): string | null {
  if (node.type === 'AsyncFunctionBlock' && node.functionName === name) {
    return node.id;
  }
  const childKeys = [
    'children',
    'body',
    'tryBranch',
    'catchBranch',
    'trueBranch',
    'falseBranch',
    'callbackBody',
  ] as const;
  for (const key of childKeys) {
    const arr = (node as any)[key];
    if (Array.isArray(arr)) {
      for (const child of arr) {
        const found = findNodeByName(child, name);
        if (found) {
          return found;
        }
      }
    }
  }
  return null;
}

function runCli(
  args: string[],
  options: { command?: string; commandArgs?: string[]; timeoutMs?: number } = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const {
    command = 'npx',
    commandArgs = ['tsx', 'src/main.ts', ...args],
    timeoutMs = 10000,
  } = options;
  return new Promise((resolve, reject) => {
    const proc = spawn(command, commandArgs, {
      cwd: process.cwd(),
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));

    const timeoutId = setTimeout(() => {
      try {
        if (proc.pid !== undefined) {
          process.kill(-proc.pid, 'SIGKILL');
        }
      } catch {
        proc.kill('SIGKILL');
      }
      const error = new Error(`CLI subprocess timed out after ${timeoutMs}ms. Stdout: ${stdout}\nStderr: ${stderr}`);
      (error as any).pid = proc.pid;
      reject(error);
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timeoutId);
      resolve({ code, stdout, stderr });
    });

    proc.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}

describe('integration', () => {
  it('Test 1 — Greenfield Full-Stack Bot Generation', async () => {
    const dir = await makeTempDir();
    const outFile = path.join(dir, 'bot.ts');

    const greenfieldAst: ASTNode = {
      id: 'node_1',
      type: 'ModuleContainer',
      moduleName: 'generated_bot',
      exports: [],
      children: [
        {
          id: 'node_2',
          type: 'AsyncFunctionBlock',
          functionName: 'runBot',
          parameters: [],
          returnType: 'Promise<void>',
          isExported: true,
          body: [
            {
              id: 'node_3',
              type: 'Solana_EstablishConnection',
              connectionVarName: 'connection',
              rpcEnvVar: 'RPC_URL',
              commitment: 'confirmed',
            },
            {
              id: 'node_4',
              type: 'Solana_ParseWallet',
              keypairVarName: 'walletKeypair',
              privateKeyEnvVar: 'PRIVATE_KEY',
            },
            {
              id: 'node_5',
              type: 'ExpressionBlock',
              codeSnippet: 'const transaction = new Transaction()',
            },
            {
              id: 'node_6',
              type: 'Solana_SimulatePayload',
              connectionVarName: 'connection',
              transactionVarName: 'transaction',
              throwOnError: true,
            },
            {
              id: 'node_7',
              type: 'Sqlite_InitDatabase',
              dbVarName: 'db',
              dbFilePath: 'engine.db',
            },
            {
              id: 'node_8',
              type: 'Sqlite_ExecuteWrite',
              dbVarName: 'db',
              sqlQuery: 'INSERT INTO logs (message) VALUES (?)',
              paramsArrayExpression: "['test']",
            },
            {
              id: 'node_9',
              type: 'Sqlite_QueryRead',
              dbVarName: 'db',
              resultVarName: 'rows',
              readMode: 'all',
              sqlQuery: 'SELECT * FROM logs',
              paramsArrayExpression: '[]',
            },
            {
              id: 'node_10',
              type: 'Redis_InitClient',
              redisVarName: 'redis',
              redisUrlEnvVar: 'REDIS_URL',
            },
            {
              id: 'node_11',
              type: 'Redis_QueuePush',
              redisVarName: 'redis',
              queueKey: 'queue:jobs',
              payloadExpression: '{ job: "test" }',
            },
            {
              id: 'node_12',
              type: 'Redis_QueueBlockingPop',
              redisVarName: 'redis',
              queueKey: 'queue:jobs',
              resultVarName: 'job',
              timeoutSeconds: 5,
            },
            {
              id: 'node_13',
              type: 'File_AppendLog',
              filePath: 'logs.txt',
              messageExpression: "'bot tick'",
            },
            {
              id: 'node_14',
              type: 'Solana_ListenPumpFun',
              connectionVarName: 'connection',
              programAddress: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
              accountInfoParamName: 'accountInfo',
              callbackBody: [],
            },
          ],
        },
      ],
    };

    const clientOverride = createMockClient([
      { content: JSON.stringify({ ast: greenfieldAst }) },
    ]);

    const result = await runEnginePipeline({
      brief: 'Create a Solana trading bot',
      outputFilePath: outFile,
      clientOverride,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);

    const fileExists = await fs
      .access(outFile)
      .then(() => true)
      .catch(() => false);
    expect(fileExists).toBe(true);

    const writtenCode = await fs.readFile(outFile, 'utf-8');
    const verification = await verifyTypeScriptCode(writtenCode, process.cwd());
    expect(verification.success).toBe(true);
    expect(verification.errors).toEqual([]);
  });

  it('Test 2 — Blueprint Ingestion & Atomic Modification Loop', async () => {
    const dir = await makeTempDir();
    const blueprintPath = path.join(dir, 'blueprint.ts');
    const outFile = path.join(dir, 'output.ts');

    await fs.writeFile(
      blueprintPath,
      `export async function keepMe() {\n  console.log('keep');\n}\n\nexport async function mutateMe() {\n  console.log('mutate');\n}\n`
    );

    const rootAst = await parseTypeScriptFile(blueprintPath);
    const keepMeId = findNodeByName(rootAst, 'keepMe');
    const mutateMeId = findNodeByName(rootAst, 'mutateMe');
    const moduleId = rootAst.id;

    expect(keepMeId).not.toBeNull();
    expect(mutateMeId).not.toBeNull();

    const gapReport = {
      actions: [
        {
          targetNodeId: moduleId,
          resolution: 'KEEP_AS_IS' as const,
          reasoning: 'module unchanged',
        },
        {
          targetNodeId: keepMeId!,
          resolution: 'KEEP_AS_IS' as const,
          reasoning: 'unchanged',
        },
        {
          targetNodeId: mutateMeId!,
          resolution: 'MUTATE_EXISTING' as const,
          reasoning: 'needs update',
          specificationForMutation: 'add logging',
        },
        {
          targetNodeId: moduleId,
          resolution: 'SPAWN_NEW' as const,
          reasoning: 'new function',
          specificationForMutation: 'create cleanup',
        },
      ],
    };

    const mutatedAst: ASTNode = {
      id: mutateMeId!,
      type: 'AsyncFunctionBlock',
      functionName: 'mutateMe',
      parameters: [],
      returnType: 'Promise<void>',
      isExported: true,
      body: [
        {
          id: 'node_mutated_1',
          type: 'ExpressionBlock',
          codeSnippet: 'console.log("mutated")',
        },
      ],
    };

    const spawnedAst: ASTNode = {
      id: 'node_spawned_1',
      type: 'AsyncFunctionBlock',
      functionName: 'cleanup',
      parameters: [],
      returnType: 'Promise<void>',
      isExported: true,
      body: [
        {
          id: 'node_spawned_2',
          type: 'ExpressionBlock',
          codeSnippet: 'console.log("cleanup")',
        },
      ],
    };

    const clientOverride = createMockClient([
      { content: JSON.stringify(gapReport) },
      { content: JSON.stringify({ ast: mutatedAst }) },
      { content: JSON.stringify({ ast: spawnedAst }) },
    ]);

    const result = await runEnginePipeline({
      brief: 'Update blueprint',
      sourceFilePath: blueprintPath,
      outputFilePath: outFile,
      clientOverride,
    });

    expect(result.success).toBe(true);

    const outputCode = await fs.readFile(outFile, 'utf-8');
    expect(outputCode).toContain('async function keepMe()');
    expect(outputCode).toContain('async function mutateMe()');
    expect(outputCode).toContain('async function cleanup()');

    const verification = await verifyTypeScriptCode(outputCode, process.cwd());
    expect(verification.success).toBe(true);
    expect(verification.errors).toEqual([]);
  });

  it('Test 3 — Self-Healing Compiler Retry Loop & Failure Rollback', async () => {
    const dir = await makeTempDir();
    const outFile = path.join(dir, 'output.ts');

    const brokenAst: ASTNode = {
      id: 'node_1',
      type: 'ModuleContainer',
      moduleName: 'broken',
      exports: [],
      children: [
        {
          id: 'node_2',
          type: 'AsyncFunctionBlock',
          functionName: 'run',
          parameters: [],
          returnType: 'Promise<void>',
          isExported: true,
          body: [
            {
              id: 'node_3',
              type: 'ExpressionBlock',
              codeSnippet: 'undefinedVariable.foo()',
            },
          ],
        },
      ],
    };

    const fixedAst: ASTNode = {
      id: 'node_1',
      type: 'ModuleContainer',
      moduleName: 'fixed',
      exports: [],
      children: [
        {
          id: 'node_2',
          type: 'AsyncFunctionBlock',
          functionName: 'run',
          parameters: [],
          returnType: 'Promise<void>',
          isExported: true,
          body: [
            {
              id: 'node_3',
              type: 'ExpressionBlock',
              codeSnippet: 'console.log("fixed")',
            },
          ],
        },
      ],
    };

    // Part A: successful retry on attempt 2
    const clientOverrideSuccess = createMockClient([
      { content: JSON.stringify({ ast: brokenAst }) },
      { content: JSON.stringify({ ast: fixedAst }) },
    ]);

    const result = await runEnginePipeline({
      brief: 'Create bot',
      outputFilePath: outFile,
      maxRetries: 3,
      clientOverride: clientOverrideSuccess,
    });

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);

    const writtenCode = await fs.readFile(outFile, 'utf-8');
    const verification = await verifyTypeScriptCode(writtenCode, process.cwd());
    expect(verification.success).toBe(true);

    // Part B: all retries fail, no output written
    const failOutFile = path.join(dir, 'fail.ts');
    const clientOverrideFail = createMockClient([
      { content: JSON.stringify({ ast: brokenAst }) },
      { content: JSON.stringify({ ast: brokenAst }) },
    ]);

    let threw = false;
    try {
      await runEnginePipeline({
        brief: 'Create bot',
        outputFilePath: failOutFile,
        maxRetries: 2,
        clientOverride: clientOverrideFail,
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const failFileExists = await fs
      .access(failOutFile)
      .then(() => true)
      .catch(() => false);
    expect(failFileExists).toBe(false);
  }, 15000);

  it('Test 4 — CLI Subprocess Smoke Test', async () => {
    // --help exits 0 and lists flags
    const helpResult = await runCli(['--help']);
    expect(helpResult.code).toBe(0);
    expect(helpResult.stdout).toContain('--out');
    expect(helpResult.stdout).toContain('--spec');
    expect(helpResult.stdout).toContain('--overview');
    expect(helpResult.stdout).toContain('--brief');
    expect(helpResult.stdout).toContain('--src');

    // Missing --out exits non-zero
    const missingOutResult = await runCli([]);
    expect(missingOutResult.code).not.toBe(0);
  }, 25000);

  it('Test 5 — Process Group Termination and Cleanup Verification', async () => {
    const dir = await makeTempDir();
    const scriptPath = path.join(dir, 'hang.js');
    const childPidPath = path.join(dir, 'child.pid');

    // Write a script that spawns a child process (in the same process group) and writes its PID to a file.
    const scriptContent = `
      const { spawn } = require('child_process');
      const fs = require('fs');
      const path = require('path');
      const child = spawn('node', ['-e', 'setInterval(() => {}, 1000)'], { detached: false });
      fs.writeFileSync(path.join(__dirname, 'child.pid'), child.pid.toString());
      setInterval(() => {}, 1000);
    `;
    await fs.writeFile(scriptPath, scriptContent);

    // Use runCli with a short timeout to trigger the kill logic.
    const timeoutMs = 2000;
    let mainPid: number | null = null;
    let childPid: number | null = null;

    try {
      await runCli([], {
        command: 'node',
        commandArgs: [scriptPath],
        timeoutMs,
      });
      // If we get here, the process exited before the timeout, which is a test failure.
      throw new Error('Subprocess exited before the timeout; expected timeout rejection');
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('timed out');
      // Extract the main PID from the error (attached by runCli)
      mainPid = (err as any).pid ?? null;
      expect(mainPid).not.toBeNull();
    }

    // Read the child PID from the file written by the script.
    try {
      const childPidStr = await fs.readFile(childPidPath, 'utf-8');
      childPid = parseInt(childPidStr.trim(), 10);
      expect(childPid).not.toBeNaN();
    } catch {
      throw new Error('Failed to read child PID file');
    }

    // Verify both the main process and the child process are gone.
    // Poll with signal 0 until both return ESRCH (process does not exist).
    const deadline = Date.now() + 5000; // 5 seconds max wait
    let mainGone = false;
    let childGone = false;

    while (Date.now() < deadline) {
      if (!mainGone && mainPid !== null) {
        try {
          process.kill(mainPid, 0);
        } catch (e: any) {
          if (e.code === 'ESRCH') {
            mainGone = true;
          } else {
            throw new Error(`Unexpected error probing main PID ${mainPid}: ${e.message}`);
          }
        }
      }
      if (!childGone && childPid !== null) {
        try {
          process.kill(childPid, 0);
        } catch (e: any) {
          if (e.code === 'ESRCH') {
            childGone = true;
          } else {
            throw new Error(`Unexpected error probing child PID ${childPid}: ${e.message}`);
          }
        }
      }
      if (mainGone && childGone) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(mainGone).toBe(true);
    expect(childGone).toBe(true);
  }, 10000);

  // --- New regression tests for the 4 cross-module fixes ---

  describe('atomic_merger overlapping replacement detection', () => {
    it('rejects ancestor/descendant REPLACE conflicts', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [
              {
                id: 'expr1',
                type: 'ExpressionBlock',
                codeSnippet: 'console.log("inner")',
              },
            ],
          },
        ],
      };

      const replacementFunc: AsyncFunctionBlock = {
        id: 'new_func1',
        type: 'AsyncFunctionBlock',
        functionName: 'func1',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [],
      };

      const replacementExpr: ASTNode = {
        id: 'new_expr1',
        type: 'ExpressionBlock',
        codeSnippet: 'console.log("replaced")',
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'REPLACE', targetNodeId: 'func1', newNode: replacementFunc },
        { action: 'REPLACE', targetNodeId: 'expr1', newNode: replacementExpr },
      ];

      expect(() => applyAtomicPatches(rootAst, operations)).toThrow(
        /Overlapping REPLACE targets detected/
      );
    });

    it('allows non-overlapping REPLACE operations', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [],
          },
          {
            id: 'func2',
            type: 'AsyncFunctionBlock',
            functionName: 'func2',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [],
          },
        ],
      };

      const replacementFunc1: AsyncFunctionBlock = {
        id: 'new_func1',
        type: 'AsyncFunctionBlock',
        functionName: 'func1',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [
          {
            id: 'expr1',
            type: 'ExpressionBlock',
            codeSnippet: 'console.log("func1")',
          },
        ],
      };

      const replacementFunc2: AsyncFunctionBlock = {
        id: 'new_func2',
        type: 'AsyncFunctionBlock',
        functionName: 'func2',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [
          {
            id: 'expr2',
            type: 'ExpressionBlock',
            codeSnippet: 'console.log("func2")',
          },
        ],
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'REPLACE', targetNodeId: 'func1', newNode: replacementFunc1 },
        { action: 'REPLACE', targetNodeId: 'func2', newNode: replacementFunc2 },
      ];

      const result = applyAtomicPatches(rootAst, operations);
      expect(result.children).toHaveLength(2);
    });

    it('allows duplicate REPLACE target IDs to reach duplicate check', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [],
          },
        ],
      };

      const replacementFunc1: AsyncFunctionBlock = {
        id: 'new_func1',
        type: 'AsyncFunctionBlock',
        functionName: 'func1',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [],
      };

      const replacementFunc2: AsyncFunctionBlock = {
        id: 'new_func2',
        type: 'AsyncFunctionBlock',
        functionName: 'func1',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [],
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'REPLACE', targetNodeId: 'func1', newNode: replacementFunc1 },
        { action: 'REPLACE', targetNodeId: 'func1', newNode: replacementFunc2 },
      ];

      expect(() => applyAtomicPatches(rootAst, operations)).toThrow(
        /Duplicate replacement target node id "func1" found/
      );
    });
  });

  describe('atomic_merger unique ID validation', () => {
    it('throws on duplicate node IDs after merge', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [],
          },
          {
            id: 'func2',
            type: 'AsyncFunctionBlock',
            functionName: 'func2',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [],
          },
        ],
      };

      // Replacement node has same ID as another existing node in the tree (func2)
      const replacementFunc: AsyncFunctionBlock = {
        id: 'func2', // Duplicate ID with existing func2!
        type: 'AsyncFunctionBlock',
        functionName: 'func1',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [],
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'REPLACE', targetNodeId: 'func1', newNode: replacementFunc },
      ];

      expect(() => applyAtomicPatches(rootAst, operations)).toThrow(
        /Duplicate node ID detected in merged AST: "func2"/
      );
    });

    it('throws on duplicate IDs within replacement subtree', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [],
          },
        ],
      };

      // Replacement subtree has duplicate IDs internally
      const replacementFunc: AsyncFunctionBlock = {
        id: 'new_func1',
        type: 'AsyncFunctionBlock',
        functionName: 'func1',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [
          {
            id: 'dup',
            type: 'ExpressionBlock',
            codeSnippet: 'console.log(1)',
          },
          {
            id: 'dup', // Duplicate!
            type: 'ExpressionBlock',
            codeSnippet: 'console.log(2)',
          },
        ],
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'REPLACE', targetNodeId: 'func1', newNode: replacementFunc },
      ];

      expect(() => applyAtomicPatches(rootAst, operations)).toThrow(
        /Duplicate node ID detected in merged AST: "dup"/
      );
    });
  });

  describe('main.ts node ID remapping', () => {
    it('remaps node IDs in greenfield generation to avoid collisions', async () => {
      const dir = await makeTempDir();
      const outFile = path.join(dir, 'bot.ts');

      // AST with duplicate IDs (simulating LLM output) - using Solana nodes as specified
      const greenfieldAst: ASTNode = {
        id: 'node_1',
        type: 'ModuleContainer',
        moduleName: 'generated_bot',
        exports: [],
        children: [
          {
            id: 'node_1', // Duplicate with root!
            type: 'AsyncFunctionBlock',
            functionName: 'runBot',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [
              {
                id: 'node_1', // Duplicate again!
                type: 'Solana_EstablishConnection',
                connectionVarName: 'connection',
                rpcEnvVar: 'RPC_URL',
                commitment: 'confirmed',
              },
              {
                id: 'node_1', // Duplicate again!
                type: 'ExpressionBlock',
                codeSnippet: 'const transaction = new Transaction()',
              },
              {
                id: 'node_1', // Duplicate again!
                type: 'Solana_SimulatePayload',
                connectionVarName: 'connection',
                transactionVarName: 'transaction',
                throwOnError: true,
              },
              {
                id: 'node_1', // Duplicate again!
                type: 'Solana_SimulatePayload',
                connectionVarName: 'connection',
                transactionVarName: 'transaction',
                throwOnError: false,
              },
            ],
          },
        ],
      };

      const clientOverride = createMockClient([
        { content: JSON.stringify({ ast: greenfieldAst }) },
      ]);

      const result = await runEnginePipeline({
        brief: 'Create a Solana trading bot',
        outputFilePath: outFile,
        clientOverride,
      });

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(1);

      const writtenCode = await fs.readFile(outFile, 'utf-8');
      const verification = await verifyTypeScriptCode(writtenCode, process.cwd());
      expect(verification.success).toBe(true);
      expect(verification.errors).toEqual([]);
    });

    it('remaps node IDs in mutation/spawn operations', async () => {
      const dir = await makeTempDir();
      const blueprintPath = path.join(dir, 'blueprint.ts');
      const outFile = path.join(dir, 'output.ts');

      await fs.writeFile(
        blueprintPath,
        `export async function existing() {\n  console.log('existing');\n}\n`
      );

      const rootAst = await parseTypeScriptFile(blueprintPath);
      const existingId = findNodeByName(rootAst, 'existing');
      const moduleId = rootAst.id;

      const gapReport = {
        actions: [
          {
            targetNodeId: moduleId,
            resolution: 'KEEP_AS_IS' as const,
            reasoning: 'module unchanged',
          },
          {
            targetNodeId: existingId!,
            resolution: 'MUTATE_EXISTING' as const,
            reasoning: 'update',
            specificationForMutation: 'add logging',
          },
          {
            targetNodeId: moduleId,
            resolution: 'SPAWN_NEW' as const,
            reasoning: 'new function',
            specificationForMutation: 'create new',
          },
        ],
      };

      // Mutated and spawned nodes with conflicting IDs
      const mutatedAst: ASTNode = {
        id: existingId!, // Same as target - will be remapped
        type: 'AsyncFunctionBlock',
        functionName: 'existing',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [
          {
            id: 'node_1', // Will conflict with root's counter
            type: 'ExpressionBlock',
            codeSnippet: 'console.log("mutated")',
          },
        ],
      };

      const spawnedAst: ASTNode = {
        id: 'node_1', // Will conflict
        type: 'AsyncFunctionBlock',
        functionName: 'newFunc',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [
          {
            id: 'node_1', // Will conflict
            type: 'ExpressionBlock',
            codeSnippet: 'console.log("spawned")',
          },
        ],
      };

      const clientOverride = createMockClient([
        { content: JSON.stringify(gapReport) },
        { content: JSON.stringify({ ast: mutatedAst }) },
        { content: JSON.stringify({ ast: spawnedAst }) },
      ]);

      const result = await runEnginePipeline({
        brief: 'Update blueprint',
        sourceFilePath: blueprintPath,
        outputFilePath: outFile,
        clientOverride,
      });

      expect(result.success).toBe(true);

      const outputCode = await fs.readFile(outFile, 'utf-8');
      expect(outputCode).toContain('async function existing()');
      expect(outputCode).toContain('async function newFunc()');

      const verification = await verifyTypeScriptCode(outputCode, process.cwd());
      expect(verification.success).toBe(true);
    });
  });

  describe('main.ts root ModuleContainer validation', () => {
    it('auto-wraps a non-ModuleContainer root from greenfield generation', async () => {
      const dir = await makeTempDir();
      const outFile = path.join(dir, 'bot.ts');

      // LLM returns an AsyncFunctionBlock as root (invalid) — should be auto-wrapped
      const bareRootAst: ASTNode = {
        id: 'node_1',
        type: 'AsyncFunctionBlock',
        functionName: 'runBot',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [
          {
            id: 'node_2',
            type: 'ExpressionBlock',
            codeSnippet: 'console.log("wrapped")',
          },
        ],
      };

      const clientOverride = createMockClient([
        { content: JSON.stringify({ ast: bareRootAst }) },
      ]);

      const result = await runEnginePipeline({
        brief: 'Create bot',
        outputFilePath: outFile,
        clientOverride,
      });

      expect(result.success).toBe(true);

      const writtenCode = await fs.readFile(outFile, 'utf-8');
      expect(writtenCode).toContain('async function runBot');
      expect(writtenCode).toContain('console.log("wrapped")');

      const verification = await verifyTypeScriptCode(writtenCode, process.cwd());
      expect(verification.success).toBe(true);
    });

    it('rejects non-ModuleContainer root from correction loop', async () => {
      const dir = await makeTempDir();
      const outFile = path.join(dir, 'bot.ts');

      // First attempt returns valid ModuleContainer but with error
      const brokenAst: ASTNode = {
        id: 'node_1',
        type: 'ModuleContainer',
        moduleName: 'broken',
        exports: [],
        children: [
          {
            id: 'node_2',
            type: 'AsyncFunctionBlock',
            functionName: 'run',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [
              {
                id: 'node_3',
                type: 'ExpressionBlock',
                codeSnippet: 'undefinedVariable.foo()',
              },
            ],
          },
        ],
      };

      // Correction returns invalid root type
      const invalidCorrection: ASTNode = {
        id: 'node_1',
        type: 'AsyncFunctionBlock',
        functionName: 'run',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [],
      };

      const clientOverride = createMockClient([
        { content: JSON.stringify({ ast: brokenAst }) },
        { content: JSON.stringify({ ast: invalidCorrection }) },
      ]);

      let threw = false;
      try {
        await runEnginePipeline({
          brief: 'Create bot',
          outputFilePath: outFile,
          maxRetries: 2,
          clientOverride,
        });
      } catch (err) {
        threw = true;
        expect((err as Error).message).toContain('Root AST node must be a ModuleContainer');
      }
      expect(threw).toBe(true);
    });
  });

  describe('main.ts replacement contract validation', () => {
    it('rejects type mismatch in MUTATE_EXISTING replacement', async () => {
      const dir = await makeTempDir();
      const blueprintPath = path.join(dir, 'blueprint.ts');
      const outFile = path.join(dir, 'output.ts');

      await fs.writeFile(
        blueprintPath,
        `export async function myFunc() {\n  console.log('original');\n}\n`
      );

      const rootAst = await parseTypeScriptFile(blueprintPath);
      const funcId = findNodeByName(rootAst, 'myFunc');
      const moduleId = rootAst.id;

      const gapReport = {
        actions: [
          {
            targetNodeId: moduleId,
            resolution: 'KEEP_AS_IS' as const,
            reasoning: 'module unchanged',
          },
          {
            targetNodeId: funcId!,
            resolution: 'MUTATE_EXISTING' as const,
            reasoning: 'replace with different type',
            specificationForMutation: 'replace function with expression',
          },
        ],
      };

      // Replacement is an ExpressionBlock instead of AsyncFunctionBlock
      const invalidReplacement: ASTNode = {
        id: 'new_node',
        type: 'ExpressionBlock',
        codeSnippet: 'console.log("not a function")',
      };

      const clientOverride = createMockClient([
        { content: JSON.stringify(gapReport) },
        { content: JSON.stringify({ ast: invalidReplacement }) },
      ]);

      let threw = false;
      try {
        await runEnginePipeline({
          brief: 'Update blueprint',
          sourceFilePath: blueprintPath,
          outputFilePath: outFile,
          clientOverride,
        });
      } catch (err) {
        threw = true;
        expect((err as Error).message).toContain('Replacement node type "ExpressionBlock" does not match target node type "AsyncFunctionBlock"');
      }
      expect(threw).toBe(true);
    });

    it('rejects function name mismatch in MUTATE_EXISTING replacement', async () => {
      const dir = await makeTempDir();
      const blueprintPath = path.join(dir, 'blueprint.ts');
      const outFile = path.join(dir, 'output.ts');

      await fs.writeFile(
        blueprintPath,
        `export async function originalName() {\n  console.log('original');\n}\n`
      );

      const rootAst = await parseTypeScriptFile(blueprintPath);
      const funcId = findNodeByName(rootAst, 'originalName');
      const moduleId = rootAst.id;

      const gapReport = {
        actions: [
          {
            targetNodeId: moduleId,
            resolution: 'KEEP_AS_IS' as const,
            reasoning: 'module unchanged',
          },
          {
            targetNodeId: funcId!,
            resolution: 'MUTATE_EXISTING' as const,
            reasoning: 'rename function',
            specificationForMutation: 'rename to newName',
          },
        ],
      };

      // Replacement has different function name
      const invalidReplacement: ASTNode = {
        id: 'new_node',
        type: 'AsyncFunctionBlock',
        functionName: 'newName', // Different name!
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [],
      };

      const clientOverride = createMockClient([
        { content: JSON.stringify(gapReport) },
        { content: JSON.stringify({ ast: invalidReplacement }) },
      ]);

      let threw = false;
      try {
        await runEnginePipeline({
          brief: 'Update blueprint',
          sourceFilePath: blueprintPath,
          outputFilePath: outFile,
          clientOverride,
        });
      } catch (err) {
        threw = true;
        expect((err as Error).message).toContain('Function name mismatch');
      }
      expect(threw).toBe(true);
    });

    it('allows compatible AsyncFunctionBlock replacement', async () => {
      const dir = await makeTempDir();
      const blueprintPath = path.join(dir, 'blueprint.ts');
      const outFile = path.join(dir, 'output.ts');

      await fs.writeFile(
        blueprintPath,
        `export async function myFunc() {\n  console.log('original');\n}\n`
      );

      const rootAst = await parseTypeScriptFile(blueprintPath);
      const funcId = findNodeByName(rootAst, 'myFunc');
      const moduleId = rootAst.id;

      const gapReport = {
        actions: [
          {
            targetNodeId: moduleId,
            resolution: 'KEEP_AS_IS' as const,
            reasoning: 'module unchanged',
          },
          {
            targetNodeId: funcId!,
            resolution: 'MUTATE_EXISTING' as const,
            reasoning: 'update body',
            specificationForMutation: 'new body',
          },
        ],
      };

      // Valid replacement with same function name
      const validReplacement: ASTNode = {
        id: 'new_node',
        type: 'AsyncFunctionBlock',
        functionName: 'myFunc', // Same name
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [
          {
            id: 'expr1',
            type: 'ExpressionBlock',
            codeSnippet: 'console.log("updated")',
          },
        ],
      };

      const clientOverride = createMockClient([
        { content: JSON.stringify(gapReport) },
        { content: JSON.stringify({ ast: validReplacement }) },
      ]);

      const result = await runEnginePipeline({
        brief: 'Update blueprint',
        sourceFilePath: blueprintPath,
        outputFilePath: outFile,
        clientOverride,
      });

      expect(result.success).toBe(true);

      const outputCode = await fs.readFile(outFile, 'utf-8');
      expect(outputCode).toContain('async function myFunc()');
      expect(outputCode).toContain('console.log("updated")');

      const verification = await verifyTypeScriptCode(outputCode, process.cwd());
      expect(verification.success).toBe(true);
    });
  });

  // --- New focused tests for APPEND_TO_MODULE ---

  describe('atomic_merger APPEND_TO_MODULE', () => {
    it('appends to AsyncFunctionBlock body', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [
              {
                id: 'expr1',
                type: 'ExpressionBlock',
                codeSnippet: 'console.log("existing")',
              },
            ],
          },
        ],
      };

      const newExpr: ASTNode = {
        id: 'new_expr',
        type: 'ExpressionBlock',
        codeSnippet: 'console.log("appended")',
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'APPEND_TO_MODULE', targetNodeId: 'func1', newNode: newExpr },
      ];

      const result = applyAtomicPatches(rootAst, operations);
      const func = result.children[0] as AsyncFunctionBlock;
      expect(func.body).toHaveLength(2);
      expect((func.body[1] as any).codeSnippet).toBe('console.log("appended")');
    });

    it('throws on missing target ID for APPEND_TO_MODULE', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [],
      };

      const newExpr: ASTNode = {
        id: 'new_expr',
        type: 'ExpressionBlock',
        codeSnippet: 'console.log("appended")',
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'APPEND_TO_MODULE', targetNodeId: 'nonexistent', newNode: newExpr },
      ];

      expect(() => applyAtomicPatches(rootAst, operations)).toThrow(
        /Target node id "nonexistent" not found for APPEND_TO_MODULE/
      );
    });

    it('throws when appending to leaf ExpressionBlock', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [
              {
                id: 'expr1',
                type: 'ExpressionBlock',
                codeSnippet: 'console.log("leaf")',
              },
            ],
          },
        ],
      };

      const newExpr: ASTNode = {
        id: 'new_expr',
        type: 'ExpressionBlock',
        codeSnippet: 'console.log("appended")',
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'APPEND_TO_MODULE', targetNodeId: 'expr1', newNode: newExpr },
      ];

      expect(() => applyAtomicPatches(rootAst, operations)).toThrow(
        /does not have a valid child array to append to/
      );
    });

    it('throws when target removed by another REPLACE', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [],
          },
          {
            id: 'func2',
            type: 'AsyncFunctionBlock',
            functionName: 'func2',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [],
          },
        ],
      };

      const replacementFunc: AsyncFunctionBlock = {
        id: 'new_func1',
        type: 'AsyncFunctionBlock',
        functionName: 'func1',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [],
      };

      const newExpr: ASTNode = {
        id: 'new_expr',
        type: 'ExpressionBlock',
        codeSnippet: 'console.log("appended")',
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'REPLACE', targetNodeId: 'func1', newNode: replacementFunc },
        { action: 'APPEND_TO_MODULE', targetNodeId: 'func1', newNode: newExpr },
      ];

      // REPLACE happens first (deeper path), then APPEND tries to find func1 which was replaced
      // The new func1 has a different ID, so the target is not found
      expect(() => applyAtomicPatches(rootAst, operations)).toThrow(
        /Target node id "func1" not found for APPEND_TO_MODULE/
      );
    });

    it('appends to TryCatchGuardian tryBranch by default', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [
              {
                id: 'try1',
                type: 'TryCatchGuardian',
                tryBranch: [
                  {
                    id: 'expr1',
                    type: 'ExpressionBlock',
                    codeSnippet: 'console.log("try")',
                  },
                ],
                catchBranch: [
                  {
                    id: 'expr2',
                    type: 'ExpressionBlock',
                    codeSnippet: 'console.log("catch")',
                  },
                ],
                errorVariableName: 'e',
              },
            ],
          },
        ],
      };

      const newExpr: ASTNode = {
        id: 'new_expr',
        type: 'ExpressionBlock',
        codeSnippet: 'console.log("appended to try")',
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'APPEND_TO_MODULE', targetNodeId: 'try1', newNode: newExpr },
      ];

      const result = applyAtomicPatches(rootAst, operations);
      const func = result.children[0] as AsyncFunctionBlock;
      const tryCatch = func.body[0] as any;
      expect(tryCatch.tryBranch).toHaveLength(2);
      expect(tryCatch.tryBranch[1].codeSnippet).toBe('console.log("appended to try")');
    });

    it('appends to TryCatchGuardian catchBranch when targetKey specified', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [
              {
                id: 'try1',
                type: 'TryCatchGuardian',
                tryBranch: [
                  {
                    id: 'expr1',
                    type: 'ExpressionBlock',
                    codeSnippet: 'console.log("try")',
                  },
                ],
                catchBranch: [
                  {
                    id: 'expr2',
                    type: 'ExpressionBlock',
                    codeSnippet: 'console.log("catch")',
                  },
                ],
                errorVariableName: 'e',
              },
            ],
          },
        ],
      };

      const newExpr: ASTNode = {
        id: 'new_expr',
        type: 'ExpressionBlock',
        codeSnippet: 'console.log("appended to catch")',
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'APPEND_TO_MODULE', targetNodeId: 'try1', targetKey: 'catchBranch', newNode: newExpr },
      ];

      const result = applyAtomicPatches(rootAst, operations);
      const func = result.children[0] as AsyncFunctionBlock;
      const tryCatch = func.body[0] as any;
      expect(tryCatch.catchBranch).toHaveLength(2);
      expect(tryCatch.catchBranch[1].codeSnippet).toBe('console.log("appended to catch")');
    });

    it('appends to ModuleContainer children when no targetNodeId', () => {
      const rootAst: ModuleContainer = {
        id: 'root',
        type: 'ModuleContainer',
        moduleName: 'test',
        exports: [],
        children: [
          {
            id: 'func1',
            type: 'AsyncFunctionBlock',
            functionName: 'func1',
            parameters: [],
            returnType: 'Promise<void>',
            isExported: true,
            body: [],
          },
        ],
      };

      const newFunc: AsyncFunctionBlock = {
        id: 'new_func',
        type: 'AsyncFunctionBlock',
        functionName: 'func2',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [],
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'APPEND_TO_MODULE', newNode: newFunc },
      ];

      const result = applyAtomicPatches(rootAst, operations);
      expect(result.children).toHaveLength(2);
      expect((result.children[1] as AsyncFunctionBlock).functionName).toBe('func2');
    });

    it('throws when appending to non-ModuleContainer root without targetNodeId', () => {
      const rootAst: ASTNode = {
        id: 'root',
        type: 'AsyncFunctionBlock',
        functionName: 'func1',
        parameters: [],
        returnType: 'Promise<void>',
        isExported: true,
        body: [],
      };

      const newExpr: ASTNode = {
        id: 'new_expr',
        type: 'ExpressionBlock',
        codeSnippet: 'console.log("appended")',
      };

      const operations: AtomicPatchOperation[] = [
        { action: 'APPEND_TO_MODULE', newNode: newExpr },
      ];

      expect(() => applyAtomicPatches(rootAst, operations)).toThrow(
        /Cannot append to module: root AST node type is "AsyncFunctionBlock", expected "ModuleContainer"/
      );
    });
  });
});
