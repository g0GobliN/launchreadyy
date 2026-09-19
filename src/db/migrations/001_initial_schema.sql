-- LaunchReadyy Community — initial SQLite schema.
-- Generated from the schema this application has been running against.

-- Core entities
CREATE TABLE IF NOT EXISTS repos (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  full_name      TEXT NOT NULL,
  description    TEXT,
  language       TEXT NOT NULL DEFAULT 'unknown',
  stars          INTEGER NOT NULL DEFAULT 0,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  private        INTEGER NOT NULL DEFAULT 0,
  framework      TEXT NOT NULL DEFAULT 'unknown',
  owner          TEXT,
  default_branch TEXT
);

CREATE TABLE IF NOT EXISTS scans (
  id         TEXT PRIMARY KEY,
  repo_id    TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  score      INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  warnings   TEXT,
  category_scores TEXT,
  stack_detected  TEXT,
  checklist       TEXT,
  launch_target   TEXT,
  launch_timeline TEXT,
  file_hashes     TEXT,
  git_sha         TEXT,
  dependency_graph TEXT,
  source          TEXT NOT NULL DEFAULT 'github',
  trigger         TEXT NOT NULL DEFAULT 'manual'
);

CREATE TABLE IF NOT EXISTS issues (
  id                  TEXT PRIMARY KEY,
  scan_id             TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  category            TEXT NOT NULL,
  title               TEXT NOT NULL,
  severity            TEXT NOT NULL,
  why                 TEXT NOT NULL,
  time_saved          TEXT NOT NULL,
  fix_id              TEXT NOT NULL,
  risk_level          TEXT,
  business_impact     TEXT,
  production_scenario TEXT,
  affected_audience   TEXT,
  fix_difficulty      TEXT,
  priority            INTEGER,
  auto_fixable        INTEGER,
  source              TEXT,
  readiness_category  TEXT,
  fix_pack_id         TEXT,
  checked_for         TEXT,
  found_evidence      TEXT,
  confidence          TEXT,
  recommended_fix     TEXT,
  ai_credit_cost      INTEGER,
  detection           TEXT,
  verified_at         TEXT,
  fingerprint         TEXT
);

CREATE TABLE IF NOT EXISTS fix_requests (
  id                  TEXT PRIMARY KEY,
  repo_id             TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  scan_id             TEXT NOT NULL,
  fixes               TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending',
  branch_name         TEXT NOT NULL,
  pr_number           INTEGER,
  pr_url              TEXT,
  error_message       TEXT,
  est_files_added     INTEGER NOT NULL DEFAULT 0,
  est_files_changed   INTEGER NOT NULL DEFAULT 0,
  est_deps            INTEGER NOT NULL DEFAULT 0,
  credits_cost        INTEGER NOT NULL DEFAULT 0,
  owner_login         TEXT,
  ai_files            TEXT,
  generated_file_hashes TEXT,
  pending_files       TEXT,
  pending_verification_notes TEXT,
  pending_ai_files    TEXT,
  regenerate_feedback TEXT,
  regenerate_count    INTEGER NOT NULL DEFAULT 0,
  agent_reasoning     TEXT,
  priority            INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fix_recoveries (
  id               TEXT PRIMARY KEY,
  fix_request_id   TEXT NOT NULL REFERENCES fix_requests(id) ON DELETE CASCADE,
  user_login       TEXT NOT NULL,
  error_log        TEXT NOT NULL,
  error_signature  TEXT NOT NULL,
  tier             INTEGER NOT NULL,
  drift_level      TEXT NOT NULL,
  resolution_type  TEXT NOT NULL,
  patch_pr_url     TEXT,
  patch_path       TEXT,
  patch_content    TEXT,
  attempt_count    INTEGER NOT NULL DEFAULT 1,
  credits_used     INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS arch_scans (
  id           TEXT PRIMARY KEY,
  repo_id      TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  score        INTEGER NOT NULL,
  findings     TEXT NOT NULL DEFAULT '[]',
  scanned_files INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fix_cache (
  id         TEXT PRIMARY KEY,
  repo_id    TEXT NOT NULL,
  fix_ids    TEXT NOT NULL,
  framework  TEXT NOT NULL DEFAULT 'unknown',
  files_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (repo_id, fix_ids)
);

CREATE TABLE IF NOT EXISTS launch_reports (
  id           TEXT PRIMARY KEY,
  share_token  TEXT NOT NULL UNIQUE,
  repo_id      TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  scan_id      TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  owner_login  TEXT NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS risk_acceptances (
  id         TEXT PRIMARY KEY,
  repo_id    TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  fix_id     TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  reason_type TEXT NOT NULL,
  note       TEXT,
  accepted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS feedback (
  id             TEXT PRIMARY KEY,
  github_login   TEXT NOT NULL,
  type           TEXT NOT NULL,
  message        TEXT NOT NULL,
  screenshot_url TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS site_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS banned_users (
  github_login TEXT PRIMARY KEY,
  reason       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS processed_events (
  event_id   TEXT PRIMARY KEY,
  event_type TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS background_jobs (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  payload       TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  available_at  TEXT NOT NULL DEFAULT (datetime('now')),
  locked_at     TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at  TEXT
);

CREATE TABLE IF NOT EXISTS live_site_scans (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  domain      TEXT NOT NULL,
  scan_id     TEXT REFERENCES scans(id) ON DELETE SET NULL,
  repo_id     TEXT REFERENCES repos(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'queued',
  results     TEXT NOT NULL DEFAULT '[]',
  security_score INTEGER,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  started_at  TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS domain_scan_confirmations (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  domain       TEXT NOT NULL,
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
  scan_id      TEXT,
  ip_address   TEXT
);

CREATE TABLE IF NOT EXISTS category_score_history (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  category     TEXT NOT NULL,
  repo_id      TEXT REFERENCES repos(id) ON DELETE SET NULL,
  domain       TEXT,
  score        INTEGER NOT NULL,
  recorded_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS live_site_monitors (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  domain          TEXT NOT NULL,
  repo_id         TEXT REFERENCES repos(id) ON DELETE SET NULL,
  cadence         TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_enqueued_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, domain)
);

CREATE TABLE IF NOT EXISTS sandbox_verify_runs (
  id                   TEXT PRIMARY KEY,
  repo_id              TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  user_id              TEXT NOT NULL,
  scan_id              TEXT REFERENCES scans(id) ON DELETE SET NULL,
  fix_request_id       TEXT REFERENCES fix_requests(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'queued',
  branch_name          TEXT,
  runtime_version      TEXT,
  package_manager      TEXT,
  include_test         INTEGER NOT NULL DEFAULT 0,
  raw_log              TEXT,
  structured_results   TEXT NOT NULL DEFAULT '{}',
  error_message        TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  started_at           TEXT,
  finished_at          TEXT,
  planned_steps        TEXT,
  current_step         TEXT,
  completed_steps      TEXT NOT NULL DEFAULT '[]',
  live_log             TEXT NOT NULL DEFAULT '',
  git_sha              TEXT,
  duration_ms          INTEGER,
  est_cost_usd         REAL,
  quota_refunded       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sandbox_slots (
  run_id      TEXT PRIMARY KEY,
  acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_env_vars (
  id           TEXT PRIMARY KEY,
  repo_id      TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  key          TEXT NOT NULL,
  encrypted_value TEXT NOT NULL,
  key_version  INTEGER NOT NULL DEFAULT 1,
  is_secret    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  created_by   TEXT NOT NULL,
  last_used_at TEXT,
  UNIQUE (repo_id, key)
);

CREATE TABLE IF NOT EXISTS project_build_settings (
  repo_id       TEXT PRIMARY KEY REFERENCES repos(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL,
  root_dir      TEXT,
  build_command TEXT,
  node_version  TEXT,
  include_test  INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repo_knowledge_facts (
  id                TEXT PRIMARY KEY,
  repo_id           TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  fact_key          TEXT NOT NULL,
  scope             TEXT NOT NULL DEFAULT 'default',
  value             TEXT NOT NULL,
  state             TEXT NOT NULL,
  tier              INTEGER NOT NULL,
  confidence        TEXT NOT NULL,
  producer          TEXT NOT NULL,
  evidence_ref      TEXT,
  superseded_by     TEXT REFERENCES repo_knowledge_facts(id),
  first_observed_at TEXT NOT NULL DEFAULT (datetime('now')),
  verified_at       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sandbox_audit_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  repo_id      TEXT REFERENCES repos(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,
  job_id       TEXT,
  meta         TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS security_events (
  id           TEXT PRIMARY KEY,
  event        TEXT NOT NULL,
  outcome      TEXT NOT NULL CHECK (outcome IN ('success', 'failure')),
  actor_login  TEXT,
  target_login TEXT,
  ip           TEXT,
  meta         TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS session_revocations (
  github_login TEXT PRIMARY KEY,
  valid_after  TEXT NOT NULL,
  reason       TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS repo_monitors (
  id              TEXT PRIMARY KEY,
  repo_id         TEXT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL,
  cadence         TEXT NOT NULL,
  enabled         INTEGER NOT NULL DEFAULT 1,
  last_enqueued_at TEXT,
  last_notified_at TEXT,
  last_head_sha   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, repo_id)
);

CREATE TABLE IF NOT EXISTS short_locks (
  lock_key    TEXT PRIMARY KEY,
  acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_usage (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  github_login        TEXT,
  provider            TEXT NOT NULL,
  model               TEXT NOT NULL,
  task_type           TEXT NOT NULL,
  method              TEXT NOT NULL,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  est_cost_usd        REAL NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS marketing_articles (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  section     TEXT NOT NULL CHECK (section IN ('changelog', 'highlight')),
  title       TEXT NOT NULL,
  date_label  TEXT NOT NULL,
  category    TEXT,
  author      TEXT NOT NULL DEFAULT 'LaunchReadyy',
  read_time   TEXT,
  image       TEXT,
  body        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  bucket_key TEXT PRIMARY KEY,
  count      INTEGER NOT NULL DEFAULT 0,
  reset_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS status_incidents (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  service_key  TEXT,
  severity     TEXT NOT NULL CHECK (severity IN ('maintenance', 'degraded', 'partial_outage', 'major_outage')),
  status       TEXT NOT NULL DEFAULT 'investigating' CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at  TEXT
);

CREATE TABLE IF NOT EXISTS status_incident_updates (
  id           TEXT PRIMARY KEY,
  incident_id  TEXT NOT NULL REFERENCES status_incidents(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  message      TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ai_test_cache (
  id           TEXT PRIMARY KEY,
  scan_id      TEXT NOT NULL,
  fix_ids      TEXT NOT NULL,
  result       TEXT NOT NULL,
  content_hash TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  prompt_version TEXT NOT NULL DEFAULT '1',
  UNIQUE (scan_id, fix_ids)
);

-- Indexes
CREATE INDEX IF NOT EXISTS scans_repo_created_idx ON scans (repo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS issues_scan_id_idx ON issues (scan_id);
CREATE INDEX IF NOT EXISTS issues_fingerprint_idx ON issues (fingerprint);
CREATE INDEX IF NOT EXISTS repos_owner_idx ON repos (owner);
CREATE INDEX IF NOT EXISTS fix_requests_repo_created_idx ON fix_requests (repo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fix_requests_owner_login_idx ON fix_requests (owner_login);
CREATE INDEX IF NOT EXISTS fix_requests_priority_idx ON fix_requests (priority DESC, created_at ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS fix_recoveries_fix_request_id_idx ON fix_recoveries (fix_request_id);
CREATE INDEX IF NOT EXISTS launch_reports_token_idx ON launch_reports (share_token) WHERE revoked = 0;
CREATE INDEX IF NOT EXISTS launch_reports_repo_idx ON launch_reports (repo_id, owner_login);
CREATE INDEX IF NOT EXISTS live_site_scans_user_idx ON live_site_scans (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS domain_scan_confirmations_user_domain_idx ON domain_scan_confirmations (user_id, domain, confirmed_at DESC);
CREATE INDEX IF NOT EXISTS category_score_history_user_cat_idx ON category_score_history (user_id, category, recorded_at DESC);
CREATE INDEX IF NOT EXISTS live_site_monitors_due_idx ON live_site_monitors (enabled, cadence, last_enqueued_at);
CREATE INDEX IF NOT EXISTS repo_monitors_due_idx ON repo_monitors (enabled, cadence, last_enqueued_at);
CREATE INDEX IF NOT EXISTS sandbox_verify_runs_repo_idx ON sandbox_verify_runs (repo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sandbox_verify_runs_user_idx ON sandbox_verify_runs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sandbox_verify_runs_repo_sha_definitive_idx ON sandbox_verify_runs (repo_id, git_sha, include_test) WHERE status IN ('passed', 'failed') AND git_sha IS NOT NULL AND error_message IS NULL;
CREATE INDEX IF NOT EXISTS project_env_vars_repo_idx ON project_env_vars (repo_id);
CREATE INDEX IF NOT EXISTS repo_knowledge_facts_repo_key_idx ON repo_knowledge_facts (repo_id, fact_key, scope);
CREATE INDEX IF NOT EXISTS repo_knowledge_facts_current_idx ON repo_knowledge_facts (repo_id) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS sandbox_audit_log_repo_idx ON sandbox_audit_log (repo_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sandbox_audit_log_user_idx ON sandbox_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_created_idx ON security_events (created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_actor_idx ON security_events (actor_login, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_target_idx ON security_events (target_login, created_at DESC);
CREATE INDEX IF NOT EXISTS security_events_event_idx ON security_events (event, created_at DESC);
CREATE INDEX IF NOT EXISTS session_revocations_valid_after_idx ON session_revocations (valid_after);
CREATE INDEX IF NOT EXISTS background_jobs_pending_idx ON background_jobs (available_at ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS background_jobs_running_idx ON background_jobs (locked_at ASC) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS background_jobs_finished_idx ON background_jobs (updated_at) WHERE status IN ('completed', 'failed');
CREATE INDEX IF NOT EXISTS processed_events_created_idx ON processed_events (created_at);
CREATE INDEX IF NOT EXISTS sandbox_audit_log_created_idx ON sandbox_audit_log (created_at);
CREATE INDEX IF NOT EXISTS ai_test_cache_created_idx ON ai_test_cache (created_at);
CREATE INDEX IF NOT EXISTS sandbox_verify_runs_created_idx ON sandbox_verify_runs (created_at);
CREATE INDEX IF NOT EXISTS scans_created_idx ON scans (created_at DESC);
CREATE INDEX IF NOT EXISTS fix_requests_created_idx ON fix_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_model_created_idx ON ai_usage (model, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_login_created_idx ON ai_usage (github_login, created_at DESC) WHERE github_login IS NOT NULL;
CREATE INDEX IF NOT EXISTS status_incidents_created_idx ON status_incidents (created_at DESC);
CREATE INDEX IF NOT EXISTS status_incident_updates_incident_idx ON status_incident_updates (incident_id, created_at ASC);
CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS feedback_login_idx ON feedback (github_login);
CREATE INDEX IF NOT EXISTS launch_reports_owner_login_idx ON launch_reports (owner_login);

-- Seed site_config defaults
INSERT OR IGNORE INTO site_config (key, value) VALUES ('beta_banner', 'false');
INSERT OR IGNORE INTO site_config (key, value) VALUES ('status_banner_message', '');
INSERT OR IGNORE INTO site_config (key, value) VALUES ('maintenance_mode', 'false');
INSERT OR IGNORE INTO site_config (key, value) VALUES ('contact_email', 'hello@example.com');
INSERT OR IGNORE INTO site_config (key, value) VALUES ('flag_ai_fixes', 'true');
INSERT OR IGNORE INTO site_config (key, value) VALUES ('flag_playwright_ai', 'true');
INSERT OR IGNORE INTO site_config (key, value) VALUES ('flag_code_auditor', 'true');
INSERT OR IGNORE INTO site_config (key, value) VALUES ('flag_architecture_analysis', 'true');
