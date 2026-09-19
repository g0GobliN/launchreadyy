/**
 * Tree-walk query helpers over the normalized AST. These are the primitives rules use instead of
 * regex — e.g. "find every real `eval(...)` call" ignores the same token inside a string or comment,
 * which is exactly the false positive the regex scanner can't avoid.
 *
 * @see docs/README.md  (Phase 1)
 */

import type { AstNode, AstTree } from "./types";

/** Depth-first pre-order walk. Return `false` from the visitor to skip a node's children. */
export function walk(root: AstNode, visit: (node: AstNode) => boolean | void): void {
  const stack: AstNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const descend = visit(node);
    if (descend === false) continue;
    // Push in reverse so children are visited left-to-right.
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push(node.children[i]);
    }
  }
}

/** Every node matching a predicate. */
export function findAll(root: AstNode, predicate: (node: AstNode) => boolean): AstNode[] {
  const out: AstNode[] = [];
  walk(root, (node) => {
    if (predicate(node)) out.push(node);
  });
  return out;
}

/** The last dot-segment of a callee/member expression: `cp.exec` → `exec`, `eval` → `eval`. */
function lastSegment(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf(".");
  return dot === -1 ? trimmed : trimmed.slice(dot + 1);
}

/**
 * Call expressions, optionally filtered by callee name. A name matches when it equals the full callee
 * text (`cp.exec`) or its last segment (`exec`) — so `findCalls(tree, "exec")` catches `cp.exec(...)`
 * and `require("child_process").exec(...)`, while `findCalls(tree, "eval")` catches bare `eval(...)`.
 */
export function findCalls(tree: AstTree, name?: string): AstNode[] {
  return findAll(tree.root, (node) => {
    if (node.kind !== "call") return false;
    if (!name) return true;
    return node.name === name || lastSegment(node.name) === name;
  });
}

/** `new X(...)` expressions, optionally filtered by constructor name (full or last segment). */
export function findNew(tree: AstTree, name?: string): AstNode[] {
  return findAll(tree.root, (node) => {
    if (node.kind !== "new") return false;
    if (!name) return true;
    return node.name === name || lastSegment(node.name) === name;
  });
}

/**
 * Module specifiers imported by the file: `import`/`import =` declarations plus `require("x")` and
 * dynamic `import("x")` calls. Returns the specifier strings (e.g. `child_process`).
 */
export function findImports(tree: AstTree): string[] {
  const specs = new Set<string>();
  walk(tree.root, (node) => {
    if (node.kind === "import" && node.name) {
      specs.add(node.name);
      return;
    }
    if (node.kind === "call") {
      const callee = lastSegment(node.name);
      const isRequire = node.name === "require" || callee === "require";
      const isDynamicImport = node.name === "import" || node.rawKind === "ImportKeyword";
      if (isRequire || isDynamicImport) {
        const strArg = node.children.find((c) => c.kind === "string" && c.value !== undefined);
        if (strArg?.value) specs.add(strArg.value);
      }
    }
  });
  return [...specs];
}

/** JSX attributes matching a name, e.g. `findJsxAttributes(tree, "dangerouslySetInnerHTML")`. */
export function findJsxAttributes(tree: AstTree, name: string): AstNode[] {
  return findAll(tree.root, (node) => node.kind === "jsx-attribute" && node.name === name);
}
