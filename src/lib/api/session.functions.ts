import { createServerFn } from "@tanstack/react-start";
import { getLocalUser } from "../github-token.server";

/**
 * The local operator.
 *
 * Pages that used to ask "who is signed in" — there is no sign-in any more —
 * now just ask who runs this installation. This always answers.
 */
export const getSessionUserFn = createServerFn({ method: "GET" }).handler(async () => {
  return getLocalUser();
});

/**
 * Which optional vendors this installation has configured.
 *
 * Booleans only — a settings page has no business reading secrets, and the
 * browser has no business receiving them.
 */
export const getInstallationStatusFn = createServerFn({ method: "GET" }).handler(async () => {
  const present = (...names: string[]) => names.some((n) => Boolean(process.env[n]?.trim()));
  return {
    login: getLocalUser().login,
    github: present("GITHUB_TOKEN"),
    aiProvider: process.env.AI_PROVIDER?.trim() || "",
    ai: present(
      "DEEPSEEK_API_KEY",
      "ANTHROPIC_API_KEY",
      "CLAUDE_API_KEY",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "CURSOR_API_KEY",
    ),
    sandbox: present("E2B_API_KEY"),
    database: true,
  };
});
