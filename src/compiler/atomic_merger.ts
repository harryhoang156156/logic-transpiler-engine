import { ASTNode, ASTNodeSchema } from '../schemas.js';

export interface AtomicPatchOperation {
  action: 'REPLACE' | 'APPEND_TO_MODULE';
  targetNodeId?: string; // Required for REPLACE
  newNode: ASTNode;
}

const CHILD_ARRAY_KEYS = [
  'children',
  'body',
  'tryBranch',
  'catchBranch',
  'trueBranch',
  'falseBranch',
  'callbackBody',
] as const;

function collectNodeIds(node: ASTNode, ids: Set<string>): void {
  ids.add(node.id);

  for (const key of CHILD_ARRAY_KEYS) {
    if (key in node) {
      const children = (node as any)[key];
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child && typeof child === 'object' && 'id' in child) {
            collectNodeIds(child as ASTNode, ids);
          }
        }
      }
    }
  }
}

function findNodePath(node: ASTNode, targetId: string, path: ASTNode[] = []): ASTNode[] | null {
  if (node.id === targetId) {
    return [...path, node];
  }
  for (const key of CHILD_ARRAY_KEYS) {
    if (key in node) {
      const children = (node as any)[key];
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child && typeof child === 'object') {
            const res = findNodePath(child as ASTNode, targetId, [...path, node]);
            if (res) return res;
          }
        }
      }
    }
  }
  return null;
}

function replaceNodeInTree(
  currentNode: ASTNode,
  targetId: string,
  replacementNode: ASTNode
): boolean {
  for (const key of CHILD_ARRAY_KEYS) {
    if (key in currentNode) {
      const childrenArr = (currentNode as any)[key];
      if (Array.isArray(childrenArr)) {
        for (let i = 0; i < childrenArr.length; i++) {
          const child = childrenArr[i];
          if (child && child.id === targetId) {
            childrenArr[i] = replacementNode;
            return true;
          }
          if (child && typeof child === 'object') {
            const replaced = replaceNodeInTree(child as ASTNode, targetId, replacementNode);
            if (replaced) {
              return true;
            }
          }
        }
      }
    }
  }
  return false;
}

function validateUniqueIds(node: ASTNode, seen: Set<string> = new Set()): void {
  if (seen.has(node.id)) {
    throw new Error(`Duplicate node ID detected in merged AST: "${node.id}"`);
  }
  seen.add(node.id);

  for (const key of CHILD_ARRAY_KEYS) {
    if (key in node) {
      const children = (node as any)[key];
      if (Array.isArray(children)) {
        for (const child of children) {
          if (child && typeof child === 'object' && 'id' in child) {
            validateUniqueIds(child as ASTNode, seen);
          }
        }
      }
    }
  }
}

export function applyAtomicPatches(
  rootAst: ASTNode,
  operations: AtomicPatchOperation[]
): ASTNode {
  // Validate all new nodes up front
  for (const op of operations) {
    ASTNodeSchema.parse(op.newNode);
  }

  // Check preconditions before modifying anything (deep clone happens only after checks, or we operate on a clone)
  let clonedAst: ASTNode = structuredClone(rootAst);

  const existingIds = new Set<string>();
  collectNodeIds(clonedAst, existingIds);

  const seenTargets = new Set<string>();

  // Collect all REPLACE target paths to detect ancestor/descendant conflicts
  const replaceTargets = operations
    .filter((op): op is AtomicPatchOperation & { targetNodeId: string } => op.action === 'REPLACE' && !!op.targetNodeId)
    .map(op => ({
      targetNodeId: op.targetNodeId,
      path: findNodePath(clonedAst, op.targetNodeId!),
    }))
    .filter(item => item.path !== null);

  // Check for ancestor/descendant conflicts among REPLACE targets
  for (let i = 0; i < replaceTargets.length; i++) {
    for (let j = i + 1; j < replaceTargets.length; j++) {
      const pathA = replaceTargets[i].path!;
      const pathB = replaceTargets[j].path!;
      // Check if one path is a prefix of the other (ancestor/descendant)
      const minLen = Math.min(pathA.length, pathB.length);
      let isPrefix = true;
      for (let k = 0; k < minLen; k++) {
        if (pathA[k].id !== pathB[k].id) {
          isPrefix = false;
          break;
        }
      }
      if (isPrefix) {
        throw new Error(
          `Overlapping REPLACE targets detected: "${replaceTargets[i].targetNodeId}" ` +
          `is an ancestor/descendant of "${replaceTargets[j].targetNodeId}". ` +
          `Cannot safely apply both replacements.`
        );
      }
    }
  }

  for (const op of operations) {
    if (op.action === 'REPLACE') {
      if (!op.targetNodeId) {
        throw new Error('AtomicPatchOperation with action "REPLACE" must have targetNodeId.');
      }
      if (!existingIds.has(op.targetNodeId)) {
        throw new Error(`Target node id "${op.targetNodeId}" not found in AST.`);
      }
      if (seenTargets.has(op.targetNodeId)) {
        throw new Error(`Duplicate replacement target node id "${op.targetNodeId}" found.`);
      }
      seenTargets.add(op.targetNodeId);
    } else if (op.action !== 'APPEND_TO_MODULE') {
      throw new Error(`Unknown action: "${(op as any).action}".`);
    }
  }

  // Sort operations by depth descending to handle nested replacements properly
  const sortedOperations = [...operations].sort((a, b) => {
    if (a.action === 'REPLACE' && b.action === 'REPLACE' && a.targetNodeId && b.targetNodeId) {
      const pathA = findNodePath(clonedAst, a.targetNodeId);
      const pathB = findNodePath(clonedAst, b.targetNodeId);
      if (pathA && pathB) {
        return pathB.length - pathA.length;
      }
    }
    return 0;
  });

  // Apply operations
  for (const op of sortedOperations) {
    const clonedNewNode = structuredClone(op.newNode);
    if (op.action === 'REPLACE') {
      const targetId = op.targetNodeId!;
      if (clonedAst.id === targetId) {
        clonedAst = ASTNodeSchema.parse(clonedNewNode);
        continue;
      }
      const replaced = replaceNodeInTree(clonedAst, targetId, clonedNewNode);
      if (!replaced) {
        throw new Error(`Target node id "${targetId}" not found in AST during replacement.`);
      }
    } else if (op.action === 'APPEND_TO_MODULE') {
      if (clonedAst.type !== 'ModuleContainer') {
        throw new Error(
          `Cannot append to module: root AST node type is "${clonedAst.type}", expected "ModuleContainer".`
        );
      }
      (clonedAst as any).children.push(clonedNewNode);
    }
  }

  // Validate unique IDs across the entire merged tree
  validateUniqueIds(clonedAst);

  return ASTNodeSchema.parse(clonedAst);
}

