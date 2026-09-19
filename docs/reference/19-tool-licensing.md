# 19. Third-party tool licensing

LaunchReadyy Community is distributed under Apache-2.0 and is designed to run on infrastructure
controlled by its operator. Third-party tools, rules, and data must have terms compatible with
source distribution and self-hosted execution.

## Review policy

Review the engine, rule set, vulnerability data, and any downloaded assets separately. They may
use different licenses. Prefer dependencies that operators may install and run without obtaining
an additional commercial agreement.

| License class | General policy |
| ------------- | -------------- |
| MIT, Apache-2.0, BSD | Allowed; preserve required notices |
| LGPL-2.1, MPL-2.0 | Review how the component is distributed and modified |
| GPL-3.0 | Review distribution and process-boundary obligations before adoption |
| AGPL-3.0 | Avoid for application-integrated services unless obligations are explicitly accepted |
| Field-of-use or service restrictions | Do not bundle or enable by default without terms covering Community's use |

Apache-2.0 dependencies are preferred when practical because the license includes an explicit
patent grant.

## Tools suitable for optional execution

These tools have permissive engine licenses. Their notices and any separately licensed rule or
data packages still need review when added to a distributed image or installer.

| Tool | License | Role |
| ---- | ------- | ---- |
| osv-scanner | Apache-2.0 | Dependency vulnerability scanning |
| Trivy | Apache-2.0 | Container and infrastructure configuration scanning |
| Gitleaks | MIT | Secret detection |
| Zizmor | MIT | GitHub Actions workflow security |
| actionlint | MIT | GitHub Actions correctness |
| Opengrep | LGPL-2.1 | Semgrep-compatible analysis engine |

Community currently performs its core dependency, secret, workflow, container, and code-pattern
checks with repository-owned rules. This keeps the default scan available on every installation
without requiring separately licensed rule packs or scanner binaries.

## Restricted rule sets and tools

**Semgrep registry rule packs.** The Semgrep engine and registry rules have separate terms. Packs
such as `p/default`, `p/secrets`, and `p/github-actions` use the
[Semgrep Rules License v1.0](https://semgrep.dev/legal/rules-license/), which limits permitted use.
Do not add registry packs to Community without confirming that their current terms cover source
distribution and the operator's intended use. Opengrep does not change the license of rules fed
to it, and `opengrep-rules` has its own Commons Clause restrictions.

**CodeQL.** GitHub's CodeQL CLI has use restrictions beyond an ordinary open-source license,
particularly for private repositories. Community must not assume that every operator has a
GitHub Advanced Security license. Keep CodeQL out of the default installation unless its terms
and the operator's license are checked explicitly.

**TruffleHog.** TruffleHog uses AGPL-3.0. Community does not bundle it. Provider-specific live
credential checks should use small, auditable integrations with the provider's identity endpoint
instead.

## Repository-owned security coverage

The default scanner includes:

1. Lockfile parsing and OSV queries for supported package ecosystems.
2. Whole-repository secret patterns.
3. GitHub Actions checks for injection, unsafe `pull_request_target` use, broad permissions, and
   unpinned third-party actions.
4. Dockerfile checks for root containers, secrets in layers, and piped installers.
5. Context-aware code-pattern checks for unsafe TLS, weak credential cryptography, predictable
   security tokens, path traversal, open redirects, and NoSQL injection.

Rules should identify the dangerous context, not merely an API name. For example, MD5 can be
appropriate for an ETag but not password storage, and random values used for animation are not
security tokens. Every new rule needs focused tests for both findings and common false positives.

## Distribution obligations

- Keep the repository's Apache-2.0 `LICENSE` file and required attribution notices.
- Preserve third-party copyright and license notices when distributing dependencies or binaries.
- Record separately licensed rules, model files, vulnerability data, and downloaded assets.
- Re-check terms before upgrading a tool whose licensing is not a standard SPDX license.

This chapter is engineering guidance, not legal advice. Operators distributing modified builds
should review the licenses of the exact dependencies and assets they ship.
