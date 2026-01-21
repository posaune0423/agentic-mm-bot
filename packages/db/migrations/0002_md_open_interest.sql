-- Market Open Interest (timeseries)
-- Phase 3 (plan): Poll marketStatistics and store as md_open_interest for regime detection.

CREATE TABLE IF NOT EXISTS md_open_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ts timestamptz NOT NULL,
  exchange text NOT NULL,
  symbol text NOT NULL,
  open_interest numeric,
  open_interest_usd numeric,
  ingest_ts timestamptz NOT NULL DEFAULT now(),
  raw_json jsonb
);

CREATE INDEX IF NOT EXISTS md_open_interest_exchange_symbol_ts_idx
  ON md_open_interest (exchange, symbol, ts DESC);

