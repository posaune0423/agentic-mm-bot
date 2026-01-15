---

# agentic-mm-bot（Agentic Market Making Bot）

このリポジトリは、**複数プロセス（`apps/*`）**で動くマーケットメイク・ボットのモノレポです。中核ロジックは `packages/core` に閉じ込め（純関数）、DB・取引所接続・集計・LLM提案などの I/O は周辺へ分離します。

## 何が入っているか（ざっくり）

- **`apps/ingestor`**: BBO/Trade/Price を購読して `md_*` に追記、`latest_*` を upsert
- **`apps/executor`**: 戦略を実行して注文操作を行い、`ex_*` と状態を永続化
- **`apps/summarizer`**: `ex_fill` を enrich（markout 等）して `fills_enriched` を生成・集計
- **`apps/llm-reflector`**: 直近集計 + 現パラメータから改善案を生成（LLM）、推論ログ保存 + 提案をDB保存
- **`apps/backtest`**: `md_*` をリプレイして同じ戦略ロジックでシミュレーション

## ドキュメント

- **用語集**: `docs/taxonomy.md`

## 技術スタック

- **Runtime**: Bun
- **Language**: TypeScript
- **DB**: PostgreSQL
- **ORM**: Drizzle ORM（+ `pg`）
- **Error handling**: `neverthrow`（主に apps / adapters）
- **Env validation**: `@t3-oss/env-core`（多くの apps）、または Zod 直読み（`apps/llm-reflector`）
- **Monorepo**: Turborepo

## プロジェクト構造（パターン）

```
.
├── apps/
│   ├── ingestor/       # 市場データ収集 → md_* / latest_*
│   ├── executor/       # 戦略実行（注文）→ ex_* / strategy_state
│   ├── summarizer/     # fill を enrich / 集計 → fills_enriched
│   ├── llm-reflector/  # 集計から提案生成（LLM）→ llm_proposal
│   └── backtest/       # 過去データで検証
├── packages/
│   ├── core/           # 純戦略ロジック（I/Oなし）
│   ├── adapters/       # 取引所/データソース adapter（port + 実装）
│   ├── db/             # Drizzle schema（DBのSoT）
│   ├── utils/          # logger 等の共通
│   └── *-config/       # eslint/prettier/tsconfig 共有
└── .kiro/
    ├── steering/       # プロジェクト横断の指針
    └── specs/          # 機能ごとの仕様（Spec Driven）
```

## セットアップ

### 前提

- Bun（`package.json` の `packageManager` を参照）
- PostgreSQL（ローカル or Docker）

### 1) 依存関係を入れる

```bash
bun install
```

### 2) Postgres を起動（Docker を使う場合）

`docker-compose.yaml` は Postgres サービスを定義しています。

```bash
docker-compose up -d postgres
```

### 3) スキーマ反映（Drizzle）

```bash
bun run db:push
```

### 4) 環境変数を設定

各ディレクトリの `.env.example` から `.env` を生成します。

```bash
bun run setup-env
```

生成後、秘匿情報（API キー等）を適切な値に置き換えてください。

既存の `.env` を上書きする場合:

```bash
bun run setup-env --force
```

### 5) 各プロセスを起動

- **Turborepo 経由**（推奨）:

```bash
bun run dev --filter=@agentic-mm-bot/ingestor
bun run dev --filter=@agentic-mm-bot/executor
```

- **直接起動**（確実）:

```bash
bun --cwd apps/ingestor run dev
bun --cwd apps/executor run dev
```

必要に応じて `apps/summarizer`（定期実行）や `apps/llm-reflector`（1時間ごと）も起動してください。

## よく使うコマンド

```bash
# Setup
bun run setup-env           # 各 app/package に .env を生成
bun run setup-env --force   # 既存の .env を上書き
bun run setup-env --dry-run # 実行内容を確認（書き込みなし）

# Code Quality
bun run format:fix
bun run lint:fix
bun run typecheck

# Tests
bun run test
```

## Extended（ストリーム / SDK）注意点

- **SDK のバージョン差分**により、`markPrice` / `indexPrice` の購読メソッドが型定義・実装に存在しないことがあります。
- そのため `packages/adapters/src/extended/market-data-adapter.ts` は **feature-detect** し、未対応の場合は該当ストリームを **自動で無効化**して（warn を出して）他の購読を継続します。
- `markPrice` / `indexPrice` が必要な場合は、利用している `extended-typescript-sdk` の版を見直してください。

## 環境変数

### 構成

```
.
├── .env.example          # グローバル変数テンプレート
├── .env                  # グローバル変数（turbo が全タスクで読み込み）
└── apps/
    ├── executor/
    │   ├── .env.example  # executor 固有変数テンプレート
    │   └── .env          # executor 固有変数
    └── ...
```

### グローバル変数（`root/.env`）

| 変数           | 説明                | 例                                              |
| -------------- | ------------------- | ----------------------------------------------- |
| `DATABASE_URL` | PostgreSQL 接続 URL | `postgresql://dev:insecure@localhost:5432/main` |

`turbo.json` の `globalDotEnv` により、全タスクで自動的に読み込まれます。

### アプリ固有変数

各 `apps/*/.env.example` を参照してください。主な変数:

| アプリ               | 主な変数                                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| `apps/ingestor`      | `EXTENDED_*`, `BBO_*`, `INGESTOR_DASHBOARD_*`                                |
| `apps/executor`      | `EXTENDED_*`, `TICK_INTERVAL_MS`, `PROPOSAL_APPLY_*`, `EXECUTOR_DASHBOARD_*` |
| `apps/llm-reflector` | `MODEL`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `REFLECTION_WINDOW_MINUTES`  |
| `apps/summarizer`    | `RUN_INTERVAL_MS`                                                            |
| `apps/backtest`      | `TICK_INTERVAL_MS`                                                           |

### バリデーション

各 app は `apps/<app>/src/env.ts` で **起動時にバリデーション**します。

- 原則: **`process.env` を直接参照しない**（`env` / `loadEnv()` を使う）
- `apps/llm-reflector` は Zod による `safeParse` を使っており、検証失敗時は例外で停止します

## 開発フロー（AI-DLC）

- Steering: `.kiro/steering/*`
- Specs: `.kiro/specs/*`
- 仕様→設計→タスク→実装 の順で進めます（詳細は `AGENTS.md` 参照）
