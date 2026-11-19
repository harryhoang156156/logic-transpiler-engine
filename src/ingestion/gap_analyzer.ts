import { ASTNode, GapAnalysisReport, GapAnalysisReportSchema } from '../schemas.js';
import { generateStructuredOutput } from '../client/ai_client.js';
import { SYSTEM_PROMPT_AUDITOR, buildAuditPrompt } from '../client/prompts.js';

/**
 * Recursively collects all node IDs from an ASTNode tree.
 */
function collectNodeIds(node: ASTNode, ids: Set<string> = new Set()): Set<string> {
  ids.add(node.id);

  // Recursively collect from children based on node type
  switch (node.type) {
    case 'ModuleContainer':
      for (const child of node.children) {
        collectNodeIds(child, ids);
      }
      break;
    case 'AsyncFunctionBlock':
      for (const child of node.body) {
        collectNodeIds(child, ids);
      }
      break;
    case 'TryCatchGuardian':
      for (const child of node.tryBranch) {
        collectNodeIds(child, ids);
      }
      for (const child of node.catchBranch) {
        collectNodeIds(child, ids);
      }
      break;
    case 'ConditionalBranch':
      for (const child of node.trueBranch) {
        collectNodeIds(child, ids);
      }
      if (node.falseBranch) {
        for (const child of node.falseBranch) {
          collectNodeIds(child, ids);
        }
      }
      break;
    case 'LoopInterval':
      for (const child of node.body) {
        collectNodeIds(child, ids);
      }
      break;
    case 'Solana_ListenPumpFun':
      for (const child of node.callbackBody) {
        collectNodeIds(child, ids);
      }
      break;
    // Leaf nodes with no children: ExpressionBlock, Solana_EstablishConnection,
    // Solana_ParseWallet, Solana_SimulatePayload, File_AppendLog,
    // Sqlite_InitDatabase, Sqlite_ExecuteWrite, Sqlite_QueryRead,
    // Redis_InitClient, Redis_QueuePush, Redis_QueueBlockingPop
    // have no children to traverse
  }

  return ids;
}

/**
 * Finds a node by ID in the AST tree.
 */
function findNodeById(node: ASTNode, targetId: string): ASTNode | null {
  if (node.id === targetId) {
    return node;
  }

  // Recursively search children based on node type
  const children: ASTNode[] = [];

  switch (node.type) {
    case 'ModuleContainer':
      children.push(...node.children);
      break;
    case 'AsyncFunctionBlock':
      children.push(...node.body);
      break;
    case 'TryCatchGuardian':
      children.push(...node.tryBranch, ...node.catchBranch);
      break;
    case 'ConditionalBranch':
      children.push(...node.trueBranch);
      if (node.falseBranch) {
        children.push(...node.falseBranch);
      }
      break;
    case 'LoopInterval':
      children.push(...node.body);
      break;
    case 'Solana_ListenPumpFun':
      children.push(...node.callbackBody);
      break;
    // Leaf nodes have no children
  }

  for (const child of children) {
    const found = findNodeById(child, targetId);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * Analyzes code gaps between an existing AST and a feature brief.
 * Returns a GapAnalysisReport with resolution actions for each target node.
 */
export async function analyzeCodeGaps(
  existingAst: ASTNode,
  featureBrief: string,
  clientOverride?: any
): Promise<GapAnalysisReport> {
  // Build the audit prompt
  const existingAstJson = JSON.stringify(existingAst, null, 2);
  const userPrompt = buildAuditPrompt(existingAstJson, featureBrief);

  // Call the LLM to get the gap analysis report
  const report = await generateStructuredOutput({
    systemInstruction: SYSTEM_PROMPT_AUDITOR,
    userPrompt,
    schema: GapAnalysisReportSchema,
    clientOverride,
  });

  // Verify every returned targetNodeId exists in the rootAst
  const validNodeIds = collectNodeIds(existingAst);

  for (const action of report.actions) {
    if (!validNodeIds.has(action.targetNodeId)) {
      throw new Error(
        `Gap analysis returned invalid targetNodeId: "${action.targetNodeId}". ` +
        `This node does not exist in the provided AST.`
      );
    }
  }

  return report;
}

/**
 * Extracts target subgraphs for MUTATE_EXISTING actions from the root AST.
 * Returns a Map of targetNodeId -> ASTNode (the subtree rooted at that node).
 */
export function extractTargetSubgraphs(
  rootAst: ASTNode,
  report: GapAnalysisReport
): Map<string, ASTNode> {
  const subgraphs = new Map<string, ASTNode>();

  for (const action of report.actions) {
    if (action.resolution === 'MUTATE_EXISTING') {
      const node = findNodeById(rootAst, action.targetNodeId);
      if (node) {
        subgraphs.set(action.targetNodeId, node);
      } else {
        // This should not happen if analyzeCodeGaps validation passed,
        // but we guard against it anyway.
        throw new Error(
          `Could not find node with id "${action.targetNodeId}" for MUTATE_EXISTING action.`
        );
      }
    }
  }

  return subgraphs;
}
