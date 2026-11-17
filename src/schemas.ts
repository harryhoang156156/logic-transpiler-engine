import { z } from 'zod';
import ts from 'typescript';

// ---------------------------------------------------------------------------
// Base Node Properties
// ---------------------------------------------------------------------------

export interface BaseNode {
  id: string;
  intentTag?: string;
}

// ---------------------------------------------------------------------------
// AST Node Type Definitions (recursive)
// ---------------------------------------------------------------------------

export interface ModuleContainer extends BaseNode {
  type: 'ModuleContainer';
  moduleName: string;
  exports: string[];
  children: ASTNode[];
}

export interface AsyncFunctionBlock extends BaseNode {
  type: 'AsyncFunctionBlock';
  functionName: string;
  parameters: { name: string; tsType: string }[];
  returnType: string;
  isExported: boolean;
  body: ASTNode[];
}

export interface TryCatchGuardian extends BaseNode {
  type: 'TryCatchGuardian';
  tryBranch: ASTNode[];
  catchBranch: ASTNode[];
  errorVariableName: string;
}

export interface ConditionalBranch extends BaseNode {
  type: 'ConditionalBranch';
  conditionExpression: string;
  trueBranch: ASTNode[];
  falseBranch?: ASTNode[];
}

export interface LoopInterval extends BaseNode {
  type: 'LoopInterval';
  loopType: 'while' | 'forOf' | 'setInterval';
  loopHeader: string;
  body: ASTNode[];
}

export type ExpressionBlock = z.infer<typeof ExpressionBlockSchema>;

export interface SolanaEstablishConnection extends BaseNode {
  type: 'Solana_EstablishConnection';
  connectionVarName: string;
  rpcEnvVar: string;
  commitment: 'processed' | 'confirmed' | 'finalized';
}

export interface SolanaParseWallet extends BaseNode {
  type: 'Solana_ParseWallet';
  keypairVarName: string;
  privateKeyEnvVar: string;
}

export interface SolanaListenPumpFun extends BaseNode {
  type: 'Solana_ListenPumpFun';
  connectionVarName: string;
  programAddress: string;
  accountInfoParamName: string;
  callbackBody: ASTNode[];
}

export interface SolanaSimulatePayload extends BaseNode {
  type: 'Solana_SimulatePayload';
  connectionVarName: string;
  transactionVarName: string;
  throwOnError: boolean;
}

export interface FileAppendLog extends BaseNode {
  type: 'File_AppendLog';
  filePath: string;
  messageExpression: string;
}

export interface SqliteInitDatabase extends BaseNode {
  type: 'Sqlite_InitDatabase';
  dbVarName: string;
  dbFilePath: string;
}

export interface SqliteExecuteWrite extends BaseNode {
  type: 'Sqlite_ExecuteWrite';
  dbVarName: string;
  sqlQuery: string;
  paramsArrayExpression: string;
}

export interface SqliteQueryRead extends BaseNode {
  type: 'Sqlite_QueryRead';
  dbVarName: string;
  resultVarName: string;
  readMode: 'all' | 'get';
  sqlQuery: string;
  paramsArrayExpression: string;
}

export interface RedisInitClient extends BaseNode {
  type: 'Redis_InitClient';
  redisVarName: string;
  redisUrlEnvVar: string;
}

export interface RedisQueuePush extends BaseNode {
  type: 'Redis_QueuePush';
  redisVarName: string;
  queueKey: string;
  payloadExpression: string;
}

export interface RedisQueueBlockingPop extends BaseNode {
  type: 'Redis_QueueBlockingPop';
  redisVarName: string;
  queueKey: string;
  resultVarName: string;
  timeoutSeconds: number;
}

export type ASTNode =
  | ModuleContainer
  | AsyncFunctionBlock
  | TryCatchGuardian
  | ConditionalBranch
  | LoopInterval
  | ExpressionBlock
  | SolanaEstablishConnection
  | SolanaParseWallet
  | SolanaListenPumpFun
  | SolanaSimulatePayload
  | FileAppendLog
  | SqliteInitDatabase
  | SqliteExecuteWrite
  | SqliteQueryRead
  | RedisInitClient
  | RedisQueuePush
  | RedisQueueBlockingPop;

// ---------------------------------------------------------------------------
// Base Node Properties (Zod)
// ---------------------------------------------------------------------------

const BaseNodeProps = {
  id: z.string(),
  intentTag: z.string().optional(),
};

// ---------------------------------------------------------------------------
// Core Structural Containers
// ---------------------------------------------------------------------------

export const ModuleContainerSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('ModuleContainer'),
  moduleName: z.string(),
  exports: z.array(z.string()).default([]),
  children: z.lazy(() => z.array(ASTNodeSchema)),
});

export const AsyncFunctionBlockSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('AsyncFunctionBlock'),
  functionName: z.string(),
  parameters: z.array(z.object({ name: z.string(), tsType: z.string() })),
  returnType: z.string().default('Promise<void>'),
  isExported: z.boolean().default(true),
  body: z.lazy(() => z.array(ASTNodeSchema)),
});

export const TryCatchGuardianSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('TryCatchGuardian'),
  tryBranch: z.lazy(() => z.array(ASTNodeSchema)),
  catchBranch: z.lazy(() => z.array(ASTNodeSchema)),
  errorVariableName: z.string().default('error'),
});

export const ConditionalBranchSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('ConditionalBranch'),
  conditionExpression: z.string(),
  trueBranch: z.lazy(() => z.array(ASTNodeSchema)),
  falseBranch: z.lazy(() => z.array(ASTNodeSchema)).optional(),
});

export const LoopIntervalSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('LoopInterval'),
  loopType: z.enum(['while', 'forOf', 'setInterval']),
  loopHeader: z.string(),
  body: z.lazy(() => z.array(ASTNodeSchema)),
});

// ---------------------------------------------------------------------------
// Loose Token Node
// ---------------------------------------------------------------------------

export const ExpressionBlockSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('ExpressionBlock'),
  codeSnippet: z.string().refine((snippet) => {
    // Parse without executing; TypeScript handles braces in literals and comments.
    const { diagnostics } = ts.transpileModule(snippet, {
      fileName: 'snippet.ts',
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      reportDiagnostics: true,
    });
    return !diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  }, 'codeSnippet must contain valid TypeScript syntax with balanced braces'),
});

// ---------------------------------------------------------------------------
// Solana, SQLite, Redis & Node.js "Black Box" Library Nodes
// ---------------------------------------------------------------------------

export const SolanaEstablishConnectionSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Solana_EstablishConnection'),
  connectionVarName: z.string().default('connection'),
  rpcEnvVar: z.string().default('RPC_URL'),
  commitment: z.enum(['processed', 'confirmed', 'finalized']).default('confirmed'),
});

export const SolanaParseWalletSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Solana_ParseWallet'),
  keypairVarName: z.string().default('walletKeypair'),
  privateKeyEnvVar: z.string().default('PRIVATE_KEY'),
});

export const SolanaListenPumpFunSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Solana_ListenPumpFun'),
  connectionVarName: z.string().default('connection'),
  programAddress: z.string().default('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'),
  accountInfoParamName: z.string().default('accountInfo'),
  callbackBody: z.lazy(() => z.array(ASTNodeSchema)),
});

export const SolanaSimulatePayloadSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Solana_SimulatePayload'),
  connectionVarName: z.string().default('connection'),
  transactionVarName: z.string().default('transaction'),
  throwOnError: z.boolean().default(true),
});

export const FileAppendLogSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('File_AppendLog'),
  filePath: z.string().default('logs.txt'),
  messageExpression: z.string(),
});

export const SqliteInitDatabaseSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Sqlite_InitDatabase'),
  dbVarName: z.string().default('db'),
  dbFilePath: z.string().default('engine.db'),
});

export const SqliteExecuteWriteSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Sqlite_ExecuteWrite'),
  dbVarName: z.string().default('db'),
  sqlQuery: z.string(),
  paramsArrayExpression: z.string(),
});

export const SqliteQueryReadSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Sqlite_QueryRead'),
  dbVarName: z.string().default('db'),
  resultVarName: z.string(),
  readMode: z.enum(['all', 'get']),
  sqlQuery: z.string(),
  paramsArrayExpression: z.string().default('[]'),
});

export const RedisInitClientSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Redis_InitClient'),
  redisVarName: z.string().default('redis'),
  redisUrlEnvVar: z.string().default('REDIS_URL'),
});

export const RedisQueuePushSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Redis_QueuePush'),
  redisVarName: z.string().default('redis'),
  queueKey: z.string(),
  payloadExpression: z.string(),
});

export const RedisQueueBlockingPopSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Redis_QueueBlockingPop'),
  redisVarName: z.string().default('redis'),
  queueKey: z.string(),
  resultVarName: z.string(),
  timeoutSeconds: z.number().default(0),
});

// ---------------------------------------------------------------------------
// Master Discriminated Union
// ---------------------------------------------------------------------------

export const ASTNodeSchema: z.ZodType<ASTNode> = z.lazy(() =>
  z.discriminatedUnion('type', [
    ModuleContainerSchema,
    AsyncFunctionBlockSchema,
    TryCatchGuardianSchema,
    ConditionalBranchSchema,
    LoopIntervalSchema,
    ExpressionBlockSchema,
    SolanaEstablishConnectionSchema,
    SolanaParseWalletSchema,
    SolanaListenPumpFunSchema,
    SolanaSimulatePayloadSchema,
    FileAppendLogSchema,
    SqliteInitDatabaseSchema,
    SqliteExecuteWriteSchema,
    SqliteQueryReadSchema,
    RedisInitClientSchema,
    RedisQueuePushSchema,
    RedisQueueBlockingPopSchema,
  ])
) as z.ZodType<ASTNode>;

// ---------------------------------------------------------------------------
// Gap Analysis Schemas
// ---------------------------------------------------------------------------

export const GapResolutionItemSchema = z.object({
  targetNodeId: z.string(),
  resolution: z.enum(['KEEP_AS_IS', 'MUTATE_EXISTING', 'SPAWN_NEW']),
  reasoning: z.string(),
  specificationForMutation: z.string().optional(),
});

export type GapResolutionItem = z.infer<typeof GapResolutionItemSchema>;

export const GapAnalysisReportSchema = z.object({
  actions: z.array(GapResolutionItemSchema),
});

export type GapAnalysisReport = z.infer<typeof GapAnalysisReportSchema>;
