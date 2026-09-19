export const HELMET_MIDDLEWARE_EXPRESS = `import helmet from "helmet";
import type { Express } from "express";

export function applyHelmet(app: Express): void {
  app.use(helmet());
}
`;

export const RATE_LIMIT_MIDDLEWARE_EXPRESS = `import rateLimit from "express-rate-limit";
import type { Express } from "express";

export const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

export function applyRateLimit(app: Express): void {
  app.use(limiter);
}
`;

export const CORS_EXPRESS = `import cors from "cors";
import type { Express } from "express";

export const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());

export function applyCors(app: Express): void {
  app.use(
    cors({
      origin: allowedOrigins.includes("*") ? true : allowedOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      optionsSuccessStatus: 204,
    }),
  );
}
`;

export const WINSTON_LOGGER = `import winston from "winston";

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [new winston.transports.Console()],
});
`;

export const REQUEST_LOGGER_MIDDLEWARE = `import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on("finish", () => {
    logger.info("request", {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      ms: Date.now() - start,
    });
  });
  next();
}
`;

export const HEALTH_CHECK_EXPRESS = `
app.get("/health", (_req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});
`;

export const COOKIE_FLAGS_MIDDLEWARE_EXPRESS = `import type { Express, Request, Response, NextFunction } from "express";

function fixCookieAttributes(cookie: string): string {
  const attrs = cookie
    .split(";")
    .slice(1)
    .map((p) => p.trim().toLowerCase());
  let result = cookie;
  if (!attrs.includes("httponly")) result += "; HttpOnly";
  if (!attrs.includes("secure")) result += "; Secure";
  if (!attrs.some((a) => a.startsWith("samesite"))) result += "; SameSite=Lax";
  return result;
}

/** Patches res.writeHead so any Set-Cookie header gets missing Secure/HttpOnly/SameSite attributes. */
export function secureCookies(_req: Request, res: Response, next: NextFunction) {
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
    const existing = res.getHeader("Set-Cookie");
    if (existing) {
      const cookies = Array.isArray(existing) ? existing : [String(existing)];
      res.setHeader("Set-Cookie", cookies.map(fixCookieAttributes));
    }
    return originalWriteHead(...args);
  }) as typeof res.writeHead;
  next();
}

export function applySecureCookies(app: Express): void {
  app.use(secureCookies);
}
`;

export const HTTPS_REDIRECT_MIDDLEWARE_EXPRESS = `import type { Express, Request, Response, NextFunction } from "express";

function isHttps(req: Request): boolean {
  const forwarded = req.headers["x-forwarded-proto"];
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(",")[0].trim();
    return first.toLowerCase() === "https";
  }
  return req.secure;
}

export function httpsRedirect(req: Request, res: Response, next: NextFunction) {
  if (isHttps(req)) return next();
  res.redirect(301, "https://" + req.headers.host + req.originalUrl);
}

export function applyHttpsRedirect(app: Express): void {
  app.use(httpsRedirect);
}
`;

export const SENTRY_INIT_NODE = `import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? "production",
  tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
  integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()],
});

export const { setupExpressErrorHandler } = Sentry;
`;

/** Double-submit-cookie CSRF for Express, via `csrf-csrf`.
 *
 * `csurf` is deprecated and unmaintained — the scanner's own `checkedFor` list names `csrf-csrf`
 * and "double-submit cookie patterns", so this matches what the check looks for.
 *
 * Deliberately NOT auto-wired into the app. Unlike helmet or a rate limiter, turning CSRF on is a
 * breaking change: every existing state-changing request starts failing until the client sends the
 * token back. Auto-applying it would hand the user a PR that green-lights the finding and takes
 * their app down. The generated file is complete and ready; the handler tells them the two lines
 * to add and the header the frontend must send. */
export const CSRF_MIDDLEWARE_EXPRESS = `import { doubleCsrf } from "csrf-csrf";
import cookieParser from "cookie-parser";
import type { Express, RequestHandler } from "express";

const { doubleCsrfProtection, generateCsrfToken } = doubleCsrf({
  // Must be set, and must not be the session secret.
  getSecret: () => process.env.CSRF_SECRET ?? "",
  getSessionIdentifier: (req) => req.ip ?? "",
  cookieName: process.env.NODE_ENV === "production" ? "__Host-psifi.x-csrf-token" : "x-csrf-token",
  cookieOptions: {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
  },
  // Safe methods are exempt; everything else must present a matching token.
  ignoredMethods: ["GET", "HEAD", "OPTIONS"],
  getCsrfTokenFromRequest: (req) => req.headers["x-csrf-token"],
});

/** Hand the browser a token to echo back in the \`x-csrf-token\` header. */
export const csrfTokenRoute: RequestHandler = (req, res) => {
  res.json({ csrfToken: generateCsrfToken(req, res) });
};

/**
 * Enable CSRF protection.
 *
 * This is a breaking change for existing clients: after enabling, every non-GET request must send
 * the token from GET /csrf-token in the \`x-csrf-token\` header. Roll it out with the frontend.
 */
export function applyCsrf(app: Express): void {
  if (!process.env.CSRF_SECRET) {
    throw new Error("CSRF_SECRET is not set — refusing to start with CSRF misconfigured");
  }
  app.use(cookieParser());
  app.get("/csrf-token", csrfTokenRoute);
  app.use(doubleCsrfProtection);
}
`;
