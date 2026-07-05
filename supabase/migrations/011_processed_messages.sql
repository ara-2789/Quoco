-- supabase/migrations/011_processed_messages.sql
-- Message SID idempotency for the WhatsApp webhook.
-- Numbering note: 007 (auth surgery), 008 (dprs table), 009 (constraints)
-- are reserved for specific planned work per docs/schema.md. This table
-- has no dependency on any of them, so it's numbered 011 rather than
-- inserted into that reserved sequence.

CREATE TABLE processed_messages (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ  DEFAULT now(),
    message_sid  TEXT         NOT NULL UNIQUE,
    processed_at TIMESTAMPTZ  DEFAULT now()
);

-- Index for fast lookup on the SID (UNIQUE constraint already creates one,
-- but explicit for clarity).
CREATE INDEX idx_processed_messages_sid ON processed_messages (message_sid);

-- Cleanup consideration: Twilio SIDs are only relevant for retry dedup
-- within a short window (minutes to hours). A future cron job could prune
-- rows older than e.g. 7 days to keep this table small — not needed yet
-- at beta scale.