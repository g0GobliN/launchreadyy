/**
 * Dockerfile security.
 *
 * The existing Dockerfile rule asks whether one exists. This asks whether the one that exists is
 * safe to run in production — a different question, and the one that matters on launch day.
 *
 * Scope is deliberately narrow: only findings that change what an attacker can do if they get
 * code execution in the container, or that put a credential somewhere it can be read back. Style
 * and image-size advice is left out; it would bury the two findings here that actually matter.
 *
 * The rules are ours. See docs/reference/19-tool-licensing.md.
 */

import type { IssueInput } from "../../scanner-rules";
import { confidenceFromSignals, type Signal } from "./signals";

/**
 * Suffixes that mean "source file about Dockerfiles", not "a Dockerfile".
 *
 * `Dockerfile.prod` is a Dockerfile; `Dockerfile.ts` is TypeScript, and parsing it as one would
 * produce findings against code that never builds an image.
 */
const NOT_A_DOCKERFILE_SUFFIX =
  /\.(ts|tsx|js|jsx|mjs|cjs|md|mdx|json|ya?ml|toml|txt|snap|py|go|rb|rs|sh)$/i;

export function isDockerfilePath(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  if (NOT_A_DOCKERFILE_SUFFIX.test(base)) return false;
  // Both conventions: `Dockerfile.prod` and `prod.Dockerfile`.
  return /^Dockerfile(\.[\w-]+)?$/i.test(base) || /^[\w-]+\.Dockerfile$/i.test(base);
}

export interface Line {
  file: string;
  line: number;
  text: string;
}

/**
 * Instruction lines with continuations joined, comments dropped.
 *
 * A `RUN` spanning five backslash-continued lines is one instruction, and matching per raw line
 * would see fragments — missing anything whose interesting half sits on the second line.
 */
export function instructions(file: string, content: string): Line[] {
  const out: Line[] = [];
  const raw = content.split("\n");
  let buffer = "";
  let startLine = 0;
  for (let i = 0; i < raw.length; i++) {
    const text = raw[i]!;
    if (/^\s*#/.test(text)) continue;
    if (buffer === "") {
      if (text.trim() === "") continue;
      startLine = i + 1;
    }
    if (/\\\s*$/.test(text)) {
      buffer += `${text.replace(/\\\s*$/, "")} `;
      continue;
    }
    out.push({ file, line: startLine, text: (buffer + text).trim() });
    buffer = "";
  }
  if (buffer.trim()) out.push({ file, line: startLine, text: buffer.trim() });
  return out;
}

function evidence(hits: Line[]): string {
  const shown = hits
    .slice(0, 4)
    .map((h) => `${h.file}:${h.line} — ${h.text.slice(0, 80).replace(/\s+/g, " ")}`);
  return `${shown.join("; ")}${hits.length > 4 ? ` +${hits.length - 4} more.` : "."}`;
}

/**
 * The last stage of a multi-stage build is what ships; earlier stages are build tooling that
 * never runs in production. Returns the instructions belonging to the final stage only.
 */
export function finalStage(lines: Line[]): Line[] {
  let lastFrom = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^FROM\s/i.test(lines[i]!.text)) lastFrom = i;
  }
  return lastFrom === -1 ? lines : lines.slice(lastFrom);
}

/** A container with no USER runs as root, so a break-in starts with root in the container. */
export function checkRunsAsRoot(dockerfiles: Record<string, string>, issues: IssueInput[]): void {
  const hits: Line[] = [];
  for (const [file, content] of Object.entries(dockerfiles)) {
    const stage = finalStage(instructions(file, content));
    if (stage.length === 0) continue;
    const user = [...stage].reverse().find((l) => /^USER\s/i.test(l.text));
    // An explicit `USER root` is worse than silence: someone considered it and chose root.
    if (!user) {
      hits.push({ file, line: stage[0]!.line, text: "no USER instruction — defaults to root" });
    } else if (/^USER\s+(root|0)\s*$/i.test(user.text)) {
      hits.push(user);
    }
  }
  if (hits.length === 0) return;

  issues.push({
    category: "Security",
    title: "Container runs as root",
    severity: "medium",
    why: "Without a USER instruction the process runs as root inside the container. Any code execution bug then starts with root rather than having to reach it, and root in the container is the starting point for most container escapes.",
    timeSaved: "30m",
    fixId: "docker-root-user",
    checkedFor: ["USER instruction in the final build stage"],
    foundEvidence: evidence(hits),
    confidence: confidenceFromSignals([
      { kind: "exact_match", detail: hits.map((h) => `${h.file}:${h.line}`).join(", ") },
    ]),
    detection: ["rule-based"],
    recommendedFix:
      "Create an unprivileged user and switch to it before CMD:\n`RUN adduser --system --no-create-home app`\n`USER app`\nMake sure any writable paths the app needs are owned by that user.",
  });
}

/**
 * `ENV`/`ARG` values are baked into the image and readable by anyone who can pull it —
 * `docker history` prints them. A secret placed here is published, not configured.
 */
export function checkBuildTimeSecrets(
  dockerfiles: Record<string, string>,
  issues: IssueInput[],
): void {
  const hits: Line[] = [];
  const SECRET_KEY =
    /^(?:ENV|ARG)\s+.*?\b([A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL)[A-Z0-9_]*)\s*=?\s*(\S+)/i;
  // A bare `ARG NPM_TOKEN` with no value is the correct build-secret pattern, not a leak.
  const PLACEHOLDER = /^(""|''|\$\{|<|change|your|example|placeholder|dummy)/i;

  for (const [file, content] of Object.entries(dockerfiles)) {
    for (const line of instructions(file, content)) {
      const m = SECRET_KEY.exec(line.text);
      if (!m || !m[2] || PLACEHOLDER.test(m[2])) continue;
      hits.push({ ...line, text: `${m[1]} set in ${line.text.split(/\s+/)[0]}` });
    }
  }
  if (hits.length === 0) return;

  issues.push({
    category: "Security",
    title: "Secret baked into the container image",
    severity: "high",
    why: "ENV and ARG values are stored in the image layers. `docker history` prints them back, so anyone who can pull the image can read this value — deleting it in a later layer does not remove it.",
    timeSaved: "1h",
    fixId: "docker-baked-secret",
    checkedFor: ["ENV/ARG names containing SECRET, TOKEN, PASSWORD, API_KEY, PRIVATE_KEY"],
    foundEvidence: evidence(hits),
    confidence: confidenceFromSignals([
      { kind: "exact_match", detail: hits.map((h) => `${h.file}:${h.line}`).join(", ") },
      { kind: "heuristic", detail: "value could still be a non-sensitive default" },
    ]),
    detection: ["rule-based"],
    recommendedFix:
      "Pass secrets at run time (`docker run --env-file`, or your platform's secret store). If one is genuinely needed during the build, use BuildKit secret mounts — `RUN --mount=type=secret,id=npm_token …` — which are not written into a layer.",
  });
}

/**
 * `curl … | sh` runs whatever the server returns today, unverified, at build time. The image is
 * then not reproducible and its contents are decided by a third party.
 */
export function checkPipedInstall(dockerfiles: Record<string, string>, issues: IssueInput[]): void {
  const hits: Line[] = [];
  for (const [file, content] of Object.entries(dockerfiles)) {
    for (const line of instructions(file, content)) {
      if (!/^RUN\s/i.test(line.text)) continue;
      if (/\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z|k)?sh\b/i.test(line.text))
        hits.push(line);
    }
  }
  if (hits.length === 0) return;

  issues.push({
    category: "Security",
    title: "Build pipes a downloaded script straight into a shell",
    severity: "medium",
    why: "Whatever that URL serves at build time is executed with no signature or checksum check. A compromise of that host, or of the network path to it, becomes a compromise of your image — and because the content can change, two builds of the same commit are not the same image.",
    timeSaved: "30m",
    fixId: "docker-piped-install",
    checkedFor: ["RUN instructions piping curl/wget into a shell"],
    foundEvidence: evidence(hits),
    confidence: confidenceFromSignals([
      { kind: "exact_match", detail: hits.map((h) => `${h.file}:${h.line}`).join(", ") },
    ]),
    detection: ["rule-based"],
    recommendedFix:
      "Download to a file, verify a published checksum or signature, then run it. Where the vendor ships a package or a pinned release artifact, prefer that.",
  });
}

/** Every Dockerfile security check, over Dockerfiles the scan already read. */
export function checkContainerSecurity(
  fileContents: Record<string, string>,
  issues: IssueInput[],
): void {
  const dockerfiles = Object.fromEntries(
    Object.entries(fileContents).filter(([path, body]) => isDockerfilePath(path) && body),
  );
  if (Object.keys(dockerfiles).length === 0) return;

  checkRunsAsRoot(dockerfiles, issues);
  checkBuildTimeSecrets(dockerfiles, issues);
  checkPipedInstall(dockerfiles, issues);
}
