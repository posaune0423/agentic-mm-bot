---
name: core-algo-evolution-from-data
overview: 既存の攻防一体（SET_ORDERS/DEFENSIVE/one-sided/UNWIND）実装を、直近24hの実データ（60sで在庫負け・maxInventory=1で在庫ガード無効）を踏まえて“本当に在庫が減る・調整可能”な形へ進化させる。
todos:
  - id: kpi-define
    content: DBの既存viewを使い、改善判定KPI（markout60s/edge/fee/maker比率）と差分集計SQLを確定する
    status: pending
  - id: core-unwind-bbo-pricing
    content: coreのUNWIND価格をspreadBpsから概算BBO復元+任意跨ぎbpsで“刺さる”方向へ変更
    status: pending
  - id: core-one-sided-early-switch
    content: one-sided早期化（pos!=0で悪化側停止）をフラグで導入し、既存しきい値方式と切替可能にする
    status: pending
  - id: db-add-strategy-params
    content: strategy_paramsに新規パラメータを追加し、executorのtoCoreParamsとllm param-gateに配線する（migration含む）
    status: pending
  - id: tests-and-final-check
    content: 関連テスト更新→lint/format/typecheckを回してerror/warningを0にする
    status: pending
---

## 前提（既に達成済み / 既存planの成果）

- `SET_ORDERS` intent + diff planner
- DEFENSIVE/one-sided/UNWIND（reduce-only IOC）導入
- edge分解ビュー（`v_fills_edge_*`）導入
- OI時系列化（`md_open_interest`）導入（Phase 3 相当）
- 参照: [.cursor/plans/core-algo-improvement_90561d81.plan.md](.cursor/plans/core-algo-improvement_90561d81.plan.md)

## 現状の客観診断（docker postgres / 直近データ）

- `v_fills_edge_decomposition` 平均（概算）
- edge_t0_bps ≈ +1.37bps
- markout10s_bps ≈ +1.12bps
- markout60s_bps ≈ -1.57bps
- つまり「スプレッドは取れているが、60sスケールで在庫負け」
- 直近24hの約定列ベース推定では p50 |pos| ≈ 0.097 BTC、max |pos| ≈ 0.328 BTC。
- `strategy_params.is_current` の `maxInventory=1` だと、one-sided/在庫制限がほぼ発火しない（ガードが実質無効）。

## 進化の狙い（シンプルに直す）

- **在庫ができた瞬間に悪化側を止める**（one-sided早期化）
- **UNWINDが“刺さらない”を無くす**（IOC価格設計をBBO方向へ）
- これらを **DBパラメータで調整可能**にして、実データで最適化ループを回せるようにする

## 設計・実装方針（最小で効く順）

### 1) UNWIND価格設計を「刺さる」方向へ（core）

- 変更対象: [packages/core/src/quote-calculator.ts](packages/core/src/quote-calculator.ts)
- 現状: `IOC + price=mid`（Extended adapterも単なるIOC指値として送る）
- 改善: `features.spreadBps` を使って概算BBOを復元し、UNWINDは概算BBO側へ置く
- long解消（sell unwind）: `unwindPrice ~= mid - spread/2`（概算bid）
- short解消（buy unwind）: `unwindPrice ~= mid + spread/2`（概算ask）
- さらに「確実に減らしたい」場合に備えて `unwindCrossBps`（追加で跨ぐbps）を導入（デフォ0〜数bps）

### 2) one-sidedを在庫初期から効かせる（core）

- 変更対象: [packages/core/src/quote-calculator.ts](packages/core/src/quote-calculator.ts)
- 現状: `abs(pos) > oneSidedThreshold * maxInventory`（デフォ0.3）で初めて片側化
- 改善案（シンプル/安全）
- `oneSidedOnNonZeroInventory`（bool）を導入し、trueなら `pos!=0` の瞬間から「悪化側だけ止める」
- 既存のしきい値one-sidedは残し、運用で切替可能にする（デフォはfalseから開始でも良い）

### 3) 重要パラメータをDBに通して「調整可能」にする

- 目的: 直近24hのように在庫スケールが変わっても、DB更新/提案で追従できるようにする
- 変更対象:
- [packages/db/src/schema/strategy-params.ts](packages/db/src/schema/strategy-params.ts)
- [apps/executor/src/main.ts](apps/executor/src/main.ts) `toCoreParams()`
- [apps/llm-reflector/src/services/param-gate.ts](apps/llm-reflector/src/services/param-gate.ts)（許可キー/ゲート）
- DB migration（`packages/db/migrations/*`）
- 追加候補（最小セット）
- `oneSidedThreshold`
- `oneSidedOnNonZeroInventory`（bool）
- `unwindTriggerMs`
- `unwindSizeRatio`
- `defensiveSpreadMultiplier`
- `defensiveSizeMultiplier`
- `unwindCrossBps`（任意）

### 4) データでの評価ループ（SQLでKPIを固定）

- 主要KPI
- `markout60s_bps` の改善（最優先）
- `edge_t0_bps` を毀損しない（できれば維持）
- maker/taker比率とfee増加が暴れない
- 既存の `v_fills_edge_decomposition` を基準に、パラメータ変更前後の差分集計SQLを用意（運用手順としてplanに記載）

## テスト/安全策（最小）

- core unit test
- UNWIND価格が（spreadBps>0時）BBO側へ寄ること
- one-sided早期化のON/OFFで、desired ordersの片側が落ちること
- executor/summarizer既存テストが通ること
- 最終チェック
- `bun run lint`, `bun run format`, `bun run typecheck` を実行してゼロにする