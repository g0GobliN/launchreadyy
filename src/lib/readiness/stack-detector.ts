import type { DetectedStack } from "./types";

export function detectStack(
  deps: Record<string, string>,
  files: string[],
  framework: string,
): DetectedStack {
  const frameworks = new Set<string>();
  if (framework !== "unknown") frameworks.add(framework);
  if (deps["react"]) frameworks.add("React");
  if (deps["vite"]) frameworks.add("Vite");
  if (deps["next"]) frameworks.add("Next.js");
  if (deps["express"]) frameworks.add("Express");
  if (deps["@tanstack/react-router"]) frameworks.add("TanStack Router");
  if (
    deps["tailwindcss"] ||
    files.some((f) => f.endsWith("tailwind.config.ts") || f.endsWith("tailwind.config.js"))
  )
    frameworks.add("Tailwind");

  const services = new Set<string>();
  if (deps["stripe"]) services.add("Stripe");
  if (deps["@prisma/client"] || deps["prisma"]) services.add("Prisma");
  if (deps["@supabase/supabase-js"] || files.some((f) => f.includes("supabase")))
    services.add("Supabase");
  if (deps["firebase"] || deps["firebase-admin"] || files.some((f) => f.includes("firebase")))
    services.add("Firebase");
  if (deps["next-auth"] || deps["@clerk/nextjs"]) services.add("Auth");
  if (deps["@sentry/nextjs"] || deps["@sentry/react"] || deps["@sentry/node"])
    services.add("Sentry");

  const deployTargets = new Set<string>();
  if (files.some((f) => f === "vercel.json" || f.includes(".vercel"))) deployTargets.add("Vercel");
  if (files.some((f) => f === "railway.json" || f === "railway.toml")) deployTargets.add("Railway");
  if (files.some((f) => f === "render.yaml")) deployTargets.add("Render");
  if (files.some((f) => f === "netlify.toml")) deployTargets.add("Netlify");
  if (files.some((f) => f === "fly.toml")) deployTargets.add("Fly.io");
  if (files.some((f) => f === "wrangler.toml")) deployTargets.add("Cloudflare");
  if (files.some((f) => f === "Procfile")) deployTargets.add("Heroku/Procfile");
  if (files.some((f) => f === "Dockerfile" || f.startsWith("docker-compose")))
    deployTargets.add("Docker");
  if (files.some((f) => f.startsWith(".github/workflows/"))) deployTargets.add("GitHub Actions");

  const profile = inferProfile([...frameworks], [...services]);

  return {
    frameworks: [...frameworks],
    services: [...services],
    deployTargets: [...deployTargets],
    profile,
  };
}

/**
 * Every non-Node stack the scanner detects, mapped to the label the report shows. Without these
 * a Python or Go repo fell through to "General Node" — a confident, wrong sentence about the
 * reader's own project, which is the fastest way to lose them on the first screen.
 */
const NON_NODE_PROFILE: Record<string, string> = {
  Python: "Python service",
  Go: "Go service",
  Rust: "Rust service",
  Ruby: "Ruby app",
  PHP: "PHP app",
  Java: "Java service",
  Kotlin: "Kotlin service",
  "C#": ".NET service",
  Elixir: "Elixir app",
  Swift: "Swift app",
};

function inferProfile(frameworks: string[], services: string[]): string {
  if (frameworks.includes("Next.js") && services.includes("Stripe")) return "Next.js + Stripe";
  if (frameworks.includes("Next.js")) return "Next.js App";
  if (frameworks.includes("Express")) return "Express API";
  if (frameworks.includes("Vite") || frameworks.includes("React")) return "React SPA";
  for (const f of frameworks) {
    const label = NON_NODE_PROFILE[f];
    if (label) return label;
  }
  // Only reached when a Node manifest was found but no framework in it — not a guess about
  // a language we never saw.
  return "General Node";
}
