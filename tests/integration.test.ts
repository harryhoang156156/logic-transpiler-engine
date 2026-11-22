import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { runEnginePipeline } from '../src/main.js';
import { verifyTypeScriptCode } from '../src/verification/compiler_guard.js';
import { parseTypeScriptFile } from '../src/ingestion/parser.js';
import { ASTNode } from '../src/schemas.js';
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
      reject(new Error(`CLI subprocess timed out after ${timeoutMs}ms. Stdout: ${stdout}\nStderr: ${stderr}`));
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
    // Use a Node one-liner that hangs indefinitely (setInterval never returns)
    const hangCommand = 'node';
    const hangArgs = ['-e', 'setInterval(() => {}, 1000)'];
    const timeoutMs = 2000; // 2 seconds timeout for the test

    let proc: ReturnType<typeof spawn> | null = null;
    let pid: number | null = null;
    let killed = false;

    try {
      const resultPromise = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        proc = spawn(hangCommand, hangArgs, {
          cwd: process.cwd(),
          detached: true,
        });
        pid = proc.pid ?? null;
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', (d) => (stdout += d.toString()));
        proc.stderr.on('data', (d) => (stderr += d.toString()));

        const timeoutId = setTimeout(() => {
          killed = true;
          try {
            if (proc && proc.pid !== undefined) {
              process.kill(-proc.pid, 'SIGKILL');
            }
          } catch {
            if (proc) proc.kill('SIGKILL');
          }
          reject(new Error(`Subprocess timed out after ${timeoutMs}ms`));
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

      // We expect the promise to reject due to timeout
      await resultPromise;
    } catch (err) {
      // Expected timeout error
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('timed out');
    } finally {
      // Ensure cleanup: poll with signal-0 until process is gone
      if (pid !== null) {
        let exists = true;
        while (exists) {
          try {
            process.kill(pid, 0); // signal 0 checks existence
            // If no error, process still exists; wait a bit
            await new Promise((r) => setTimeout(r, 50));
          } catch {
            exists = false;
          }
        }
      }
      // If for some reason the process wasn't killed, force kill
      if (proc && !killed) {
        try {
          if (proc.pid !== undefined) {
            process.kill(-proc.pid, 'SIGKILL');
          }
        } catch {
          proc.kill('SIGKILL');
        }
      }
    }

    // If we reach here, the process has been terminated and cleaned up.
    // The test passes if no uncaught exception occurs.
  }, 10000);
});
