import { PYTHON_ENTRYPOINT_EXCLUDE, PYTHON_APP_ASSIGNMENT } from "../../shared/constants";

export function dockerfilePython(
  filePaths: string[],
  requirementsText: string,
  getContent?: (path: string) => string | undefined,
): string {
  const isDjango = filePaths.includes("manage.py");
  const isAsgi = /fastapi|starlette|\basgi\b/i.test(requirementsText);
  const entry = pythonEntrypoint(filePaths, getContent);
  const target = `${entry.module}:${entry.varName}`;
  const startCmd = isDjango
    ? '["python", "manage.py", "runserver", "0.0.0.0:8000"]'
    : isAsgi
      ? `["python", "-m", "uvicorn", "${target}", "--host", "0.0.0.0", "--port", "8000"]`
      : `["python", "-m", "gunicorn", "${target}", "--bind", "0.0.0.0:8000", "--workers", "2"]`;
  // gunicorn/uvicorn are the runtime servers CMD depends on — install them explicitly rather
  // than trusting requirements.txt to list them, since plenty of real projects run `python
  // main.py` locally (uvicorn.run() inline) and never add a WSGI/ASGI server as a dependency.
  const serverInstall = isDjango ? "" : "\nRUN pip install --no-cache-dir gunicorn uvicorn";
  // Some real projects (confirmed in testing) put the entrypoint in a subdirectory and import
  // its siblings as flat top-level modules (`from config import settings` inside
  // application/main.py, not `from application.config import ...`) — that only resolves if the
  // subdirectory itself is on the path, not just /app. Add it so both import styles work.
  const entryDir = entry.module.includes(".")
    ? entry.module.split(".").slice(0, -1).join("/")
    : null;
  const pythonPathEnv = entryDir ? `ENV PYTHONPATH=/app:/app/${entryDir}\n` : "";
  const hasRequirements = filePaths.includes("requirements.txt");
  const hasPyproject = filePaths.includes("pyproject.toml");
  const hasPoetry = filePaths.includes("poetry.lock");
  // asyncpg/psycopg compile against libpq — confirmed against nsidnev/fastapi-realworld-example-app.
  const needsLibpq = /asyncpg|psycopg|postgres/i.test(requirementsText);
  const aptPkgs = [
    "build-essential",
    "libffi-dev",
    "libssl-dev",
    ...(needsLibpq || hasPoetry ? ["libpq-dev"] : []),
  ].join(" ");

  // Confirmed by testing: the previous `2>/dev/null || ... || true` chain hid a real failure
  // (cffi/cryptography needing to compile from source with no gcc on python-slim) behind a
  // "successful" build — the runtime image silently shipped without half its dependencies, only
  // surfacing as ModuleNotFoundError when the container actually started. Install gcc so
  // packages that need to compile actually can, and let a real install failure fail the build
  // instead of masking it.
  //
  // Poetry projects (poetry.lock): use poetry install — `pip install .` against a poetry
  // build-backend without the package source present fails (confirmed: fastapi-realworld).
  // Plain pyproject: copy source before `pip install .` so the package itself is installable.
  let installBlock: string;
  if (hasPoetry) {
    installBlock = `COPY pyproject.toml poetry.lock* ./
COPY . .
RUN pip install --no-cache-dir "poetry==1.8.3" \\
 && poetry config virtualenvs.create false \\
 && poetry install --only main --no-interaction --no-ansi${serverInstall}`;
  } else if (hasRequirements) {
    installBlock = `COPY requirements*.txt pyproject.toml* ./
RUN pip install --no-cache-dir -r requirements.txt${serverInstall}
COPY . .`;
  } else if (hasPyproject) {
    installBlock = `COPY pyproject.toml ./
COPY . .
RUN pip install --no-cache-dir ".[prod]" || pip install --no-cache-dir .${serverInstall}`;
  } else {
    installBlock = `COPY . .
RUN true${serverInstall}`;
  }

  // Poetry lockfiles often pin C-extension wheels (e.g. greenlet 1.1.x) that do not build on
  // modern CPython — confirmed against nsidnev/fastapi-realworld-example-app (needs 3.9, same as
  // that repo's own Dockerfile). Prefer 3.9 for poetry; keep 3.12 for requirements.txt projects.
  const pythonImage = hasPoetry ? "python:3.9-slim" : "python:3.12-slim";
  const sitePackages = hasPoetry
    ? "/usr/local/lib/python3.9/site-packages"
    : "/usr/local/lib/python3.12/site-packages";

  return `FROM ${pythonImage} AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ${aptPkgs} && rm -rf /var/lib/apt/lists/*
${installBlock}

FROM ${pythonImage} AS runner
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
${pythonPathEnv}RUN groupadd --system app && useradd --system --gid app --no-create-home app
COPY --from=build ${sitePackages} ${sitePackages}
COPY --from=build /usr/local/bin /usr/local/bin
COPY . .
USER app
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://localhost:8000/health || exit 1
CMD ${startCmd}
`;
}

export function findPythonEntrypoint(
  filePaths: string[],
  getContent: (path: string) => string | undefined,
): { path: string; module: string; varName: string } | null {
  const candidates = filePaths
    .filter((p) => p.endsWith(".py") && !PYTHON_ENTRYPOINT_EXCLUDE.test(p))
    .sort((a, b) => a.split("/").length - b.split("/").length);

  for (const path of candidates) {
    const content = getContent(path);
    if (!content) continue;
    const match = content.match(PYTHON_APP_ASSIGNMENT);
    if (match) {
      return { path, module: path.replace(/\.py$/, "").replace(/\//g, "."), varName: match[1] };
    }
  }
  return null;
}

export function pythonEntrypointModule(filePaths: string[]): string | null {
  const candidates = [
    "app/main.py",
    "application/main.py",
    "src/main.py",
    "backend/main.py",
    "backend/app/main.py",
    "main.py",
    "app.py",
    "src/app.py",
    "wsgi.py",
    "asgi.py",
    "server.py",
  ];
  const found = candidates.find((c) => filePaths.includes(c));
  return found ? found.replace(/\.py$/, "").replace(/\//g, ".") : null;
}

export function pythonEntrypoint(
  filePaths: string[],
  getContent?: (path: string) => string | undefined,
): { module: string; varName: string } {
  const found = getContent ? findPythonEntrypoint(filePaths, getContent) : null;
  if (found) return found;
  // Fell back to path-guessing — either no getContent was supplied (caller has no snapshot
  // access) or content search found no FastAPI/Flask/Sanic/Bottle assignment (e.g. a framework
  // not in that list, or the snapshot omitted the file for being >1MB).
  return { module: pythonEntrypointModule(filePaths) ?? "app", varName: "app" };
}
