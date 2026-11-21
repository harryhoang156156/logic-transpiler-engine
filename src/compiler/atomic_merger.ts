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
      const children = (nodeKeys: any) => nodeKeys; // noop
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

export function applyAtomicPatches(
  rootAst: ASTNode,
  operations: AtomicPatchOperation[]
): ASTNode {
  // Deep clone to ensure atomic transaction isolation
  let clonedAst: ASTNode = structuredClone(rootAst);

  // Validate all new nodes up front
  for (const op of operations) {
    ASTNodeSchema.parse(op.newNode);
  }

  // Sort operations by depth (ancestors first or descendants first) to handle overlapping targets
  // Specifically, if an ancestor and descendant are both targeted, sort by depth descending (deepest first)
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

  // Check preconditions before modifying
  const existingIds = new Set<string>();
  collectNodeIds(clonedAst, existingIds);

  for (const op of sortedOperations) {
    if (op.action === 'REPLACE') {
      if (!op.targetNodeId) {
        throw new Error('AtomicPatchOperation with action "REPLACE" must have targetNodeId.');
      }
      if (!existingIds.has(op.targetNodeId)) {
        throw new Error(`Target node id "${op.targetNodeId}" not found in AST.`);
      }
    } else if (op.action !== 'APPEND_TO_MODULE') {
      throw new Error(`Unknown action: "${(op as any).action}".`);
    }
  }

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
        // If an ancestor replacement already replaced a subtree containing this target, we can safely ignore or handle it
        continue;
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

  return ASTNodeSchema.parse(clonedAst);
}
