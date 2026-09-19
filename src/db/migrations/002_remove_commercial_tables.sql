-- Compatibility cleanup for databases created with pre-1.0 schemas.
DROP TABLE IF EXISTS user_credits;
DROP TABLE IF EXISTS credit_transactions;
DROP TABLE IF EXISTS processed_stripe_events;
