# Design Document

## Overview

本設計は `agentic-mm-bot` のMVPを、要件（`requirements.md`）から解釈ブレなく実装するための技術設計（HOW）を定義する。対象venue(v1)は Extended とし、coreは venue-agnostic（adapter差し替え可能）とする。

本MVPでは **LLMはスコープ外**とし、`apps/llm-reflector` を実装しない。後付けできるように、LLM関連は **Future Extension** に隔離して契約のみ保持する。

### Goals

- core（純粋ロジック）をI/O（DB/HTTP/WS/FS）から完全分離し、テスト容易性と差し替え容易性を担保する（2.1, 2.2, 2.3）
- **Hot path（メモリ/WS）** と **Cold path（DB）** を分離し、executorの意思決定はDB依存にしない（4.6, 4.10）
- executorは **イベント駆動 + スロットリング** でtickを実行し、RiskPolicyを最優先にして PAUSE/cancel_all を確実に実行する（4.9, 4.5, 5.2）
- fills_enriched と markout を **mid参照**で一貫計算し、毒性評価（markout）を監査可能な形で保存する（9.2）
- Extended 連携は **SDK/公式サンプル前提**で adapter に閉じ込め、署名/認証/制約を一箇所に集約する（2.3）

### Non-Goals

- L2 full orderbook、ニュース/SNS、複数取引所同時稼働、高度なqueue推定、RL（PPO/SAC）（1.6）
- LLMワーカー（`apps/llm-reflector`）の実装と運用（Future Extensionへ移動）

## Architecture

### Architecture Pattern & Boundary Map

選択パターンは **Hexagonal（Ports & Adapters）** とする。appsはcomposition rootとしてDIを担い、coreは純粋関数と型で意思決定を表現する。

```mermaid
flowchart LR
  subgraph Apps
    Ingestor
    Executor
    Summarizer
    Backtest
  end

  subgraph Core
    Domain
    Ports
  end

  subgraph Adapters
    ExtendedSdk
    MarketDataAdapter
    TradingAdapter
  end

  subgraph Runtime
    MarketDataCache
    FeatureEngine
    OrderTracker
    PositionTracker
    StrategyRuntime
    ExecutionPlanner
    EventWriter
  end

  subgraph Db
    DrizzleSchema
    Migrations
    Queries
  end

  subgraph Obs
    Logger
    Metrics
  end

  Apps --> Core
  Core --> Ports
  Adapters --> Ports

  Ingestor --> MarketDataAdapter
  Executor --> Runtime
  Runtime --> TradingAdapter
  MarketDataAdapter --> ExtendedSdk
  TradingAdapter --> ExtendedSdk

  Ingestor --> Db
  EventWriter --> Db
  Summarizer --> Db
  Backtest --> Db

  Apps --> Obs
```

### Technology Stack & Alignment

| Layer     | Choice                       | Role in Feature    | Notes                                                                                                                               |
| --------- | ---------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Runtime   | Bun                          | 実行/テスト        | `bun test`                                                                                                                          |
| Language  | TypeScript strict            | 実装               | coreはthrow禁止（1.3）                                                                                                              |
| DB        | Postgres（標準）             | 時系列/監査        | Drizzle schema + indexes（12.2）                                                                                                    |
| ORM       | Drizzle                      | schema SoT         | `packages/db` が唯一の正（1.2）                                                                                                     |
| Errors    | neverthrow                   | Result/ResultAsync | I/OはResultAsync（1.3）                                                                                                             |
| LLM       | Mastra                       | 将来拡張           | Future Extension（10.1–10.6, 13.1–13.4）                                                                                            |
| Venue SDK | Extended TypeScript examples | adapter実装        | env/運用注意の根拠: [Extended TypeScript examples](https://raw.githubusercontent.com/x10xchange/examples/main/typescript/README.md) |

## System Flows

### Ingestor flow

```mermaid
sequenceDiagram
  participant Ingestor
  participant MarketDataAdapter
  participant Db

  Ingestor->>MarketDataAdapter: Connect
  MarketDataAdapter-->>Ingestor: MarketEvents
  Ingestor->>Db: AppendMd
  Ingestor->>Db: UpsertLatest
```

### Executor tick flow（順序固定）

```mermaid
flowchart TD
  EventArrive --> UpdateCaches
  UpdateCaches --> TickGate
  TickGate -->|No| TickEnd
  TickGate -->|Yes| BuildSnapshot
  BuildSnapshot --> BuildFeatures
  BuildFeatures --> RiskEval
  RiskEval -->|Pause| CancelAll
  RiskEval -->|Ok| Decide
  Decide --> PlanDiff
  PlanDiff --> ExecutePlan
  ExecutePlan --> EnqueueEvents
  EnqueueEvents --> TickEnd
```

### Summarizer flow（fills_enriched + markout）

```mermaid
sequenceDiagram
  participant Summarizer
  participant Db

  Summarizer->>Db: ReadFills
  Summarizer->>Db: ReadBboT0
  Summarizer->>Db: ReadBboTd
  Summarizer->>Db: WriteEnriched
```

## Requirements Traceability

> 要件IDは `requirements.md` の **N.M** を正とする。

| Requirement | Summary                              | Components                                | Interfaces       | Flows      |
| ----------- | ------------------------------------ | ----------------------------------------- | ---------------- | ---------- |
| 1.1–1.5     | 技術前提/SoT/Result/env/MVPスコープ  | all                                       | env, Result      | all        |
| 2.1–2.4     | 境界（core純化/adapter隔離）         | Core, Adapters, Apps                      | Ports            | boundary   |
| 3.1–3.6     | ingestor + md間引き                  | Ingestor, MarketDataAdapter, Db           | MarketDataPort   | Ingestor   |
| 4.1–4.11    | executor（WS中心/非同期永続化/復旧） | Executor, Runtime, Domain, TradingAdapter | ExecutionPort    | Executor   |
| 5.1–5.7     | 状態機械/遷移                        | Domain                                    | ClockPort        | Executor   |
| 6.1–6.6     | 特徴量                               | Domain, Executor                          | MarketDataPort   | Executor   |
| 7.1–7.8     | クォート/更新                        | Domain, Executor                          | ExecutionPort    | Executor   |
| 8.1–8.3     | RiskPolicy                           | Domain                                    | TelemetryPort    | Executor   |
| 9.1–9.6     | summarizer                           | Summarizer, Db                            | AnalyticsStore   | Summarizer |
| 10.1–10.6   | LLM提案/ゲート/監査                  | FutureLlmReflector, Domain, Db, Fs        | ProposalPort     | Future     |
| 11.1–11.4   | backtest                             | Backtest, Domain                          | ExecutionPortSim | Backtest   |
| 12.1–12.4   | DB/Postgres + strategy_state         | Db                                        | migrations       | N/A        |
| 13.1–13.4   | 推論ログ                             | FutureLlmReflector, Fs, Db                | FileSinkPort     | Future     |
| 14.1–14.3.5 | テスト/受入                          | all                                       | N/A              | N/A        |

## Components and Interfaces

### Clean Structure (MVP) — Pure Core + Executor（LLM Workerなし）

MVPでは executor の責務を「read → decide → execute → persist」に集約し、`decision-cycle.ts` が一本道で読める構造を正とする。DBアクセスは repositories に分離し、取引所I/Oは **`packages/adapters` をそのままDI** する（= apps側に gateway 層は作らない）。必要になった段階で `apps/executor/gateways` を追加して adapter をラップしてもよい（2.1–2.3）。

```
.
├─ apps/
│  └─ executor/
│     └─ src/
│        ├─ main.ts
│        ├─ usecases/
│        │  └─ decision-cycle.ts
│        ├─ services/
│        │  ├─ execution-planner.ts
│        │  ├─ market-data-cache.ts
│        │  ├─ order-tracker.ts
│        │  ├─ position-tracker.ts
│        │  └─ proposal-applier.ts
│        ├─ repositories/
│        │  ├─ index.ts
│        │  └─ postgres/
│        │     ├─ event-repository.ts
│        │     ├─ proposal-repository.ts
│        │     └─ strategy-state-repository.ts
│        └─ __tests__/
│           ├─ unit/
│           └─ integration/
└─ packages/
   ├─ core/
   └─ adapters/
      └─ extended/
```

### packages/core（Pragmatic DDD / Clean Architecture）

#### Domain model（概念と不変条件）

- **Aggregate**: StrategySession（exchange+symbolの意思決定ループ）
  - **Invariants**:
    - PAUSE中はQUOTE intentを生成しない（5.1, 7.5）
    - すべての決定は reasonCodes を返す（監査/学習/テストの共通語彙）
    - 欠損/不明は error ではなく停止推奨として表現可能（6.6, 8.1）
- **Entity**: OpenOrdersState（既存注文の把握）
- **Value objects**: Bps, Ms, Side, Mode, PriceStr, SizeStr（浮動小数を排除）

#### Public contract（core）

```typescript
export type StrategyMode = "NORMAL" | "DEFENSIVE" | "PAUSE";

export type ReasonCode =
  | "DATA_STALE"
  | "MARK_INDEX_DIVERGED"
  | "LIQUIDATION_SPIKE"
  | "INVENTORY_LIMIT"
  | "DEFENSIVE_VOL"
  | "DEFENSIVE_TOX"
  | "POST_ONLY_REJECTED"
  | "PARAM_GATE_REJECTED";

export type OrderIntent =
  | { type: "CANCEL_ALL"; reasonCodes: ReasonCode[] }
  | {
      type: "QUOTE";
      bidPx: string;
      askPx: string;
      size: string;
      postOnly: true;
      reasonCodes: ReasonCode[];
    };

export interface DecideInput {
  nowMs: number;
  mode: StrategyMode;
  features: Features;
  params: StrategyParams;
  position: Position;
}

export interface DecideOutput {
  nextMode: StrategyMode;
  intents: OrderIntent[];
  reasonCodes: ReasonCode[];
}

export interface Snapshot {
  exchange: string;
  symbol: string;
  nowMs: number;
  bestBidPx: string;
  bestAskPx: string;
  markPx?: string;
  indexPx?: string;
  dataStale: boolean;
}

export interface Features {
  midPx: string;
  spreadBps: string;
  tradeImbalance1s: string;
  realizedVol10s: string;
  markIndexDivBps: string;
  liqCount10s: number;
}

export interface Position {
  size: string;
}

export interface StrategyParams {
  baseHalfSpreadBps: string;
  volSpreadGain: string;
  toxSpreadGain: string;
  quoteSizeBase: string;
  refreshIntervalMs: number;
  staleCancelMs: number;
  maxInventory: string;
  inventorySkewGain: string;
  pauseMarkIndexBps: string;
  pauseLiqCount10s: number;
}
```

> 具体の `features` / `params` は `packages/core` で厳密型に落とし込む（any禁止）。上は契約形の例であり、実装詳細ではない。

#### Ports（appsのDI点）

- `MarketDataPort`: 市場データの購読（public stream）と、Snapshot生成用の入力供給
- `AccountPort`: Position取得
- `ParamsPort`: 現行params取得（メモリキャッシュ可）と、変更時の永続化
- `ExecutionPort`: place/cancel/cancel_all/open_orders（private streamが無い場合の同期含む）
- `ClockPort`: 時刻/境界丸め
- `TelemetryPort`: カウンタ/トレース

### apps/executor（Runtime）

> Hot path（メモリ/WS）と Cold path（DB）を分離する（4.6, 4.10）。

#### MarketDataCache

| Field        | Detail                                                                   |
| ------------ | ------------------------------------------------------------------------ |
| Intent       | public market data の最新状態と短期trade履歴を保持し Snapshot 材料を提供 |
| Requirements | 4.1, 4.6, 6.1–6.5                                                        |
| Contracts    | State [x]                                                                |

**Responsibilities & Constraints**

- 最新BBO/mark/indexを保持する
- 直近10秒程度のtradesを保持する（feature計算の入力）

#### FeatureEngine

| Field        | Detail                                  |
| ------------ | --------------------------------------- |
| Intent       | rolling window から Features を生成する |
| Requirements | 4.2, 6.1–6.5                            |
| Contracts    | Service [x]                             |

##### Service Interface

```typescript
interface FeatureEngineService {
  compute(nowMs: number, snapshot: Snapshot): Features;
}
```

#### OrderTracker

| Field        | Detail                                                   |
| ------------ | -------------------------------------------------------- |
| Intent       | active orders をメモリ上で追跡し、plan diff の基準を提供 |
| Requirements | 4.6, 4.7, 4.8, 7.7                                       |
| Contracts    | State [x]                                                |

#### PositionTracker

| Field        | Detail                                                             |
| ------------ | ------------------------------------------------------------------ |
| Intent       | 最新ポジションを保持する（private stream優先、RESTフォールバック） |
| Requirements | 4.6, 4.7, 4.8                                                      |
| Contracts    | State [x]                                                          |

#### StrategyRuntime

| Field        | Detail                                                               |
| ------------ | -------------------------------------------------------------------- |
| Intent       | StrategyState を保持し、core.decide を呼んで mode/intents を更新する |
| Requirements | 5.1–5.7, 4.5                                                         |
| Contracts    | State [x]                                                            |

#### ExecutionPlanner

| Field        | Detail                                                                |
| ------------ | --------------------------------------------------------------------- |
| Intent       | intents と active orders から最小の実行計画（cancel/place）を生成する |
| Requirements | 7.7, 4.9                                                              |
| Contracts    | Service [x]                                                           |

#### EventWriter

| Field        | Detail                                                           |
| ------------ | ---------------------------------------------------------------- |
| Intent       | md/ex/decision を非同期にDBへappendし、hot path をブロックしない |
| Requirements | 4.10, 3.2, 4.4                                                   |
| Contracts    | Batch [x]                                                        |

### packages/db

- `strategy_state` を復旧用スナップショットとして永続化し、数秒〜数十秒間隔で更新可能にする（4.11, 12.4）

### packages/adapters/extended（SDK採用）

#### SDK採用根拠

公式サンプルは `.env.local` に `API_HOST`, `API_KEY`, `STARK_PRIVATE_KEY`, `VAULT_ID` を要求し、TESTNET/MAINNETのキー取得導線と運用注意（MAINNETでの注文/ポジションのキャンセル忘れ）を明記している。  
出典: [Extended TypeScript examples](https://raw.githubusercontent.com/x10xchange/examples/main/typescript/README.md)

#### adapter責務

- MarketDataAdapter: WS購読/再接続/正規化（3.1–3.5）
- TradingAdapter: post-only注文/取消/建玉取得（4.3, 7.5–7.8）
- 制約処理: tick/lot/min notional の丸めと事前検証
- エラー分類: Network, RateLimit, Auth, InvalidOrder, ExchangeDown, Invariant（8.2）

#### MarketDataAdapter WS購読・正規化仕様（3.1–3.6対応）

##### 参照ドキュメント（Extended Public WS）

- [Order book stream](https://api.docs.extended.exchange/#order-book-stream)
- [Trades stream](https://api.docs.extended.exchange/#trades-stream)
- [Funding rates stream](https://api.docs.extended.exchange/#funding-rates-stream)
- [Mark price stream](https://api.docs.extended.exchange/#mark-price-stream)
- [Index price stream](https://api.docs.extended.exchange/#index-price-stream)

##### SDK購読方式（PerpetualStreamClient）

```typescript
// connect → for-await で非同期ストリームを消費
const streamClient = new PerpetualStreamClient({ apiUrl: STREAM_URL });

const orderbookStream = streamClient.subscribeToOrderbooks({ marketName: SYMBOL, depth: 1 });
await orderbookStream.connect();
for await (const update of orderbookStream) {
  /* normalize & emit */
}
```

各ストリームは独立したfor-awaitループで購読し、切断/例外時は全ストリーム停止→指数バックオフ再接続を行う（3.4）。

##### WS message → Domain（正規化）変換仕様

###### 共通（Envelope）

| Field    | Description                                                  |
| -------- | ------------------------------------------------------------ |
| `ts`     | System generated timestamp (epoch ms)。domainの `raw` に残す |
| `seq`    | Monotonic sequence。不連続検知で再接続（3.5）                |
| `data.m` | Market name（例: `BTC-USD`）。domainでは `symbol` に変換     |

###### Order book stream（BBO用途：depth=1）

**WS message example:**

```json
{
  "ts": 1749073200000,
  "type": "SNAPSHOT",
  "data": { "m": "BTC-USD", "b": [{ "p": "97000.5", "q": "0.5" }], "a": [{ "p": "97001.0", "q": "0.3" }] },
  "seq": 12345
}
```

**Domain `BboEvent` 変換:**

| Domain field | Source         | 変換                  |
| ------------ | -------------- | --------------------- |
| `type`       | -              | `"bbo"`               |
| `exchange`   | config         | `"extended"`          |
| `symbol`     | `data.m`       | そのまま              |
| `ts`         | `envelope.ts`  | `new Date(ts)`        |
| `bestBidPx`  | `data.b[0].p`  | string（decimal表記） |
| `bestBidSz`  | `data.b[0].q`  | string（decimal表記） |
| `bestAskPx`  | `data.a[0].p`  | string（decimal表記） |
| `bestAskSz`  | `data.a[0].q`  | string（decimal表記） |
| `seq`        | `envelope.seq` | number                |
| `raw`        | envelope       | 監査用に保持          |

**補足:**

- depth=1購読では常にSNAPSHOT（10ms間隔）が来る想定
- DELTAが来た場合は仕様逸脱として `logger.warn` + 再接続

###### Trades stream

**WS message example:**

```json
{
  "ts": 1749073200000,
  "data": [{ "m": "BTC-USD", "S": "BUY", "tT": "TRADE", "T": 1749073199999, "p": "97000.5", "q": "0.1", "i": 987654 }],
  "seq": 12346
}
```

**Domain `TradeEvent` 変換（配列の各要素を1イベント化）:**

| Domain field | Source               | 変換                                                                          |
| ------------ | -------------------- | ----------------------------------------------------------------------------- |
| `type`       | -                    | `"trade"`                                                                     |
| `exchange`   | config               | `"extended"`                                                                  |
| `symbol`     | `item.m`             | そのまま                                                                      |
| `ts`         | `item.T`             | `new Date(T)` (trade occurred ts)                                             |
| `px`         | `item.p`             | string（decimal表記）                                                         |
| `sz`         | `item.q`             | string（decimal表記）                                                         |
| `side`       | `item.S`             | `"BUY"` → `"buy"`, `"SELL"` → `"sell"`                                        |
| `tradeType`  | `item.tT`            | `"TRADE"` → `"normal"`, `"LIQUIDATION"` → `"liq"`, `"DELEVERAGE"` → `"delev"` |
| `tradeId`    | `item.i`             | `String(i)`                                                                   |
| `seq`        | `envelope.seq`       | number                                                                        |
| `raw`        | `{ envelope, item }` | 監査用                                                                        |

**補足:**

- Trades streamではseq欠損はログのみ（docでskip可と明記）、即再接続しない

###### Funding rates stream

**WS message example:**

```json
{
  "ts": 1749073200000,
  "data": { "m": "BTC-USD", "T": 1749072000000, "f": "0.0001" },
  "seq": 12347
}
```

**Domain `FundingRateEvent` 変換（新設）:**

| Domain field  | Source         | 変換                                  |
| ------------- | -------------- | ------------------------------------- |
| `type`        | -              | `"funding"`                           |
| `exchange`    | config         | `"extended"`                          |
| `symbol`      | `data.m`       | そのまま                              |
| `ts`          | `data.T`       | `new Date(T)` (calculated+applied ts) |
| `fundingRate` | `data.f`       | string（decimal表記）                 |
| `seq`         | `envelope.seq` | number                                |
| `raw`         | envelope       | 監査用                                |

**扱い:**

- MVP要件の永続化テーブルにfundingが無いため、**DB保存しない**（受信・変換・ログ/メトリクスのみ）
- 将来 `md_funding_rate` 追加で保存可能

###### Mark price stream

**WS message example:**

```json
{
  "type": "MP",
  "data": { "m": "BTC-USD", "p": "97000.0", "ts": 1749073200000 },
  "ts": 1749073200001,
  "seq": 12348,
  "sourceEventId": null
}
```

**Domain `PriceEvent` 変換:**

| Domain field | Source         | 変換                                 |
| ------------ | -------------- | ------------------------------------ |
| `type`       | -              | `"price"`                            |
| `priceType`  | -              | `"mark"`                             |
| `exchange`   | config         | `"extended"`                         |
| `symbol`     | `data.m`       | そのまま                             |
| `ts`         | `data.ts`      | `new Date(ts)` (price calculated ts) |
| `markPx`     | `data.p`       | string（decimal表記）                |
| `indexPx`    | -              | `undefined`                          |
| `seq`        | `envelope.seq` | number                               |
| `raw`        | envelope       | 監査用                               |

###### Index price stream

**WS message example:**

```json
{
  "type": "IP",
  "data": { "m": "BTC-USD", "p": "97005.0", "ts": 1749073200000 },
  "ts": 1749073200001,
  "seq": 12349,
  "sourceEventId": null
}
```

**Domain `PriceEvent` 変換:**

| Domain field | Source         | 変換                                 |
| ------------ | -------------- | ------------------------------------ |
| `type`       | -              | `"price"`                            |
| `priceType`  | -              | `"index"`                            |
| `exchange`   | config         | `"extended"`                         |
| `symbol`     | `data.m`       | そのまま                             |
| `ts`         | `data.ts`      | `new Date(ts)` (price calculated ts) |
| `markPx`     | -              | `undefined`                          |
| `indexPx`    | `data.p`       | string（decimal表記）                |
| `seq`        | `envelope.seq` | number                               |
| `raw`        | envelope       | 監査用                               |

##### 再接続/seq破綻（3.4/3.5）

- 各streamはfor-awaitで独立ループ
- 例外・切断は**全ストリーム停止→指数バックオフ再接続**
- seq不連続検知:
  - orderbook/mark/index: **即再接続**
  - trades/funding: **欠損ログのみ**（docでskip可）

##### BBO間引き（3.6）

| Parameter            | Default | Description            |
| -------------------- | ------- | ---------------------- |
| `BBO_THROTTLE_MS`    | 100     | 最小書き込み間隔(ms)   |
| `BBO_MIN_CHANGE_BPS` | 1       | mid変化の最小閾値(bps) |

- いずれかを満たしたら `md_bbo` へappend
- `latest_top` は周期upsert（BBO毎の即時upsertは避ける）

##### MarketDataEvent Union型

```typescript
export type MarketDataEvent = BboEvent | TradeEvent | PriceEvent | FundingRateEvent;

export interface BboEvent {
  type: "bbo";
  exchange: string;
  symbol: string;
  ts: Date;
  bestBidPx: string;
  bestBidSz: string;
  bestAskPx: string;
  bestAskSz: string;
  seq: number;
  raw: unknown;
}

export interface TradeEvent {
  type: "trade";
  exchange: string;
  symbol: string;
  ts: Date;
  px: string;
  sz: string;
  side: "buy" | "sell";
  tradeType: "normal" | "liq" | "delev";
  tradeId: string;
  seq: number;
  raw: unknown;
}

export interface PriceEvent {
  type: "price";
  priceType: "mark" | "index";
  exchange: string;
  symbol: string;
  ts: Date;
  markPx?: string;
  indexPx?: string;
  seq: number;
  raw: unknown;
}

export interface FundingRateEvent {
  type: "funding";
  exchange: string;
  symbol: string;
  ts: Date;
  fundingRate: string;
  seq: number;
  raw: unknown;
}
```

## Data Models

### Physical Data Model

DBのテーブル定義は `requirements.md` の **12.1–12.4** と **Data Model Tables** を正とする。  
物理最適化（index/必要最小限のパーティショニング等）は migrations SQL に閉じ込める（12.3）。

## Error Handling

### Error Strategy

- I/O（DB/WS/REST/FS）は `ResultAsync<T, AppError>` を返す（1.3）
- core/domainは `Result<T, DomainError>` 相当で表現し、throwしない（1.3）
- 欠損/不明は DomainError ではなく RiskDecision（PAUSE推奨）に変換可能（6.6, 8.1）

## Testing Strategy

### Unit Tests（packages/core）

- RiskPolicy: PAUSE/DEFENSIVE/NORMALの遷移と優先順位（5.2）
- QuotePolicy: spread/tox/vol/skewの反映（7.2–7.4）
- Decide: PAUSE時はCANCEL_ALLのみ（7.5）
  - LLMはMVPスコープ外のため ParamGate は Future Extension で検証対象とする

### Integration Tests（packages/db + apps/summarizer）

- migrateが通る（12.3）
- md*\* insert / latest*\* upsert が成立（3.2, 3.3）
- fills_enriched の生成とmarkout計算が成立（9.1–9.3）

## Optional Sections

### Security Considerations

- `STARK_PRIVATE_KEY` は必須secretとして扱い、ログ出力禁止、t3-envで必須化する（1.4）
  - LLMワーカーを導入する場合の追加対策は Future Extension で定義する

### Performance & Scalability

- executorが毎tickでmd_tradeをDBから引く方式は負荷要因になりうる（6.1–6.5）
  - MVPはDBクエリで開始し、必要ならリングバッファへ移行する（設計上許容）

### Future Extension（LLM Worker）

MVPでは `apps/llm-reflector` を省略する。一方で、後日追加しても executor の構造が崩れないよう、以下は契約として保持する：

- `ProposalPort`: `llm_proposal` の生成/取得/ステータス更新（10.1–10.6）
- `FileSinkPort`: reasoning_trace のファイル永続化（失敗時は提案をDBへ保存しない）（13.1）
- `ParamGate`: changes<=2、±10%、運用ゲートの検証（10.2, 10.5）
