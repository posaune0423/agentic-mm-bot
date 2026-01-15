## 用語集

この repo（`packages/core` / `packages/db` / `apps/*`）で使う用語を **用語 → 意味**で簡潔に列挙します。必要なら参照先のファイルを見てください。

---

### 単位

- **bps**: 1bps = 0.01%。価格差を mid で割って 10,000 倍した指標。
- **ms**: ミリ秒（`Date.now()` の値など）。
- **base / quote**: `BTC-USD` なら base=BTC（数量）、quote=USD（価格）。

---

### 市場データ

- **BBO**: Best Bid/Offer（最良買い気配/最良売り気配）。`bestBidPx/bestBidSz` と `bestAskPx/bestAskSz`。参照: `packages/db/src/schema/md-bbo.ts`
- **best bid**: いま市場で最も高い買い注文の価格/サイズ。
- **best ask**: いま市場で最も安い売り注文の価格/サイズ。
- **mid**: `mid = (bestBidPx + bestAskPx) / 2`（本repoの参照価格の基準）。
- **mark / index**: 取引所が出す参照価格（mark）と、外部/合成参照価格（index）。参照: `packages/db/src/schema/md-price.ts`
- **liquidation / delev**: 清算/デレバレッジに関連する取引タイプ（`md_trade.type`）。
- **`md_bbo`**: BBO の時系列テーブル。参照: `packages/db/src/schema/md-bbo.ts`
- **`md_trade`**: trade の時系列テーブル。参照: `packages/db/src/schema/md-trade.ts`
- **`md_price`**: mark/index の時系列テーブル。参照: `packages/db/src/schema/md-price.ts`
- **`latest_top`**: 最新の気配（BBO/mark/index等）を (exchange, symbol) ごとに upsert するテーブル（Executor が高速参照）。参照: `packages/db/src/schema/latest-top.ts`
- **`latest_position`**: 最新ポジションを (exchange, symbol) ごとに upsert するテーブル。参照: `packages/db/src/schema/latest-position.ts`

---

### 戦略モード/状態

- **NORMAL**: 通常運転（QUOTEを出す）。
- **DEFENSIVE**: 防御運転（条件が悪いが、基本はQUOTEを出す）。
- **PAUSE**: 停止運転（QUOTEしない。常に `CANCEL_ALL`）。参照: `packages/core/src/strategy-engine.ts`
- **PAUSE最小継続**: `PAUSE_MIN_DURATION_MS = 10_000`（10秒）。参照: `packages/core/src/risk-policy.ts`
- **PAUSE解除時の遷移**: PAUSE →（解除後）DEFENSIVE。参照: `packages/core/src/strategy-engine.ts`
- **ReasonCode**: 意思決定の理由コード（監査/学習/テスト用途）。参照: `packages/core/src/types.ts`

---

### 特徴量（Features）

- **Features**: Executor が市場データから計算する入力特徴量。参照: `packages/core/src/feature-calculator.ts`
- **`tradeImbalance1s`**: 直近1秒の売買偏り（imbalance）。
- **`realizedVol10s`**: 直近10秒の実現ボラ。
- **`markIndexDivBps`**: mark/index の乖離を bps 化した値。
- **`liqCount10s`**: 直近10秒の `type in {liq, delev}` 件数。
- **`dataStale`**: 市場データが古い判定（内部的に `staleCancelMs` を使用）。
- **（CLI略語）`vol10s`**: `realizedVol10s` の短縮表示。
- **（CLI略語）`tox1s`**: `tradeImbalance1s` の短縮表示（toxicity proxy）。
- **（CLI略語）`mrkIdx`**: `markIndexDivBps` の短縮表示。
- **（CLI略語）`liq10s`**: `liqCount10s` の短縮表示。

---

### 戦略パラメータ（調整対象10個）

参照: `packages/core/src/types.ts` / `packages/db/src/schema/strategy-params.ts`

- **`baseHalfSpreadBps`**: 基本のハーフスプレッド（bps）。Full spread は概ね \(2 \times baseHalfSpreadBps\)。
- **`volSpreadGain`**: ボラに応じてスプレッドを広げる係数。
- **`toxSpreadGain`**: 毒性（toxicity proxy = `abs(tradeImbalance1s)`）に応じてスプレッドを広げる係数。
- **`quoteSizeUsd`**: 片側1レベルで出す注文サイズ（USD建て notional）。内部で `mid` を使って base 数量に換算される。参照: `packages/core/src/quote-calculator.ts`
- **`refreshIntervalMs`**: quote 更新（差し替え）してよい最小間隔。参照: `apps/executor/src/services/execution-planner.ts`
- **`staleCancelMs`**: 注文が古いと見なしてキャンセル→再発注するまでの時間。参照: `apps/executor/src/services/execution-planner.ts`
- **`maxInventory`**: 在庫上限。超えると PAUSE トリガー。参照: `packages/core/src/risk-policy.ts`
- **`inventorySkewGain`**: 在庫に応じて quote を上下にシフトする係数。参照: `packages/core/src/quote-calculator.ts`
- **`pauseMarkIndexBps`**: mark/index 乖離で PAUSE する閾値。参照: `packages/core/src/risk-policy.ts`
- **`pauseLiqCount10s`**: 清算/デレバが多い時に PAUSE する閾値（10秒窓）。参照: `packages/core/src/risk-policy.ts`

---

### 計算で出てくる中間値/派生値（用語）

参照: `packages/core/src/quote-calculator.ts` / `apps/executor/src/services/cli-dashboard.ts`

- **halfSpreadBps**: 実際に価格計算へ入るハーフスプレッド（bps）。  
  `halfSpreadBps = baseHalfSpreadBps + volSpreadGain * realizedVol10s + toxSpreadGain * abs(tradeImbalance1s)`
- **skewBps（skew）**: 在庫による “quote 全体のシフト量（bps）”。  
  `skewBps = inventorySkewGain * inventory`（inventory は `position.size`）。
- **skew の符号/挙動**: 実装上は両側から同じ量を引いて平行移動する。  
  `bid = mid - halfSpread - skew` / `ask = mid + halfSpread - skew`
  - inventory が正（LONG）→ `skew > 0` → bid/ask ともに下がる（買い増しを抑制）
  - inventory が負（SHORT）→ `skew < 0` → bid/ask ともに上がる（売り増しを抑制）

---

### CLIダッシュボードで出てくる略語/表示語

参照: `apps/executor/src/services/cli-dashboard.ts`

- **`baseHalf`**: `baseHalfSpreadBps` の短縮表示。
- **DB / Eff**: DBに保存されているパラメータ（Source of Truth）と、オーバーレイ適用後の有効値（Effective）。
- **overlay**: `ParamsOverlay` の ON/OFF（メモリ上だけの調整。再起動でリセット）。参照: `apps/executor/src/services/params-overlay.ts`
- **Tighten / tightenBps**: fill が長時間無いときに `baseHalfSpreadBps` を **狭める**ために差し引く量（bps）。fill が来るとリセットされる。
- **（Params欄略語）`vol` / `tox` / `skew` / `qUsd`**: それぞれ `volSpreadGain` / `toxSpreadGain` / `inventorySkewGain` / `quoteSizeUsd` の短縮表示。
- **Skew（Position欄）**: `inventorySkewGain * position.size` を bps 表示したもの（= 上の `skewBps`）。
- **Dir / Util / Entry / uPnL**: 方向（LONG/SHORT/FLAT）/ 在庫使用率（\(|size|/maxInventory|\)）/ 平均建値 / 未実現損益。

---

### LLM提案/ロールアウト

- **`llm_proposal`**: LLM が生成したパラメータ変更提案を保存するテーブル（proposal/rollback/ログ参照/ステータス等）。参照: `packages/db/src/schema/llm-proposal.ts`
- **changes**: パラメータの差分（最大2つ）。
- **rollbackConditions**: 失敗時に戻す条件（最低1つ必須）。参照: `packages/core/src/param-gate.ts`
  - **`markout10sP50BelowBps`**: markout10s の中央値（P50）がこの値を下回ったらロールバック（bps）。
  - **`pauseCountAbove`**: 一定窓（実装側の集計ロジック）で PAUSE 回数がこの値を超えたらロールバック。
  - **`maxDurationMs`**: この時間が経過したら成績に関わらずロールバック（ms）。
- **ParamGate**: LLM提案のバリデーション（最大2変更、各±10%、ロールバック必須など）。参照: `packages/core/src/param-gate.ts`
- **`param_rollout`**: 提案の apply/reject/rollback を監査するテーブル。参照: `packages/db/src/schema/param-rollout.ts`

---

### 注文/イベント/約定

- **quote（クオート）**: この repo では「板に出す指値の提示（= bid/ask の注文を出して流動性を提供すること）」を指す。文脈により次のどれかを意味する。
  - **quote intent**: 戦略が生成する「出したい注文」の指示（`type: "QUOTE"`、`bidPx/askPx/size/postOnly` を持つ）。参照: `packages/core/src/quote-calculator.ts`
  - **quote prices**: `mid` を基準に計算した bid/ask のターゲット価格（`bidPx` と `askPx`）。
  - **quote update（差し替え）**: 既存注文とターゲット価格がズレたときに cancel→place で更新すること。頻度は `refreshIntervalMs`、古さ判定は `staleCancelMs` を使う。参照: `apps/executor/src/services/execution-planner.ts`
- **quoting**: quote を継続的に出し続ける運用（マーケットメイクの基本動作）。
- **post-only**: maker 目的の注文。taker になる注文は拒否され得る。
- **`ex_order_event`**: 注文の place/cancel/ack/reject/fill などのイベントを保存する監査テーブル。参照: `packages/db/src/schema/ex-order-event.ts`
- **`ex_fill`**: 約定（fill）を保存するテーブル。参照: `packages/db/src/schema/ex-fill.ts`

---

### fill enrich / markout

- **`fills_enriched`（fill enrich）**: `ex_fill` に参照mid（t0/1s/10s/60s）と markout 等を付加した分析用テーブル（Summarizer が生成）。参照: `packages/db/src/schema/fills-enriched.ts` / `apps/summarizer/src/main.ts`
- **markout**: 約定後の mid と比較して得/損を bps で表したもの（BUY/SELLで符号が変わる）。参照: `apps/summarizer/src/main.ts`
- **`markout10sP50`**: 時間窓内の markout10s の中央値（P50）。LLM提案や適用判断に使う。参照: `apps/summarizer/src/main.ts`

---

### 環境変数（env）

- **env**: 各 app の `apps/<app>/src/env.ts` で定義・起動時バリデーションされる設定。
- **`DATABASE_URL`**: Postgres 接続URL。
- **`EXCHANGE` / `SYMBOL`**: 取引所名と対象シンボル。
- **`OPENAI_API_KEY` / `OPENAI_MODEL`**: LLM Reflector 用の LLM 設定。参照: `apps/llm-reflector/src/env.ts`
