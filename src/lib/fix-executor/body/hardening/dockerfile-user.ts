/**
 * Fix for `docker-root-user`: run the final stage as an unprivileged user.
 *
 * Adding `USER` is one line; adding it *without breaking the container* is the whole job. Three
 * things go wrong if you do it naively, and each is handled below:
 *
 *   1. **The user must exist.** `adduser` differs between Alpine and Debian, distroless has no
 *      shell to create one with, and `scratch` cannot have one at all.
 *   2. **The app must still be able to write.** Files copied in are owned by root, so the new
 *      user needs ownership of the working directory or the first write fails at runtime.
 *   3. **Ports below 1024 need root to bind.** That cannot be fixed from the Dockerfile, so it is
 *      reported rather than silently shipped.
 *
 * The parser is the scanner's own (`dockerInstructions` / `dockerFinalStage`), so the fix edits
 * exactly the stage the finding pointed at.
 */

import {
  dockerFinalStage,
  dockerInstructions,
  type DockerInstruction,
} from "../../../scanner/security";

const USER_NAME = "app";

export interface DockerUserResult {
  content: string;
  /** Something the user has to know that the edit could not resolve on its own. */
  warning?: string;
}

/** Which family of base image the final stage ships, since user creation differs per family. */
type ImageFamily = "scratch" | "distroless" | "node" | "alpine" | "debian";

export function baseImageFamily(fromLine: string): ImageFamily {
  const image = (fromLine.replace(/^FROM\s+/i, "").split(/\s+/)[0] ?? "").toLowerCase();
  if (/^scratch$/.test(image)) return "scratch";
  if (image.includes("distroless")) return "distroless";
  if (image.includes("alpine")) return "alpine";
  // Official Node images already ship an unprivileged `node` user (uid 1000). Reusing it is the
  // idiomatic fix and avoids depending on `useradd` existing in the variant.
  if (/(^|\/)node:/.test(image)) return "node";
  return "debian";
}

function createUserCommand(family: ImageFamily, workdir: string | null): string[] {
  const chown =
    workdir === null
      ? null
      : `chown -R ${family === "node" ? "node:node" : `${USER_NAME}:${USER_NAME}`} ${workdir}`;

  if (family === "distroless") return ["USER nonroot:nonroot"];
  if (family === "node") {
    return [
      ...(chown ? [`RUN ${chown}`] : []),
      "# The official Node image already ships an unprivileged `node` user.",
      "USER node",
    ];
  }

  const create =
    family === "alpine"
      ? `addgroup -S ${USER_NAME} && adduser -S -G ${USER_NAME} ${USER_NAME}`
      : `groupadd --system ${USER_NAME} && useradd --system --gid ${USER_NAME} --no-create-home ${USER_NAME}`;

  return [`RUN ${chown ? `${create} \\\n && ${chown}` : create}`, `USER ${USER_NAME}`];
}

/** The last WORKDIR of the final stage — what the app is most likely to write into. */
function finalWorkdir(stage: DockerInstruction[]): string | null {
  const workdirs = stage.filter((l) => /^WORKDIR\s/i.test(l.text));
  const last = workdirs[workdirs.length - 1];
  if (!last) return null;
  const dir = last.text
    .replace(/^WORKDIR\s+/i, "")
    .trim()
    .replace(/^["']|["']$/g, "");
  // A relative WORKDIR depends on the base image's own default, which we cannot read.
  return dir.startsWith("/") ? dir : null;
}

function privilegedPort(stage: DockerInstruction[]): number | null {
  for (const l of stage) {
    if (!/^EXPOSE\s/i.test(l.text)) continue;
    for (const tok of l.text.replace(/^EXPOSE\s+/i, "").split(/\s+/)) {
      const port = Number.parseInt(tok.split("/")[0] ?? "", 10);
      if (Number.isFinite(port) && port > 0 && port < 1024) return port;
    }
  }
  return null;
}

/**
 * Insert an unprivileged `USER` into the final stage.
 *
 * Returns `null` when the file already runs as a non-root user (nothing to do) or when the base
 * image cannot host one.
 */
export function addNonRootUser(file: string, content: string): DockerUserResult | null {
  const all = dockerInstructions(file, content);
  const stage = dockerFinalStage(all);
  if (stage.length === 0) return null;

  const existingUser = [...stage].reverse().find((l) => /^USER\s/i.test(l.text));
  const explicitRoot = existingUser && /^USER\s+(root|0)\s*$/i.test(existingUser.text);
  if (existingUser && !explicitRoot) return null;

  const from = stage.find((l) => /^FROM\s/i.test(l.text));
  const family = baseImageFamily(from?.text ?? "");
  if (family === "scratch") {
    return null;
  }

  const workdir = finalWorkdir(stage);
  const block = createUserCommand(family, workdir);

  const lines = content.split(/\r?\n/);
  const eol = content.includes("\r\n") ? "\r\n" : "\n";

  // `USER root` is a decision to undo in place; anything else is inserted just above the command
  // that starts the process, which is after every RUN that still needs root.
  let insertAt: number;
  let removeCount = 0;
  if (explicitRoot) {
    insertAt = existingUser!.line - 1;
    removeCount = 1;
  } else {
    const entry = stage.find((l) => /^(CMD|ENTRYPOINT)\s/i.test(l.text));
    insertAt = entry ? entry.line - 1 : lines.length;
  }

  lines.splice(insertAt, removeCount, ...block);

  const port = privilegedPort(stage);
  return {
    content: lines.join(eol),
    warning:
      port === null
        ? undefined
        : `${file} exposes port ${port}. A non-root process cannot bind a port below 1024 — change the app to listen on a port above 1024 and update EXPOSE, or the container will fail to start.`,
  };
}
