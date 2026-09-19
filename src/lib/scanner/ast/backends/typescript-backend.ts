/**
 * Real AST backend for TS/JS/JSX/TSX using the TypeScript compiler API (`ts.createSourceFile`).
 *
 * Pure JavaScript, no native modules — runs in Node (tests, CLI, E2B sandbox) today. The `typescript`
 * package is loaded via a guarded dynamic import so this module never throws when the parser can't be
 * resolved in the current runtime; the registry then returns null and rules fall back to regex.
 *
 * @see docs/README.md  (Phase 1)
 */

import type * as ts from "typescript";
import type { AstLanguage, AstNode, NormalizedKind, ParserBackend } from "../types";

type TsModule = typeof ts;

let tsModulePromise: Promise<TsModule | null> | null = null;

/**
 * Load the `typescript` module once, tolerating environments where it can't be resolved.
 * `@vite-ignore` keeps the bundler from statically pulling `typescript` into the client bundle.
 */
async function loadTypeScript(): Promise<TsModule | null> {
  if (tsModulePromise) return tsModulePromise;
  tsModulePromise = (async () => {
    try {
      const specifier = "typescript";
      const mod = (await import(/* @vite-ignore */ specifier)) as { default?: TsModule } & TsModule;
      return (mod.default ?? mod) as TsModule;
    } catch {
      return null;
    }
  })();
  return tsModulePromise;
}

function scriptKindFor(t: TsModule, language: AstLanguage): ts.ScriptKind {
  switch (language) {
    case "tsx":
      return t.ScriptKind.TSX;
    case "jsx":
      return t.ScriptKind.JSX;
    case "javascript":
      return t.ScriptKind.JS;
    case "typescript":
    default:
      return t.ScriptKind.TS;
  }
}

/** Map a TS SyntaxKind onto the backend-neutral classification. */
function normalizedKindFor(t: TsModule, node: ts.Node): NormalizedKind {
  const k = node.kind;
  const s = t.SyntaxKind;
  if (k === s.SourceFile) return "program";
  if (k === s.CallExpression) return "call";
  if (k === s.NewExpression) return "new";
  // `export … from "x"` and `export * from "x"` are module requests too — the ES spec counts them in
  // [[RequestedModules]] — so they classify as imports and reach findImports. A bare `export { x }`
  // has no specifier and is filtered there by its missing name.
  if (k === s.ImportDeclaration || k === s.ImportEqualsDeclaration || k === s.ExportDeclaration) {
    return "import";
  }
  if (
    k === s.FunctionDeclaration ||
    k === s.FunctionExpression ||
    k === s.ArrowFunction ||
    k === s.MethodDeclaration
  ) {
    return "function";
  }
  if (k === s.ClassDeclaration || k === s.ClassExpression) return "class";
  if (k === s.JsxAttribute) return "jsx-attribute";
  if (k === s.StringLiteral || k === s.NoSubstitutionTemplateLiteral || k === s.JsxText) {
    return "string";
  }
  if (k === s.Identifier) return "identifier";
  if (k === s.PropertyAccessExpression || k === s.ElementAccessExpression) return "member";
  return "other";
}

function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' || first === "'" || first === "`") && last === first) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** Kind-dependent convenience label (callee text, module specifier, or JSX attribute name). */
function nameFor(
  t: TsModule,
  node: ts.Node,
  sf: ts.SourceFile,
  source: string,
): string | undefined {
  const s = t.SyntaxKind;
  const slice = (n: ts.Node) => source.slice(n.getStart(sf), n.getEnd());
  if (node.kind === s.CallExpression) {
    return slice((node as ts.CallExpression).expression);
  }
  if (node.kind === s.NewExpression) {
    return slice((node as ts.NewExpression).expression);
  }
  if (node.kind === s.ImportDeclaration || node.kind === s.ExportDeclaration) {
    // Both carry an optional `moduleSpecifier`; a re-export without one (`export { x }`) yields
    // undefined, which findImports skips.
    const spec = (node as ts.ImportDeclaration | ts.ExportDeclaration).moduleSpecifier;
    return spec ? unquote(slice(spec)) : undefined;
  }
  if (node.kind === s.JsxAttribute) {
    return slice((node as ts.JsxAttribute).name);
  }
  return undefined;
}

async function parseTypeScript(
  language: AstLanguage,
  path: string,
  source: string,
): Promise<AstNode | null> {
  const t = await loadTypeScript();
  if (!t) return null;

  let sf: ts.SourceFile;
  try {
    sf = t.createSourceFile(
      path || "source.ts",
      source,
      t.ScriptTarget.Latest,
      /* setParentNodes */ true,
      scriptKindFor(t, language),
    );
  } catch {
    return null;
  }

  const build = (node: ts.Node): AstNode => {
    const start = node.getStart(sf);
    const end = node.getEnd();
    const kind = normalizedKindFor(t, node);
    const text = source.slice(start, end);
    const astNode: AstNode = {
      kind,
      rawKind: t.SyntaxKind[node.kind],
      text,
      line: sf.getLineAndCharacterOfPosition(start).line + 1,
      start,
      end,
      children: [],
    };
    const name = nameFor(t, node, sf, source);
    if (name !== undefined) astNode.name = name;
    if (kind === "string") astNode.value = unquote(text);
    node.forEachChild((child) => {
      astNode.children.push(build(child));
    });
    return astNode;
  };

  return build(sf);
}

export const typescriptBackend: ParserBackend = {
  id: "typescript-compiler",
  languages: ["typescript", "javascript", "tsx", "jsx"],
  parse: parseTypeScript,
};

/** Test/diagnostic helper: whether `typescript` can be resolved in this runtime. */
export async function isTypeScriptBackendAvailable(): Promise<boolean> {
  return (await loadTypeScript()) !== null;
}
