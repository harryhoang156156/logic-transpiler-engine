import { ASTNode, GapAnalysisReport, GapAnalysisReportSchema } from '../schemas.js';
import { generateStructuredOutput } from '../client/ai_client.js';
import { SYSTEM_PROMPT_AUDITOR, buildAuditPrompt } from '../client/prompts.js';

function collectNodeIds(node: ASTNode, ids = new Set<string>()): Set<string> {
  if (!node) return ids;
  if (typeof node.id === 'string') {
    ids.add(node.id);
  }
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) collectNodeIds(child, ids);
  }
  if ('body' in node && Array.isArray(node.body)) {
    for (const child of node.body) collectNodeIds(child, ids);
  }
  if ('tryBranch' in node && Array.isArray(node.tryBranch)) {
    for (const child of node.tryBranch) collectNodeIds(child, ids);
  }
  if ('catchBranch' in node && Array.isArray(node.catchBranch)) {
    for (const child of node.catchBranch) collectNodeIds(child, ids);
  }
  if ('trueBranch' in node && Array.isArray(node.trueBranch)) {
    for (const child of node.trueBranch) collectNodeIds(child, ids);
  }
  if ('falseBranch' in node && Array.isArray(node.falseBranch)) {
    for (const child of node.falseBranch) collectNodeIds(child, ids);
  }
  if ('callbackBody' in node && Array.isArray(node.callbackBody)) {
    for (const child of node.callbackBody) collectNodeIds(child, ids);
  }
  return ids;
}

function collectModuleAndFunctionNodeIds(node: ASTNode, ids = new Set<string>()): Set<string> {
  if (!node) return ids;
  if ((node.type === 'ModuleContainer' || node.type === 'AsyncFunctionBlock') && typeof node.id === 'string') {
    ids.add(node.id);
  }
  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) collectModuleAndFunctionNodeIds(child, ids);
  }
  if ('body' in node && Array.isArray(node.body)) {
    for (const child of node.body) collectModuleAndFunctionNodeIds(child, ids);
  }
  if ('tryBranch' in node && Array.isArray(node.tryBranch)) {
    for (const child of node.tryBranch) collectModuleAndFunctionNodeIds(child, ids);
  }
  if ('catchBranch' in node && Array.isArray(node.catchBranch)) {
    for (const child of node.catchBranch) collectModuleAndFunctionNodeIds(child, ids);
  }
  if ('trueBranch' in node && Array.isArray(node.trueBranch)) {
    for (const child of node.trueBranch) collectModuleAndFunctionNodeIds(child, ids);
  }
  if ('falseBranch' in node && Array.isArray(node.falseBranch)) {
    for (const child of node.falseBranch) collectModuleAndFunctionNodeIds(child, ids);
  }
  if ('callbackBody' in node && Array.isArray(node.callbackBody)) {
    for (const child of node.callbackBody) collectModuleAndFunctionNodeIds(child, ids);
  }
  return ids;
}

function findNodeById(node: ASTNode, id: string): ASTNode | null {
  if (node.id === id) return node;
  const childrenLists = [
    (node as any).children,
    (node as any).body,
    (node as any).tryBranch,
    (node as any).catchBranch,
    (node as any).trueBranch,
    (node as any).falseBranch,
    (node as any).callbackBody,
  ];
  for (const list of childrenLists) {
    if (Array.isArray(list)) {
      for (const child of list) {
        const found = findNodeById(child, id);
        if (found) return found;
      }
    }
  }
  return null;
}

export async function analyzeCodeGaps(
  existingAst: ASTNode,
  featureBrief: string,
  clientOverride?: any
): Promise<GapAnalysisReport> {
  const serializedAst = JSON.stringify(existingAst, null, 2);
  const userPrompt = buildAuditPrompt(serializedAst, featureBrief);

  const report = await generateStructuredOutput({
    systemInstruction: SYSTEM_PROMPT_AUDITOR,
    userPrompt,
    schema: GapAnalysisReportSchema,
    clientOverride,
  });

  const existingIds = collectNodeIds(existingAst);
  const requiredModAndFuncIds = collectModuleAndFunctionNodeIds(existingAst);

  for (const item of report.actions) {
    if (!existingIds.has(item.targetNodeId)) {
      throw new Error(`LLM hallucinated non-existent targetNodeId: "${item.targetNodeId}"`);
    }
    if (requiredModAndFuncIds.has(item.targetNodeId)) {
      requiredModAndFuncIds.delete(item.targetNodeId);
    }
  }

  if (requiredModAndFuncIds.size > 0) {
    throw new Error(`Report missing resolution for required module or function node: ${Array.from(requiredModAndFuncIds).join(', ')}`);
  }

  return report;
}

export function extractTargetSubgraphs(
  rootAst: ASTNode,
  report: GapAnalysisReport
): Map<string, ASTNode> {
  const subgraphs = new Map<string, ASTNode>();
  for (const item of report.actions) {
    if (item.resolution === 'MUTATE_EXISTING') {
      const node = findNodeById(rootAst, item.targetNodeId);
      if (node) {
        subgraphs.set(item.targetNodeId, node);
      }
    }
  }
  return subgraphs;
}

