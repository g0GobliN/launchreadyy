import { ESLINT_CONFIG } from "../eslint/config";
import { PRETTIER_RC, PRETTIER_IGNORE } from "../prettier/config";
import { DEFAULT_PLAYWRIGHT_CONFIG } from "../playwright/config";
import { E2E_HOME_SPEC } from "../playwright/e2e";
import { SMOKE_TEST } from "../vitest/smoke-test";
import {
  HELMET_MIDDLEWARE_EXPRESS,
  RATE_LIMIT_MIDDLEWARE_EXPRESS,
  CORS_EXPRESS,
  WINSTON_LOGGER,
  REQUEST_LOGGER_MIDDLEWARE,
} from "../express/middleware";
import { SECURITY_HEADERS_FETCH, RATE_LIMITER_FETCH, CORS_FETCH } from "../fetch-runtime/security";
import { ERROR_BOUNDARY_TSX } from "../react/error-boundary";
import { SENTRY_INIT } from "../react/sentry";
import { DOCKER_IGNORE } from "../node/docker";

/** Exported for generator unit tests — static fix template snippets. */
export const FIX_GENERATOR_TEMPLATES = {
  eslint: ESLINT_CONFIG,
  prettierRc: PRETTIER_RC,
  prettierIgnore: PRETTIER_IGNORE,
  playwright: DEFAULT_PLAYWRIGHT_CONFIG,
  smokeTest: SMOKE_TEST,
  e2eHome: E2E_HOME_SPEC,
  helmet: HELMET_MIDDLEWARE_EXPRESS,
  helmetFetch: SECURITY_HEADERS_FETCH,
  rateLimit: RATE_LIMIT_MIDDLEWARE_EXPRESS,
  rateLimitFetch: RATE_LIMITER_FETCH,
  cors: CORS_FETCH,
  corsExpress: CORS_EXPRESS,
  logger: WINSTON_LOGGER,
  requestLogger: REQUEST_LOGGER_MIDDLEWARE,
  errorBoundary: ERROR_BOUNDARY_TSX,
  dockerIgnore: DOCKER_IGNORE,
  sentryReact: SENTRY_INIT,
} as const;
