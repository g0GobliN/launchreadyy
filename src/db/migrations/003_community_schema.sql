ALTER TABLE issues RENAME COLUMN ai_credit_cost TO ai_effort;
ALTER TABLE fix_requests RENAME COLUMN credits_cost TO effort_score;
ALTER TABLE fix_recoveries RENAME COLUMN credits_used TO ai_effort;

DROP TABLE IF EXISTS feedback;
DROP TABLE IF EXISTS banned_users;
DROP TABLE IF EXISTS processed_events;
DROP TABLE IF EXISTS security_events;
DROP TABLE IF EXISTS session_revocations;
DROP TABLE IF EXISTS status_incident_updates;
DROP TABLE IF EXISTS status_incidents;
