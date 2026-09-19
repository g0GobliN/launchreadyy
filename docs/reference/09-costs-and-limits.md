# 9. Costs and limits

LaunchReadyy Community does not impose product-level repository, scan, or remediation limits.
The installation uses infrastructure and API keys supplied by its operator.

| Provider | Required | Limit or cost owner |
| -------- | -------- | ------------------- |
| GitHub | For repository operations | GitHub API and account limits |
| E2B | No | E2B sandbox usage and concurrency |
| AI provider | No | The configured provider's token usage and rate limits |

`SANDBOX_MAX_CONCURRENT` limits simultaneous verification runs so the installation cannot start
more work than the operator intends. See [§12](12-sandbox.md).
