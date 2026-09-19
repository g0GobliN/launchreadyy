import { execSync } from "child_process";
import { existsSync, accessSync, constants } from "fs";
import { join } from "path";

// Always invoked from the project root — see PROJECT_ROOT comment in commands/doctor.ts.
const PROJECT_ROOT = process.cwd();

export interface EnvironmentCheck {
  name: string;
  status: "ok" | "warning" | "error" | "optional";
  message: string;
  fix?: string;
}

export interface EnvironmentResult {
  checks: EnvironmentCheck[];
  hasErrors: boolean;
  hasWarnings: boolean;
}

function getNodeVersion(): string {
  return process.version;
}

function checkNodeVersion(): EnvironmentCheck {
  const version = getNodeVersion();
  const major = parseInt(version.slice(1).split(".")[0], 10);

  // Supported: ^20.19.0 || >=22.13.0
  const supported =
    (major === 20 && parseFloat(version.slice(1).split(".").slice(1).join(".")) >= 19) ||
    major >= 22;

  if (supported) {
    return {
      name: "Node.js",
      status: "ok",
      message: `${version}`,
    };
  }

  return {
    name: "Node.js",
    status: "error",
    message: `${version} (unsupported)`,
    fix: "Install Node.js 20.19+ or 22.13+ from https://nodejs.org",
  };
}

function checkGit(): EnvironmentCheck {
  try {
    const version = execSync("git --version", { encoding: "utf-8", stdio: "pipe" }).trim();
    return {
      name: "Git",
      status: "ok",
      message: version,
    };
  } catch {
    return {
      name: "Git",
      status: "error",
      message: "not found",
      fix: "Install Git from https://git-scm.com",
    };
  }
}

function checkProjectDirectory(): EnvironmentCheck {
  const packageJson = join(PROJECT_ROOT, "package.json");
  if (existsSync(packageJson)) {
    return {
      name: "Project directory",
      status: "ok",
      message: "Valid LaunchReadyy project",
    };
  }
  return {
    name: "Project directory",
    status: "error",
    message: "Not a LaunchReadyy project (package.json not found)",
    fix: "Run this command from the LaunchReadyy project root",
  };
}

function checkDataDirectory(): EnvironmentCheck {
  const dataDir = join(PROJECT_ROOT, "data");
  try {
    accessSync(PROJECT_ROOT, constants.W_OK);
    return {
      name: "Data directory",
      status: "ok",
      message: "Writable",
    };
  } catch {
    return {
      name: "Data directory",
      status: "error",
      message: "Not writable",
      fix: "Ensure the project directory is writable by the current user",
    };
  }
}

function checkPackageManager(): EnvironmentCheck {
  // Check for npm (comes with Node.js)
  try {
    const version = execSync("npm --version", { encoding: "utf-8", stdio: "pipe" }).trim();
    return {
      name: "npm",
      status: "ok",
      message: `v${version}`,
    };
  } catch {
    return {
      name: "npm",
      status: "warning",
      message: "not available",
      fix: "npm should come with Node.js installation",
    };
  }
}

export function runEnvironmentChecks(): EnvironmentResult {
  const checks: EnvironmentCheck[] = [
    checkNodeVersion(),
    checkGit(),
    checkProjectDirectory(),
    checkDataDirectory(),
    checkPackageManager(),
  ];

  const hasErrors = checks.some((c) => c.status === "error");
  const hasWarnings = checks.some((c) => c.status === "warning");

  return { checks, hasErrors, hasWarnings };
}

export function formatCheck(check: EnvironmentCheck): string {
  const icons = {
    ok: "✓",
    warning: "⚠",
    error: "✗",
    optional: "○",
  };

  const icon = icons[check.status];
  let line = `${icon} ${check.name}: ${check.message}`;

  if (check.fix) {
    line += `\n   Fix: ${check.fix}`;
  }

  return line;
}
