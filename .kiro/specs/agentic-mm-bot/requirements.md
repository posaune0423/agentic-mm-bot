# Requirements Document

## Introduction

本仕様は、Extended（PERP DEX）向けに **Extended-first / Defensive MM / Drizzle SoT / Postgres（標準） / Bun+TS / neverthrow / turbo** を前提として、MVPのMarket Making botを最短で稼働させるための要件を定義する（LLMは将来拡張）。

ゴールは、toxic flow による **負の markout** を抑えつつ、**post-only のスプレッド収益＋ポイント獲得** を最大化すること。

## Requirements

### Requirement 1: ミッション・スコープ・設計原則（Non-negotiables）

**Objective:** As a 開発/運用担当者, I want MVPの目的・採用/不採用・不変制約を明文化したい, so that 実装が迷走せず最短で稼働に到達できる

#### Acceptance Criteria

- **1.1** The system shall Bun runtime と TypeScript strict mode を前提とする
- **1.2** The system shall DBに Postgres（標準）を使用し、スキーマのSoTを `packages/db` のDrizzle定義に固定する
- **1.3** The system shall エラーハンドリングに neverthrow を用い、I/Oは `ResultAsync`、domainは `Result` を返却し、domainでは例外を投げない
- **1.4** The system shall 環境変数アクセスを t3-env 経由に限定し、`process.env` 直参照を禁止する
- **1.5** The system shall MVPスコープとして BBO / Trades / Mark / Index の録画、1レベル post-only、3状態機械、`fills_enriched`、録画リプレイ backtest を含む
- **1.6** The system shall MVPスコープ外として L2 full orderbook、ニュース/SNS、複数取引所同時稼働、高度なqueue推定、RL（PPO/SAC）、LLMワーカー（llm-reflector）を含めない

### Requirement 2: リポジトリ構成と依存ルール（層境界の強制）

**Objective:** As a 実装者, I want I/Oと戦略ロジックの分離境界が明確である, so that テスト容易性と安全性が担保される

#### Acceptance Criteria

- **2.1** The system shall `packages/core` を「純粋ロジック（I/O禁止・throw禁止）」として扱い、DB/HTTP/WS/FSへ直接依存しない
- **2.2** The system shall `apps/*` を composition root（wiringのみ）として扱い、取引所依存は adapter/port 実装へ隔離する
- **2.3** The system shall adapters に戦略/停止ロジックを置かず、port実装に限定する
- **2.4** The system shall 命名規約として filename を kebab-case、テーブルを snake_case、時刻はDBで timestamptz(UTC) を採用する

### Requirement 3: ingestor（WS → 正規化 → 時系列 append + latest upsert）

**Objective:** As a 運用担当者, I want WS由来の市場データを欠損最小で永続化したい, so that executor/backtest/summarizer が一貫した入力を得られる

#### Acceptance Criteria

- **3.1** When the ingestor is running, the system shall Extended WSから BBO / Trades / Mark / Index を購読する
- **3.2** The system shall 受信データを正規化し、`md_bbo` / `md_trade` / `md_price` に append する
- **3.3** The system shall executor向けに `latest_top` を (exchange, symbol) 単位で upsert し続ける
- **3.4** If WS切断が発生した場合, the system shall 指数バックオフで自動再接続する
- **3.5** If seq破綻（信頼できる場合）が検知された場合, the system shall 即再接続し、監視可能なログ/メトリクスを残す
- **3.6** The system shall `md_bbo` の永続化について、書き込み量を抑制するための間引き（例：時間間隔/イベント条件/市場選択）を設定可能とする

### Requirement 4: executor（snapshot → features → strategy → intents → execution）

**Objective:** As a 実装者, I want 安全な状態機械に基づいてpost-onlyクォートを維持したい, so that toxic flow/異常時に即座に板を引ける

#### Acceptance Criteria

- **4.1** When executor ticks, the system shall WS由来の最新状態（市場データ/注文/約定/ポジション）からスナップショットを構築する
- **4.2** The system shall FeatureComputer により 1s/10s 窓の特徴量を更新する
- **4.3** The system shall StrategyEngine（core）で `OrderIntent[]` を生成し、ExecutionGateway（adapter）により発注・取消を実行する
- **4.4** The system shall すべての発注/取消/応答を `ex_order_event` として永続化し、fillsは `ex_fill`、ポジションは `ex_position`/`latest_position`（設計で確定）に保存する
- **4.5** If Kill/PAUSE 条件が一致した場合, the system shall `cancel_all` を実行し、PAUSEへ遷移し、監査ログ（理由）を残す
- **4.6** The system shall 低レイテンシの意思決定のために、最新状態（BBO/mark/index/trades、active orders、position、mode）と短期窓（1s/10s）をメモリ上で保持する
- **4.7** The system shall active orders と position を private stream から更新できる
- **4.8** If private stream が利用できない、または不安定な場合, the system shall open orders / position の整合のために一定間隔（秒オーダー）でREST同期できる
- **4.9** The system shall 意思決定の実行頻度をスロットリングでき、WSイベント到着ごとに必ず発注しない
- **4.10** The system shall hot path をDB待ちでブロックしないため、イベントログ/監査ログのDB永続化を非同期（バッチ可）で実行できる
- **4.11** The system shall 復旧目的で StrategyState（modeなど）を一定間隔（数秒〜数十秒）で永続化できる

### Requirement 5: StrategyState（3状態機械）と状態遷移（優先順位つき）

**Objective:** As a リスク管理者, I want 異常系を最優先でPAUSEできる, so that 予期しない損失を抑制できる

#### Acceptance Criteria

- **5.1** The system shall StrategyState として `NORMAL` / `DEFENSIVE` / `PAUSE` を持つ
- **5.2** When tickごとに入力が評価される, the system shall 遷移優先順位を HARD PAUSE > DEFENSIVE > NORMAL とする
- **5.3** If `latest_top` の更新時刻が `now - stale_cancel_ms` を超過した場合, the system shall 即PAUSEに遷移する（data_stale）
- **5.4** If `mark_index_div_bps >= pause_mark_index_bps` または `liq_count_10s >= pause_liq_count_10s` の場合, the system shall 即PAUSEに遷移する
- **5.5** If `abs(inventory) > max_inventory` の場合, the system shall 即PAUSEに遷移する
- **5.6** If PAUSE解除条件を満たした場合, the system shall 解除後の状態を DEFENSIVE に戻す（いきなりNORMALにしない）
- **5.7** The system shall PAUSE解除に `pause_min_duration_ms`（config固定、例：10_000ms）を適用する

### Requirement 6: FeatureComputer（最小特徴量と欠損時の防御）

**Objective:** As a 実装者, I want 最小限の毒性/変動/乖離/清算proxyを算出したい, so that 戦略が一貫した入力で動作する

#### Acceptance Criteria

- **6.1** The system shall `mid = (best_bid + best_ask)/2` と `spread_bps = (best_ask - best_bid)/mid*10_000` を算出する
- **6.2** The system shall `trade_imbalance_1s = (buy_volume - sell_volume)/max(total_volume, eps)` を算出する（buy/sell不明時は price vs mid で推定可）
- **6.3** The system shall `realized_vol_10s` を直近10秒の `ln(mid_t/mid_{t-1})` の標準偏差として算出する
- **6.4** The system shall `mark_index_div_bps = abs(mark - index)/mid*10_000` を算出する
- **6.5** The system shall `liq_count_10s` を直近10秒の trades のうち `type ∈ {LIQ, DELEV}` 件数として算出する
- **6.6** If 必須特徴量が欠損/計算不能の場合, the system shall quoteしない（RiskPolicyが data_stale 扱いでPAUSE推奨可能）

### Requirement 7: クォート計算（1レベル・post-only）と更新ルール

**Objective:** As a トレーダー, I want 1レベルの両側post-onlyクォートを頻度制御しながら維持したい, so that スパムを避けつつ収益機会を取れる

#### Acceptance Criteria

- **7.1** The system shall パラメータ10個（`base_half_spread_bps` ほか）を `strategy_params` として保持する
- **7.2** The system shall `half_spread_bps = base_half_spread_bps + vol_spread_gain*realized_vol_10s + tox_spread_gain*abs(trade_imbalance_1s)` を用いてスプレッドを決定する
- **7.3** The system shall `skew_bps = inventory_skew_gain * inventory` を用いて在庫スキューを適用する
- **7.4** The system shall `bid_px` / `ask_px` を mid と bps式から計算し、両側1本ずつ指値を維持する
- **7.5** If stateがPAUSEの場合, the system shall 常に cancel_all を実行し板を出さない
- **7.6** If post-only reject が発生した場合, the system shall 同tickで再発注せず次tickで再評価する
- **7.7** The system shall `refresh_interval_ms` 未満では更新を抑制し、`stale_cancel_ms` 超過の注文は cancel→再発注する
- **7.8** The system shall `min_requote_bps`（config固定）による乖離条件を満たす場合に限り refresh を許可する

### Requirement 8: RiskPolicy（Kill/PAUSE 推奨アクション）

**Objective:** As a リスク管理者, I want 実行系が一貫した停止アクションを取れる, so that 異常時に確実に板を引ける

#### Acceptance Criteria

- **8.1** The system shall RiskPolicy が「推奨アクション（例：CANCEL_ALL/ENTER_PAUSE/DISABLE_QUOTING）」を返し、executorが実行する
- **8.2** The system shall トリガとして data_stale、mark/index乖離、liq/delev多発、inventory超過、取引所エラー、DB write failures を含める
- **8.3** If `ex_*` が保存不能な状態が検知された場合, the system shall 安全側に倒して quoting を停止（PAUSE相当）できる

### Requirement 9: summarizer（fills_enriched 生成 + markout 計算 + 最小集計）

**Objective:** As a 改善担当者, I want fillごとの毒性（markout）と特徴量を一元化したい, so that 改善ループと監査が成立する

#### Acceptance Criteria

- **9.1** The system shall `ex_fill` の各行を対象に `fills_enriched` を生成する
- **9.2** The system shall 参照価格を **mid** に統一し、fill時刻 t0 に最も近い `md_bbo` を `ref_t0` とする
- **9.3** If `t0+Δt`（Δt=1s/10s/60s）の参照 `md_bbo` が存在しない場合, the system shall 当該 `ref_t1` と markout を null とし集計で除外できる
- **9.4** The system shall BUY/SELLで符号が一貫する以下の markout(bps) を保存する
- **9.5** The system shall fill時点の spread_bps / imbalance / vol / mark_index_div / liq_count / state / params_set_id を保存する
- **9.6** The system shall 最低限の集計として 1分/1時間の fills数、cancel数、PAUSE回数、markout分位（主要は10s）を生成できる

### Requirement 10: LLM 改善ループ（提案のみ・安全ゲート・監査ログ）

**Objective:** As a 運用担当者, I want LLM提案を安全に取り込み監査可能にしたい, so that 事故なく改善サイクルを回せる

> 本MVPではスコープ外（将来拡張要件）。

#### Acceptance Criteria

- **10.1** The system shall llm-reflector が毎時、直近1時間集計 + worst fills(top5) + 現在params を入力として提案を生成する
- **10.2** The system shall 提案が「最大2パラメータ」「各±10%以内」「rollback_conditions必須」を満たすJSONであること
- **10.3** The system shall 監査用 `reasoning_trace`（箇条書き）を生成し、**ファイルに永続化**して `llm_proposal` に `log_path` と `sha256` を保存する
- **10.4** The system shall executor側で次の5分境界に最大1回だけ適用判断を行う
- **10.5** The system shall 適用ゲートとして 形式検証（schema）、制約検証（最大2/±10%）、運用検証（HARD PAUSE多発/データ欠損/取引所エラー/markout極端悪化時の禁止）を全て満たす場合のみ apply する
- **10.6** The system shall apply/reject/rollback を `param_rollout` に監査記録として残す

### Requirement 11: backtest（録画replay + simulated execution + 指標出力）

**Objective:** As a 検証担当者, I want 録画データから同一StrategyEngineを再現実行したい, so that 本番投入前に挙動と指標を確認できる

#### Acceptance Criteria

- **11.1** The system shall `md_*` を ts 昇順で replay し、executorと同一の StrategyEngine を動作させる
- **11.2** The system shall tick を固定間隔（推奨：200ms〜1s、config）で実行できる
- **11.3** The system shall simulated execution（touch fill）として BUY: 次trade_px <= bid_px、SELL: 次trade_px >= ask_px で fill を成立させる
- **11.4** The system shall 出力指標として fills数、cancel数、PAUSE回数、擬似markout を出力する

### Requirement 12: データモデル（Drizzle SoT）とPostgres物理要件（標準）

**Objective:** As a DB管理者, I want 時系列と監査を矛盾なく保存できるスキーマが欲しい, so that 実運用と改善ループが成立する

#### Acceptance Criteria

- **12.1** The system shall すべての時系列に (exchange, symbol) と timestamptz(UTC) を付与し、time column を `ts` とする
- **12.2** The system shall `md_bbo` / `md_trade` / `md_price` に対し、基本インデックスを `(exchange, symbol, ts DESC)` とする
- **12.3** The system shall Drizzle schema をSoTとし、物理最適化（インデックス、必要最小限のパーティショニング等）は migrations SQL で適用する
- **12.4** The system shall 以下のテーブルを少なくとも定義する：`md_bbo`, `md_trade`, `md_price`, `latest_top`, `ex_order_event`, `ex_fill`, `latest_position`, `fills_enriched`, `strategy_params`, `strategy_state`, `llm_proposal`, `param_rollout`

#### Data Model Tables（要件）

##### md_bbo（時系列 append）

| Column      | Type        | Null | Notes                 |
| ----------- | ----------- | ---: | --------------------- |
| id          | uuid        |   NO | PK                    |
| ts          | timestamptz |   NO | time                  |
| exchange    | text        |   NO | extended              |
| symbol      | text        |   NO |                       |
| best_bid_px | numeric     |   NO |                       |
| best_bid_sz | numeric     |   NO |                       |
| best_ask_px | numeric     |   NO |                       |
| best_ask_sz | numeric     |   NO |                       |
| mid_px      | numeric     |   NO | convenience           |
| seq         | bigint      |  YES | WS sequence（あれば） |
| ingest_ts   | timestamptz |   NO | 書き込み時刻          |
| raw_json    | jsonb       |  YES | 任意                  |

##### md_trade（時系列 append）

| Column    | Type        | Null | Notes                    |
| --------- | ----------- | ---: | ------------------------ |
| id        | uuid        |   NO | PK                       |
| ts        | timestamptz |   NO | trade time               |
| exchange  | text        |   NO |                          |
| symbol    | text        |   NO |                          |
| trade_id  | text        |  YES | 取引所ID（あれば）       |
| side      | text        |  YES | buy/sell（不明ならnull） |
| px        | numeric     |   NO |                          |
| sz        | numeric     |   NO |                          |
| type      | text        |  YES | normal/liq/delev 等      |
| seq       | bigint      |  YES |                          |
| ingest_ts | timestamptz |   NO |                          |
| raw_json  | jsonb       |  YES |                          |

##### md_price（時系列 append）

| Column    | Type        | Null | Notes |
| --------- | ----------- | ---: | ----- |
| id        | uuid        |   NO | PK    |
| ts        | timestamptz |   NO |       |
| exchange  | text        |   NO |       |
| symbol    | text        |   NO |       |
| mark_px   | numeric     |  YES |       |
| index_px  | numeric     |  YES |       |
| ingest_ts | timestamptz |   NO |       |
| raw_json  | jsonb       |  YES |       |

##### latest_top（1行/シンボル）

| Column      | Type        | Null | Notes         |
| ----------- | ----------- | ---: | ------------- |
| exchange    | text        |   NO | PK part       |
| symbol      | text        |   NO | PK part       |
| ts          | timestamptz |   NO | 最新md_bbo.ts |
| best_bid_px | numeric     |   NO |               |
| best_bid_sz | numeric     |   NO |               |
| best_ask_px | numeric     |   NO |               |
| best_ask_sz | numeric     |   NO |               |
| mid_px      | numeric     |   NO |               |
| mark_px     | numeric     |  YES | 任意          |
| index_px    | numeric     |  YES | 任意          |
| updated_at  | timestamptz |   NO | upsert時刻    |

##### ex_order_event（注文イベント）

| Column            | Type        | Null | Notes                          |
| ----------------- | ----------- | ---: | ------------------------------ |
| id                | uuid        |   NO | PK                             |
| ts                | timestamptz |   NO | event time                     |
| exchange          | text        |   NO |                                |
| symbol            | text        |   NO |                                |
| client_order_id   | text        |   NO | app生成ID                      |
| exchange_order_id | text        |  YES | 取引所ID                       |
| event_type        | text        |   NO | place/cancel/ack/reject/fill等 |
| side              | text        |  YES | buy/sell                       |
| px                | numeric     |  YES |                                |
| sz                | numeric     |  YES |                                |
| post_only         | boolean     |   NO |                                |
| reason            | text        |  YES | reject理由など                 |
| state             | text        |  YES | 参考                           |
| params_set_id     | uuid        |  YES | 参照                           |
| raw_json          | jsonb       |  YES |                                |

##### ex_fill（約定）

| Column            | Type        | Null | Notes                    |
| ----------------- | ----------- | ---: | ------------------------ |
| id                | uuid        |   NO | PK                       |
| ts                | timestamptz |   NO | fill time                |
| exchange          | text        |   NO |                          |
| symbol            | text        |   NO |                          |
| client_order_id   | text        |   NO |                          |
| exchange_order_id | text        |  YES |                          |
| side              | text        |   NO | bot視点 buy/sell         |
| fill_px           | numeric     |   NO |                          |
| fill_sz           | numeric     |   NO |                          |
| fee               | numeric     |  YES |                          |
| liquidity         | text        |  YES | maker/taker（maker想定） |
| state             | text        |   NO | NORMAL/DEFENSIVE/PAUSE   |
| params_set_id     | uuid        |   NO |                          |
| raw_json          | jsonb       |  YES |                          |

##### latest_position（1行/シンボル）

| Column         | Type        | Null | Notes        |
| -------------- | ----------- | ---: | ------------ |
| exchange       | text        |   NO | PK part      |
| symbol         | text        |   NO | PK part      |
| ts             | timestamptz |   NO | 最新更新時刻 |
| position_sz    | numeric     |   NO | base asset   |
| entry_px       | numeric     |  YES |              |
| unrealized_pnl | numeric     |  YES |              |
| updated_at     | timestamptz |   NO |              |

##### fills_enriched（中核）

| Column                | Type        | Null | Notes              |
| --------------------- | ----------- | ---: | ------------------ |
| id                    | uuid        |   NO | PK                 |
| fill_id               | uuid        |   NO | ex_fill FK         |
| ts                    | timestamptz |   NO | fill time          |
| exchange              | text        |   NO |                    |
| symbol                | text        |   NO |                    |
| side                  | text        |   NO |                    |
| fill_px               | numeric     |   NO |                    |
| fill_sz               | numeric     |   NO |                    |
| mid_t0                | numeric     |  YES | 参照               |
| mid_t1s               | numeric     |  YES |                    |
| mid_t10s              | numeric     |  YES |                    |
| mid_t60s              | numeric     |  YES |                    |
| markout_1s_bps        | numeric     |  YES |                    |
| markout_10s_bps       | numeric     |  YES |                    |
| markout_60s_bps       | numeric     |  YES |                    |
| spread_bps_t0         | numeric     |  YES |                    |
| trade_imbalance_1s_t0 | numeric     |  YES |                    |
| realized_vol_10s_t0   | numeric     |  YES |                    |
| mark_index_div_bps_t0 | numeric     |  YES |                    |
| liq_count_10s_t0      | integer     |  YES |                    |
| state                 | text        |   NO |                    |
| params_set_id         | uuid        |   NO |                    |
| created_at            | timestamptz |   NO | summarizer生成時刻 |

##### strategy_params（現行params）

##### strategy_state（復旧用スナップショット）

| Column        | Type        | Null | Notes                  |
| ------------- | ----------- | ---: | ---------------------- |
| id            | uuid        |   NO | PK                     |
| ts            | timestamptz |   NO | snapshot time          |
| exchange      | text        |   NO |                        |
| symbol        | text        |   NO |                        |
| mode          | text        |   NO | NORMAL/DEFENSIVE/PAUSE |
| mode_since    | timestamptz |  YES | 任意                   |
| pause_until   | timestamptz |  YES | 任意                   |
| params_set_id | uuid        |  YES | 任意（監査）           |
| created_at    | timestamptz |   NO | 書き込み時刻           |

| Column               | Type        | Null | Notes         |
| -------------------- | ----------- | ---: | ------------- |
| id                   | uuid        |   NO | params_set_id |
| exchange             | text        |   NO |               |
| symbol               | text        |   NO |               |
| is_current           | boolean     |   NO | 1つだけtrue   |
| created_at           | timestamptz |   NO |               |
| created_by           | text        |   NO | manual/llm    |
| base_half_spread_bps | numeric     |   NO |               |
| vol_spread_gain      | numeric     |   NO |               |
| tox_spread_gain      | numeric     |   NO |               |
| quote_size_base      | numeric     |   NO |               |
| refresh_interval_ms  | integer     |   NO |               |
| stale_cancel_ms      | integer     |   NO |               |
| max_inventory        | numeric     |   NO |               |
| inventory_skew_gain  | numeric     |   NO |               |
| pause_mark_index_bps | numeric     |   NO |               |
| pause_liq_count_10s  | integer     |   NO |               |
| comment              | text        |  YES |               |

##### llm_proposal（提案 + ログ参照）

| Column                | Type        | Null | Notes                    |
| --------------------- | ----------- | ---: | ------------------------ |
| id                    | uuid        |   NO | proposal_id              |
| exchange              | text        |   NO |                          |
| symbol                | text        |   NO |                          |
| ts                    | timestamptz |   NO | 提案生成時刻             |
| input_window_start    | timestamptz |   NO |                          |
| input_window_end      | timestamptz |   NO |                          |
| current_params_set_id | uuid        |   NO |                          |
| proposal_json         | jsonb       |   NO | 最大2変更                |
| rollback_json         | jsonb       |   NO | 条件                     |
| reasoning_log_path    | text        |   NO | ファイルパス             |
| reasoning_log_sha256  | text        |   NO | integrity                |
| status                | text        |   NO | pending/applied/rejected |
| decided_at            | timestamptz |  YES |                          |
| decided_by            | text        |  YES | executor                 |
| reject_reason         | text        |  YES |                          |

##### param_rollout（適用監査）

| Column                | Type        | Null | Notes                 |
| --------------------- | ----------- | ---: | --------------------- |
| id                    | uuid        |   NO | rollout_id            |
| ts                    | timestamptz |   NO | 適用/拒否時刻         |
| exchange              | text        |   NO |                       |
| symbol                | text        |   NO |                       |
| proposal_id           | uuid        |  YES | 手動ならnull          |
| from_params_set_id    | uuid        |   NO |                       |
| to_params_set_id      | uuid        |  YES | rejectならnull可      |
| action                | text        |   NO | apply/reject/rollback |
| reason                | text        |  YES |                       |
| metrics_snapshot_json | jsonb       |  YES | 任意                  |

### Requirement 13: LLM推論ログ（ファイル仕様）

**Objective:** As a 監査担当者, I want 推論ログが改ざん検知可能な形でファイル永続化されてほしい, so that 事後検証ができる

> 本MVPではスコープ外（将来拡張要件）。

#### Acceptance Criteria

- **13.1** The system shall `LOG_DIR` 配下に `llm/` を作成し、推論ログをそこへ保存する
- **13.2** The system shall filename を kebab-case とし、例：`llm-reflection-<exchange>-<symbol>-<utc-iso>-<proposal-id>.json` とする
- **13.3** The system shall ログ内容に `proposal_id`, `timestamp`, `input_summary`, `current_params`, `proposal`, `rollback_conditions`, `reasoning_trace[]`, `integrity.sha256` を含める
- **13.4** The system shall DB側に log_path と sha256 を保持し、整合性検証を可能にする

### Requirement 14: テスト要件と受入条件（Acceptance Criteria）

**Objective:** As a 開発者, I want unit/integrationでMVPの重要ロジックが検証できる, so that 本番事故を減らせる

#### Acceptance Criteria

- **14.1** The system shall `bun test` により unit test（DB不要）を提供する：strategy-engine、risk-policy、feature-computer、execution-planner（diff）
- **14.2** The system shall integration test（Postgres実DB）を提供する：schema→migrate、md*\* insert / latest*\* upsert、summarizerの fills_enriched生成（markout含む）
- **14.3** The system shall 受入条件として以下を満たす
  - **14.3.1** ingestorが10分以上継続保存し、切断→自動復帰し、`latest_top` が更新され続ける
  - **14.3.2** executorがpost-only 1レベル両建てを維持し、PAUSE条件で cancel*all が確実に走り、ex*\* がDBに残り、欠損時に quote しない
  - **14.3.3** summarizerが fills_enriched と markout(1s/10s/60s) を生成し、worst fills(top5) を抽出できる
  - **14.3.4** （Future）llm-reflectorが毎時提案を保存し、推論ログファイルと参照（path/hash）が残り、executorが apply/reject でき監査ログが残る
  - **14.3.5** backtestが任意期間をreplayでき、fills/PAUSE/擬似markoutを出力できる
