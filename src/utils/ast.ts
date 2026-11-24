import { ASTNode } from '../schemas.js';

export const CHILD_ARRAY_KEYS = [
  'children',
  'body',
  'tryBranch',
  'catchBranch',
  'trueBranch',
  'falseBranch',
  'callbackBody',
] as const;

export function collectNodeIds(node: ASTNode, ids: Set<string>): void {
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

let idCounter = 0;

export function generateNodeId(existingIds: Set<string>): string {
  let id: string;
  do {
    idCounter++;
    id = `node_${idCounter}`;
  } while (existingIds.has(id));
  existingIds.add(id);
  return id;
}

export function resetIdCounter(): void {
  idCounter = 0;
}
