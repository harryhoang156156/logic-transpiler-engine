import { z } from 'zod';

// ---------------------------------------------------------------------------
// Base Node Properties
// ---------------------------------------------------------------------------

const BaseNodeProps = {
  id: z.string(),
  intentTag: z.string().optional(),
};

// ---------------------------------------------------------------------------
// Forward declaration for recursive ASTNode
// ---------------------------------------------------------------------------

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
// Core Structural Containers
// ---------------------------------------------------------------------------

export const ModuleContainerSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('ModuleContainer'),
  moduleName: z.string(),
  exports: z.array(z.string()).default([]),
  children: z.lazy(() => z.array(ASTNodeSchema)),
});

export type ModuleContainer = z.infer<typeof ModuleContainerSchema>;

export const AsyncFunctionBlockSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('AsyncFunctionBlock'),
  functionName: z.string(),
  parameters: z.array(z.object({ name: z.string(), tsType: z.string() })),
  returnType: z.string().default('Promise<void>'),
  isExported: z.boolean().default(true),
  body: z.lazy(() => z.array(ASTNodeSchema)),
});

export type AsyncFunctionBlock = z.infer<typeof AsyncFunctionBlockSchema>;

export const TryCatchGuardianSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('TryCatchGuardian'),
  tryBranch: z.lazy(() => z.array(ASTNodeSchema)),
  catchBranch: z.lazy(() => z.array(ASTNodeSchema)),
  errorVariableName: z.string().default('error'),
});

export type TryCatchGuardian = z.infer<typeof TryCatchGuardianSchema>;

export const ConditionalBranchSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('ConditionalBranch'),
  conditionExpression: z.string(),
  trueBranch: z.lazy(() => z.array(ASTNodeSchema)),
  falseBranch: z.lazy(() => z.array(ASTNodeSchema)).optional(),
});

export type ConditionalBranch = z.infer<typeof ConditionalBranchSchema>;

export const LoopIntervalSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('LoopInterval'),
  loopType: z.enum(['while', 'forOf', 'setInterval']),
  loopHeader: z.string(),
  body: z.lazy(() => z.array(ASTNodeSchema)),
});

export type LoopInterval = z.infer<typeof LoopIntervalSchema>;

// ---------------------------------------------------------------------------
// Loose Token Node
// ---------------------------------------------------------------------------

export const ExpressionBlockSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('ExpressionBlock'),
  codeSnippet: z.string(),
});

export type ExpressionBlock = z.infer<typeof ExpressionBlockSchema>;

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

export type SolanaEstablishConnection = z.infer<typeof SolanaEstablishConnectionSchema>;

export const SolanaParseWalletSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Solana_ParseWallet'),
  keypairVarName: z.string().default('walletKeypair'),
  privateKeyEnvVar: z.string().default('PRIVATE_KEY'),
});

export type SolanaParseWallet = z.infer<typeof SolanaParseWalletSchema>;

export const SolanaListenPumpFunSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Solana_ListenPumpFun'),
  connectionVarName: z.string().default('connection'),
  programAddress: z.string().default('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwpump'),
  accountInfoParamName: z.string().default('accountInfo'),
  callbackBody: z.lazy(() => z.array(ASTNodeSchema)),
});

export type SolanaListenPumpFun = z.infer<typeof SolanaListenPumpFunSchema>;

export const SolanaSimulatePayloadSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Solana_SimulatePayload'),
  connectionVarName: z.string().default('connection'),
  transactionVarName: z.string().default('transaction'),
  throwOnError: z.boolean().default(true),
});

export type SolanaSimulatePayload = z.infer<typeof SolanaSimulatePayloadSchema>;

export const FileAppendLogSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('File_AppendLog'),
  filePath: z.string().default('logs.txt'),
  messageExpression: z.string(),
});

export type FileAppendLog = z.infer<typeof FileAppendLogSchema>;

export const SqliteInitDatabaseSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Sqlite_InitDatabase'),
  dbVarName: z.string().default('db'),
  dbFilePath: z.string().default('engine.db'),
});

export type SqliteInitDatabase = z.infer<typeof SqliteInitDatabaseSchema>;

export const SqliteExecuteWriteSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Sqlite_ExecuteWrite'),
  dbVarName: z.string().default('db'),
  sqlQuery: z.string(),
  paramsArrayExpression: z.string(),
});

export type SqliteExecuteWrite = z.infer<typeof SqliteExecuteWriteSchema>;

export const SqliteQueryReadSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Sqlite_QueryRead'),
  dbVarName: z.string().default('db'),
  resultVarName: z.string(),
  readMode: z.enum(['all', 'get']),
  sqlQuery: z.string(),
  paramsArrayExpression: z.string().default('[]'),
});

export type SqliteQueryRead = z.infer<typeof SqliteQueryReadSchema>;

export const RedisInitClientSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Redis_InitClient'),
  redisVarName: z.string().default('redis'),
  redisUrlEnvVar: z.string().default('REDIS_URL'),
});

export type RedisInitClient = z.infer<typeof RedisInitClientSchema>;

export const RedisQueuePushSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Redis_QueuePush'),
  redisVarName: z.string().default('redis'),
  queueKey: z.string(),
  payloadExpression: z.string(),
});

export type RedisQueuePush = z.infer<typeof RedisQueuePushSchema>;

export const RedisQueueBlockingPopSchema = z.object({
  ...BaseNodeProps,
  type: z.literal('Redis_QueueBlockingPop'),
  redisVarName: z.string().default('redis'),
  queueKey: z.string(),
  resultVarName: z.string(),
  timeoutSeconds: z.number().default(0),
});

export type RedisQueueBlockingPop = z.infer<typeof RedisQueueBlockingPopSchema>;

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
);

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
