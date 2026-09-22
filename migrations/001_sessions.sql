CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  join_code varchar(5) NOT NULL UNIQUE CHECK (join_code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$'),
  host_hash text NOT NULL,
  guest_hash text,
  state jsonb NOT NULL,
  last_active timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_activity_idx ON sessions(last_active);
