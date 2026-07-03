-- supabase/migrations/006_jobs_queue.sql
-- NFR-16: async job queue for all Claude API calls and scheduled work.

CREATE TABLE jobs (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at     TIMESTAMPTZ  DEFAULT now(),
    type           TEXT         NOT NULL,
    payload        JSONB        NOT NULL DEFAULT '{}',
    status         TEXT         NOT NULL DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
    attempt_count  INTEGER      NOT NULL DEFAULT 0,
    next_retry_at  TIMESTAMPTZ  DEFAULT now(),
    last_error     TEXT,
    completed_at   TIMESTAMPTZ
);

CREATE INDEX idx_jobs_poll ON jobs (status, next_retry_at)
    WHERE status IN ('pending', 'running');

CREATE INDEX idx_jobs_type ON jobs (type, created_at);