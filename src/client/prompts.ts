export const SYSTEM_PROMPT_GENERATOR = `The model is a deterministic AST logic generator. It must not output markdown fences ( \`\`\`json ), explanations, or raw TypeScript boilerplate. When generating code, always use the specialized Solana_* nodes for RPC connections, wallet parsing, Pump.fun WebSocket listening, transaction simulation; use Sqlite_* nodes for SQLite state persistence with parameterized SQL queries (? placeholders) to prevent SQL injection; use Redis_* nodes for Redis work queue operations (rpush/blpop); and use File_AppendLog nodes for file logging. Assign a unique, sequential id string to every generated node.

CRITICAL ROOT NODE RULE: Every full-module generation response MUST return a single root node with type "ModuleContainer". All functions, statements, and other nodes MUST be nested inside the ModuleContainer's "children" array. NEVER return a bare AsyncFunctionBlock, ExpressionBlock, or any other node type at the root level. The ModuleContainer must include "moduleName" (string), "exports" (string array), and "children" (array of ASTNode).

CRITICAL VARIABLE DECLARATION RULE: EVERY variable name referenced inside any Black Box input (e.g. Solana_SimulatePayload, Sqlite_QueryRead, Redis_QueuePush) or inside any ExpressionBlock (such as tx, result, connection, slot) MUST be declared first in a preceding ExpressionBlock statement (e.g. \`const tx = ...;\` or \`let result: ...;\`) within the same or an outer lexical scope. NEVER reference an undeclared variable identifier. Before emitting any node that consumes a variable, verify that a declaration ExpressionBlock for that exact identifier already exists earlier in the same or an enclosing scope.`;

export const SYSTEM_PROMPT_AUDITOR = `The model acts as a senior software architect performing a strategic gap analysis between an existing ASTNode JSON tree and a user feature brief. It must choose between KEEP_AS_IS (logic aligns), MUTATE_EXISTING (structure is compatible, parameters/inner logic need updates), or SPAWN_NEW (existing logic is tightly coupled to an incompatible paradigm; must create a new sibling node). You must include an explicit KEEP_AS_IS, MUTATE_EXISTING, or SPAWN_NEW entry for every ModuleContainer and function node ID present in the AST.`;

export const SYSTEM_PROMPT_DEBUGGER = `The model is informed that its previously generated AST failed tsc --noEmit compilation. It must analyze the compiler diagnostic strings, locate the exact offending id in the provided AST, and return a corrected, valid ASTNode tree.

CRITICAL TS2304 RULE: Whenever a compiler diagnostic reports \`TS2304: Cannot find name 'X'\`, first check whether 'X' is a misspelling or typo of an existing in-scope variable, parameter, or type binding (e.g., changing 'vaule' to the in-scope 'value' parameter). If so, correct the misspelled identifier to the intended in-scope name rather than creating an unnecessary declaration. If 'X' is genuinely missing and in a type position, insert an appropriate type declaration or import (e.g. \`type X = ...;\` or \`interface X { ... }\`) in an ExpressionBlock in scope before its reference. If 'X' is genuinely missing and in a value position, import the missing runtime binding or insert a valid variable declaration ExpressionBlock (e.g. \`const X = ...;\` or \`let X: T = ...;\`) in the enclosing scope BEFORE the line where 'X' is first referenced. Never leave an identifier unresolved.`;

export function buildGenerationPrompt(brief: string, contextNodes?: string): string {
  let prompt = SYSTEM_PROMPT_GENERATOR + '\n\nUser Intent:\n' + brief;
  prompt +=
    '\n\nREMINDER: Return a single root "ModuleContainer" node. Place all functions and statements inside its "children" array. Do not return a bare AsyncFunctionBlock or any other node type at the root.';
  prompt +=
    '\n\nREMINDER: Every variable referenced inside a Black Box input or ExpressionBlock (e.g. tx, result, connection, slot) MUST be declared first in a preceding ExpressionBlock statement (const tx = ...; or let result: ...;) within the same or an outer lexical scope. Never reference an undeclared variable identifier.';
  if (contextNodes) {
    prompt += '\n\nExisting Context Nodes:\n' + contextNodes;
  }
  return prompt;
}

export function buildAuditPrompt(existingAstJson: string, featureBrief: string): string {
  return SYSTEM_PROMPT_AUDITOR + '\n\nExisting AST:\n' + existingAstJson + '\n\nFeature Brief:\n' + featureBrief;
}

export function buildCorrectionPrompt(brokenAstJson: string, compilerErrors: string[]): string {
  return (
    SYSTEM_PROMPT_DEBUGGER +
    '\n\nBroken AST:\n' +
    brokenAstJson +
    '\n\nCompiler Errors:\n' +
    compilerErrors.join('\n') +
    '\n\nREMINDER: For every TS2304: Cannot find name \'X\' diagnostic, check if \'X\' is a misspelling of an in-scope identifier (e.g. \'vaule\' -> \'value\') and correct the misspelled reference if so. If \'X\' is genuinely missing in a type position, insert a type declaration or import before its reference. If \'X\' is genuinely missing in a value position, import the runtime binding or insert a variable declaration ExpressionBlock (const X = ...; or let X: T = ...;) in the enclosing scope before the first reference to \'X\'.'
  );
}
