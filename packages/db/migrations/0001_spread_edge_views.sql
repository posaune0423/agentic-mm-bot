-- Spread Edge Analysis Views
-- Decompose fill PnL into edge@T0 (spread capture) and price_move (adverse selection)

-- View A: Per-fill decomposition
-- Shows edge_t0_bps (spread revenue) and price_move (adverse selection) for each fill
CREATE OR REPLACE VIEW v_fills_edge_decomposition AS
SELECT
  fe.id,
  fe.fill_id,
  fe.ts,
  fe.exchange,
  fe.symbol,
  fe.side,
  fe.fill_px,
  fe.fill_sz,
  fe.mid_t0,
  fe.markout_1s_bps,
  fe.markout_10s_bps,
  fe.markout_60s_bps,
  fe.state,
  f.fee,
  f.liquidity,
  
  -- Edge at T0: how much better than mid did we fill?
  -- BUY: positive edge means we bought below mid
  -- SELL: positive edge means we sold above mid
  CASE
    WHEN fe.mid_t0 IS NULL OR fe.mid_t0 = 0 THEN NULL
    WHEN UPPER(fe.side) = 'BUY' THEN ((fe.mid_t0::numeric - fe.fill_px::numeric) / fe.mid_t0::numeric * 10000)
    WHEN UPPER(fe.side) = 'SELL' THEN ((fe.fill_px::numeric - fe.mid_t0::numeric) / fe.mid_t0::numeric * 10000)
    ELSE NULL
  END AS edge_t0_bps,
  
  -- Notional value at T0
  CASE
    WHEN fe.mid_t0 IS NULL OR fe.mid_t0 = 0 THEN NULL
    ELSE fe.fill_sz::numeric * fe.mid_t0::numeric
  END AS notional_t0,
  
  -- Price move components (markout - edge = price movement after fill)
  CASE
    WHEN fe.mid_t0 IS NULL OR fe.mid_t0 = 0 OR fe.markout_1s_bps IS NULL THEN NULL
    WHEN UPPER(fe.side) = 'BUY' THEN fe.markout_1s_bps::numeric - ((fe.mid_t0::numeric - fe.fill_px::numeric) / fe.mid_t0::numeric * 10000)
    WHEN UPPER(fe.side) = 'SELL' THEN fe.markout_1s_bps::numeric - ((fe.fill_px::numeric - fe.mid_t0::numeric) / fe.mid_t0::numeric * 10000)
    ELSE NULL
  END AS price_move_1s_bps,
  
  CASE
    WHEN fe.mid_t0 IS NULL OR fe.mid_t0 = 0 OR fe.markout_10s_bps IS NULL THEN NULL
    WHEN UPPER(fe.side) = 'BUY' THEN fe.markout_10s_bps::numeric - ((fe.mid_t0::numeric - fe.fill_px::numeric) / fe.mid_t0::numeric * 10000)
    WHEN UPPER(fe.side) = 'SELL' THEN fe.markout_10s_bps::numeric - ((fe.fill_px::numeric - fe.mid_t0::numeric) / fe.mid_t0::numeric * 10000)
    ELSE NULL
  END AS price_move_10s_bps,
  
  CASE
    WHEN fe.mid_t0 IS NULL OR fe.mid_t0 = 0 OR fe.markout_60s_bps IS NULL THEN NULL
    WHEN UPPER(fe.side) = 'BUY' THEN fe.markout_60s_bps::numeric - ((fe.mid_t0::numeric - fe.fill_px::numeric) / fe.mid_t0::numeric * 10000)
    WHEN UPPER(fe.side) = 'SELL' THEN fe.markout_60s_bps::numeric - ((fe.fill_px::numeric - fe.mid_t0::numeric) / fe.mid_t0::numeric * 10000)
    ELSE NULL
  END AS price_move_60s_bps

FROM fills_enriched fe
LEFT JOIN ex_fill f ON fe.fill_id = f.id;

-- View B: Hourly aggregation
-- Aggregates edge and price_move metrics by hour for trend analysis
CREATE OR REPLACE VIEW v_fills_edge_hourly AS
SELECT
  date_trunc('hour', ts) AS hour,
  exchange,
  symbol,
  
  -- Fill counts
  COUNT(*) AS fill_count,
  COUNT(*) FILTER (WHERE UPPER(side) = 'BUY') AS buy_count,
  COUNT(*) FILTER (WHERE UPPER(side) = 'SELL') AS sell_count,
  
  -- Total notional
  SUM(notional_t0) AS total_notional,
  
  -- Simple averages
  AVG(edge_t0_bps) AS edge_t0_bps_avg,
  AVG(price_move_10s_bps) AS price_move_10s_bps_avg,
  AVG(markout_10s_bps) AS markout_10s_bps_avg,
  AVG(markout_60s_bps) AS markout_60s_bps_avg,
  
  -- Volume-weighted averages (more meaningful for PnL)
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(edge_t0_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS edge_t0_bps_vwap,
  
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(price_move_10s_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS price_move_10s_bps_vwap,
  
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(markout_10s_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS markout_10s_bps_vwap,
  
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(markout_60s_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS markout_60s_bps_vwap,
  
  -- USD metrics (approximated by notional * bps / 10000)
  SUM(edge_t0_bps * notional_t0 / 10000) AS edge_t0_usd,
  SUM(price_move_10s_bps * notional_t0 / 10000) AS price_move_10s_usd,
  SUM(markout_10s_bps * notional_t0 / 10000) AS markout_10s_usd,
  SUM(markout_60s_bps * notional_t0 / 10000) AS markout_60s_usd,
  
  -- By state (for comparing NORMAL vs DEFENSIVE effectiveness)
  AVG(edge_t0_bps) FILTER (WHERE UPPER(state) = 'NORMAL') AS edge_t0_bps_normal,
  AVG(edge_t0_bps) FILTER (WHERE UPPER(state) = 'DEFENSIVE') AS edge_t0_bps_defensive,
  AVG(markout_10s_bps) FILTER (WHERE UPPER(state) = 'NORMAL') AS markout_10s_bps_normal,
  AVG(markout_10s_bps) FILTER (WHERE UPPER(state) = 'DEFENSIVE') AS markout_10s_bps_defensive

FROM v_fills_edge_decomposition
WHERE notional_t0 IS NOT NULL AND notional_t0 > 0
GROUP BY date_trunc('hour', ts), exchange, symbol
ORDER BY hour DESC;

-- View C: Daily aggregation
-- Higher-level daily summary for longer-term trends
CREATE OR REPLACE VIEW v_fills_edge_daily AS
SELECT
  date_trunc('day', ts) AS day,
  exchange,
  symbol,
  
  COUNT(*) AS fill_count,
  SUM(notional_t0) AS total_notional,
  
  -- Volume-weighted averages
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(edge_t0_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS edge_t0_bps_vwap,
  
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(price_move_10s_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS price_move_10s_bps_vwap,
  
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(markout_10s_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS markout_10s_bps_vwap,
  
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(markout_60s_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS markout_60s_bps_vwap,
  
  -- USD totals
  SUM(edge_t0_bps * notional_t0 / 10000) AS edge_t0_usd,
  SUM(price_move_10s_bps * notional_t0 / 10000) AS price_move_10s_usd,
  SUM(markout_10s_bps * notional_t0 / 10000) AS markout_10s_usd,
  SUM(markout_60s_bps * notional_t0 / 10000) AS markout_60s_usd

FROM v_fills_edge_decomposition
WHERE notional_t0 IS NOT NULL AND notional_t0 > 0
GROUP BY date_trunc('day', ts), exchange, symbol
ORDER BY day DESC;

-- View D: By side analysis
-- Separate analysis for BUY vs SELL fills
CREATE OR REPLACE VIEW v_fills_edge_by_side AS
SELECT
  exchange,
  symbol,
  UPPER(side) AS side,
  
  COUNT(*) AS fill_count,
  SUM(notional_t0) AS total_notional,
  
  AVG(edge_t0_bps) AS edge_t0_bps_avg,
  AVG(price_move_10s_bps) AS price_move_10s_bps_avg,
  AVG(markout_10s_bps) AS markout_10s_bps_avg,
  
  -- VWAP metrics
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(edge_t0_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS edge_t0_bps_vwap,
  
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(price_move_10s_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS price_move_10s_bps_vwap,
  
  CASE 
    WHEN SUM(notional_t0) > 0 THEN SUM(markout_10s_bps * notional_t0) / SUM(notional_t0)
    ELSE NULL
  END AS markout_10s_bps_vwap

FROM v_fills_edge_decomposition
WHERE notional_t0 IS NOT NULL AND notional_t0 > 0
GROUP BY exchange, symbol, UPPER(side);
