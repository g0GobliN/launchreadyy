import { describe, expect, it } from "vitest";
import { CORS_PYTHON } from "./languages/python/templates";
import { CORS_FETCH } from "./fetch-runtime/security";

/**
 * The `cors` fix tool exists to remove a CORS weakness, so its output must not introduce one.
 * LaunchReadyy's own scanner tells users to "avoid Access-Control-Allow-Origin: * on credentialed
 * APIs" (scanner/security/cors.ts) — generating exactly that would have the product contradict its
 * own advice inside the user's repository.
 */
describe("generated CORS templates", () => {
  describe("FastAPI", () => {
    /**
     * Regression: this shipped `allow_origins=["*"]` together with `allow_credentials=True`, and
     * ALLOWED_ORIGINS defaults to "*", so the default path produced it. A browser refuses
     * `Access-Control-Allow-Origin: *` alongside credentials, so Starlette echoes the caller's
     * origin back instead — letting any site make credentialed cross-origin requests.
     */
    it("never pairs a wildcard origin with credentials", () => {
      expect(CORS_PYTHON).not.toContain("allow_credentials=True");
      expect(CORS_PYTHON).toContain("allow_credentials=not wildcard");
    });

    it("still allows credentials once real origins are configured", () => {
      // The non-wildcard branch passes the configured list through.
      expect(CORS_PYTHON).toContain('allow_origins=["*"] if wildcard else ALLOWED_ORIGINS');
    });

    it("explains why credentials are gated, so the choice is not silently reverted", () => {
      expect(CORS_PYTHON).toMatch(/wildcard origin/i);
      expect(CORS_PYTHON).toMatch(/ALLOWED_ORIGINS/);
    });
  });

  describe("every template that emits an allow-origin header", () => {
    const templates: [string, string][] = [
      ["python", CORS_PYTHON],
      ["fetch runtime", CORS_FETCH],
    ];

    it.each(templates)("%s does not enable credentials alongside a wildcard", (_name, source) => {
      const enablesCredentials =
        /allow_credentials\s*=\s*True/.test(source) ||
        /Access-Control-Allow-Credentials["']?\s*[:=]\s*["']true["']/i.test(source) ||
        /credentials:\s*true/.test(source);
      if (!enablesCredentials) return;

      // If a template does enable credentials, it must not also be able to emit "*".
      expect(source).not.toMatch(/["']\*["']/);
    });
  });
});
