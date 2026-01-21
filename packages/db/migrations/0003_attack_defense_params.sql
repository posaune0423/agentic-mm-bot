-- Attack-Defense Parameters for improved inventory management
-- Add optional columns with NULL defaults (core uses defaults when NULL)

ALTER TABLE strategy_params
ADD COLUMN IF NOT EXISTS defensive_spread_multiplier numeric,
ADD COLUMN IF NOT EXISTS defensive_size_multiplier numeric,
ADD COLUMN IF NOT EXISTS one_sided_threshold numeric,
ADD COLUMN IF NOT EXISTS one_sided_on_non_zero_inventory boolean,
ADD COLUMN IF NOT EXISTS unwind_trigger_ms integer,
ADD COLUMN IF NOT EXISTS unwind_size_ratio numeric,
ADD COLUMN IF NOT EXISTS unwind_cross_bps numeric;

-- Add comment explaining defaults (applied in core logic):
-- defensive_spread_multiplier: 1.5
-- defensive_size_multiplier: 0.5
-- one_sided_threshold: 0.3
-- one_sided_on_non_zero_inventory: false
-- unwind_trigger_ms: 30000
-- unwind_size_ratio: 0.25
-- unwind_cross_bps: 0
