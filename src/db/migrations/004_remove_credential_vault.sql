-- Community reads the operator-owned GitHub token from local configuration only.
UPDATE background_jobs
SET payload = json_remove(payload, '$.sealedGitHubToken')
WHERE json_type(payload, '$.sealedGitHubToken') IS NOT NULL;

DROP TABLE IF EXISTS github_credentials;
