import { parse as parseYaml } from "yaml";

export type FileValidationStatus = "valid" | "invalid" | "unverified";

export interface FileValidationResult {
  status: FileValidationStatus;
  detail?: string;
}

const VALID: FileValidationResult = { status: "valid" };
const UNVERIFIED: FileValidationResult = { status: "unverified" };

function invalid(detail: string): FileValidationResult {
  return { status: "invalid", detail };
}

/** Leftover ``` in content that survived stripCodeFence means a fence mid-content or unstripped wrapper. */
function hasStrayCodeFence(content: string): boolean {
  return content.includes("```");
}

const CLOSE_FOR_OPEN: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
const CLOSERS = new Set(Object.values(CLOSE_FOR_OPEN));

function skipStringBody(content: string, start: number, quote: string): number {
  let i = start;
  while (i < content.length && content[i] !== quote) {
    if (content[i] === "\\") i++;
    i++;
  }
  return i + 1;
}

/**
 * Bracket-balance check for JS/TS-family content — no real parser, so this won't catch every
 * syntax error, but it reliably catches the most common LLM failure mode: truncated or otherwise
 * malformed output where braces/parens/brackets don't close. Deliberately doesn't special-case
 * regex literals (rare in generated test/config files, not worth the complexity here).
 */
function validateBalancedSyntax(content: string): FileValidationResult {
  const stack: string[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    const c = content[i];

    if (c === "/" && content[i + 1] === "/") {
      const nl = content.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }
    if (c === "/" && content[i + 1] === "*") {
      const end = content.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipStringBody(content, i + 1, c);
      continue;
    }
    if (c === "`") {
      i = skipTemplateLiteral(content, i + 1);
      continue;
    }
    if (c in CLOSE_FOR_OPEN) {
      stack.push(CLOSE_FOR_OPEN[c]);
    } else if (CLOSERS.has(c)) {
      if (stack.pop() !== c) {
        return invalid(`Unbalanced "${c}" — generated file may be truncated or malformed`);
      }
    }
    i++;
  }
  if (stack.length > 0) {
    return invalid(`Missing closing "${stack[0]}" — generated file may be truncated or malformed`);
  }
  return VALID;
}

/** Walks past a template literal body, recursing into `${...}` expressions (which can nest strings/braces). */
function skipTemplateLiteral(content: string, start: number): number {
  let i = start;
  const n = content.length;
  while (i < n && content[i] !== "`") {
    if (content[i] === "\\") {
      i += 2;
      continue;
    }
    if (content[i] === "$" && content[i + 1] === "{") {
      i += 2;
      let depth = 1;
      while (i < n && depth > 0) {
        if (content[i] === "{") depth++;
        else if (content[i] === "}") depth--;
        else if (content[i] === '"' || content[i] === "'") {
          i = skipStringBody(content, i + 1, content[i]);
          continue;
        } else if (content[i] === "`") {
          i = skipTemplateLiteral(content, i + 1);
          continue;
        }
        i++;
      }
      continue;
    }
    i++;
  }
  return i + 1;
}

function validateYaml(content: string): FileValidationResult {
  try {
    parseYaml(content);
    return VALID;
  } catch (e) {
    return invalid(e instanceof Error ? e.message : "Invalid YAML");
  }
}

function validateJson(content: string): FileValidationResult {
  try {
    JSON.parse(content);
    return VALID;
  } catch (e) {
    return invalid(e instanceof Error ? e.message : "Invalid JSON");
  }
}

const ENV_LINE_RE = /^\s*(#.*)?$|^\s*[A-Za-z_][A-Za-z0-9_]*\s*=.*$/;

function validateEnvFile(content: string): FileValidationResult {
  const badLine = content.split("\n").find((line) => !ENV_LINE_RE.test(line));
  if (badLine !== undefined) return invalid(`Not a valid KEY=value line: "${badLine.trim()}"`);
  return VALID;
}

function normalizeHeading(text: string): string {
  return text
    .replace(/[^\w\s]/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Catches the readme-ai failure mode found in live testing: told to "merge into one" when a
 * section already exists, the model instead added a second, near-identical section (e.g. a new
 * "Getting Started" on top of an existing "Local Development" with the same "Setup" subsection
 * and the same code block repeated verbatim) rather than actually merging. Duplicate headings or
 * duplicate code blocks are a reliable signal of exactly that — unmerged, appended content.
 */
function validateMarkdown(content: string): FileValidationResult {
  const seenHeadings = new Set<string>();
  for (const m of content.matchAll(/^#{2,3}\s+(.+)$/gm)) {
    const heading = normalizeHeading(m[1]);
    if (!heading) continue;
    if (seenHeadings.has(heading)) {
      return invalid(
        `Duplicate section heading "${m[1].trim()}" — likely unmerged content from the existing file`,
      );
    }
    seenHeadings.add(heading);
  }

  const blocks = [...content.matchAll(/```[a-z0-9]*\n([\s\S]*?)```/gi)]
    .map((m) => m[1].trim())
    .filter((b) => b.length > 30);
  const seenBlocks = new Set<string>();
  for (const block of blocks) {
    if (seenBlocks.has(block)) {
      return invalid("Contains two identical code blocks — likely duplicated/unmerged content");
    }
    seenBlocks.add(block);
  }

  return VALID;
}

/**
 * Best-effort syntax check on AI-generated file content before it's shown for review.
 * Only claims a real check where one is cheap enough to ship in a size-constrained edge
 * Worker (YAML/JSON parsers, a bracket-balance heuristic for JS/TS) — everything else is
 * honestly reported as "unverified" rather than faked. A full TS/JS parser (the `typescript`
 * package) was deliberately not used here — it added ~10MB to the bundle.
 *
 * Markdown skips the stray-fence heuristic — code fences are normal, expected content in a
 * README (install instructions, .env examples), not a sign of leftover AI wrapper syntax, so
 * that check must not run on it (it did in an earlier version and flagged every well-formed
 * README as "invalid"). It gets its own duplication check instead — see validateMarkdown.
 */
export function validateGeneratedFile(path: string, content: string): FileValidationResult {
  if (!content.trim()) return invalid("Generated file is empty");
  if (/\.md$/i.test(path)) return validateMarkdown(content);

  if (hasStrayCodeFence(content)) {
    return invalid("Contains a leftover markdown code fence (```) — likely malformed output");
  }

  if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(path)) return validateBalancedSyntax(content);
  if (/\.ya?ml$/.test(path)) return validateYaml(content);
  if (/\.json$/.test(path)) return validateJson(content);
  if (/(^|\/)\.env(\.|$)/.test(path)) return validateEnvFile(content);

  return UNVERIFIED;
}
