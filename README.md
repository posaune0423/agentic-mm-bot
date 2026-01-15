# agentic-mm-bot（Agentic Market Making Bot）

このリポジトリは、**複数プロセス（`apps/*`）**で動くマーケットメイク・ボットのモノレポです。中核ロジックは `packages/core` に閉じ込め（純関数）、DB・取引所接続・集計・LLM提案などの I/O は周辺へ分離します。

## 何が入っているか（ざっくり）

- **`apps/ingestor`**: BBO/Trade/Price を購読して `md_*` に追記、`latest_*` を upsert
- **`apps/executor`**: 戦略を実行して注文操作を行い、`ex_*` と状態を永続化
- **`apps/summarizer`**: `ex_fill` を enrich（markout 等）して `fills_enriched` を生成・集計
- **`apps/llm-reflector`**: 直近集計 + 現パラメータから改善案を生成（LLM）、推論ログ保存 + 提案をDB保存
- **`apps/backtest`**: `md_*` をリプレイして同じ戦略ロジックでシミュレーション

## ドキュメント

- **用語集 / パラメータ**: `docs/taxonomy.md`（`quote` / `skew` / `baseHalf` / `rollbackConditions` など、repo内の用語と略語の対応）

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

### 3) 環境変数（dotenvx）

このリポジトリでは [dotenvx](https://dotenvx.com/) を使用して暗号化された dotenv ファイルで環境変数を管理します。

- **ローカル開発**: `.encrypted.local`
- **本番**: 実行環境の env（推奨）または別ファイル（例: `.encrypted` / `.encrypted.prod`）を運用ポリシーに合わせて用意してください。

#### 新規参加者

1. 管理者から復号鍵（`DOTENV_PRIVATE_KEY`）を受け取る
2. リポジトリルートに `.env.keys` ファイルを作成し、鍵を記載する:

```ini
# .env.keys（絶対にコミットしない）
DOTENV_PRIVATE_KEY="受け取った鍵"
```

これで `bun run dev` 等のコマンドが自動的に `.encrypted.local` を復号して実行します（デフォルト）。

#### 環境変数の更新（管理者向け）

```bash
# 値を追加・更新
dotenvx set KEY value -f .encrypted.local

# 暗号化を再適用（平文で編集した後）
dotenvx encrypt -f .encrypted.local

# 変更をコミット
git add .encrypted.local && git commit -m "chore: update env vars"
```

### 4) スキーマ反映（Drizzle）

```bash
bun run db:push
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
# Code Quality
bun run format:fix
bun run lint:fix
bun run typecheck

# Tests
bun run test

# 環境変数（dotenvx）
dotenvx set KEY value -f .encrypted.local  # 暗号化して値を設定
dotenvx encrypt -f .encrypted.local        # .encrypted.local を暗号化
dotenvx decrypt -f .encrypted.local        # .encrypted.local を復号（確認用）
```

## まず読むと迷いにくいポイント（用語・略語）

- **quote（クオート）**: 板に出す指値の提示（bid/ask の注文）。repo内では `QUOTE` intent や “差し替え（update）” を指すこともあります。
- **skew**: 在庫（ポジション）に応じて quote 全体を平行移動させるシフト量（bps）。
- **baseHalf**: `baseHalfSpreadBps` の CLI 表示上の略称。

詳しい定義と数式、CLI ダッシュボード上の `DB/Eff/Tighten/overlay` などの表示語は `docs/taxonomy.md` を参照してください。

## Extended（ストリーム / SDK）注意点

- **SDK のバージョン差分**により、`markPrice` / `indexPrice` の購読メソッドが型定義・実装に存在しないことがあります。
- そのため `packages/adapters/src/extended/market-data-adapter.ts` は **feature-detect** し、未対応の場合は該当ストリームを **自動で無効化**して（warn を出して）他の購読を継続します。
- `markPrice` / `indexPrice` が必要な場合は、利用している `extended-typescript-sdk` の版を見直してください。

## 環境変数

### 構成（dotenvx）

```text
.
├── .encrypted.local      # 暗号化済み環境変数（ローカル用）
├── .env.keys             # 復号鍵（Git 管理外、.gitignore 済み）
└── apps/
    └── <app>/src/env.ts  # 各アプリのバリデーション定義
```

### 主な環境変数

| 変数                         | 説明                     | 使用アプリ         |
| ---------------------------- | ------------------------ | ------------------ |
| `DATABASE_URL`               | PostgreSQL 接続 URL      | 全アプリ           |
| `EXTENDED_NETWORK`           | testnet / mainnet        | ingestor, executor |
| `EXTENDED_API_KEY`           | Extended 取引所 API キー | ingestor, executor |
| `EXTENDED_STARK_PRIVATE_KEY` | Stark 署名用秘密鍵       | ingestor, executor |
| `OPENAI_API_KEY`             | OpenAI API キー          | llm-reflector      |
| `ANTHROPIC_API_KEY`          | Anthropic API キー       | llm-reflector      |

詳細は各 `apps/<app>/src/env.ts` のスキーマ定義を参照してください。

### バリデーション

各 app は `apps/<app>/src/env.ts` で **起動時にバリデーション**します。

- 原則: **`process.env` を直接参照しない**（`env` / `loadEnv()` を使う）
- `apps/llm-reflector` は Zod による `safeParse` を使っており、検証失敗時は例外で停止します

### 鍵のローテーション

```bash
# 新しい鍵ペアで再暗号化
dotenvx encrypt -f .encrypted.local --rotate

# 新しい .env.keys を安全に配布し、古い鍵を無効化する
```

### 実行時に参照する暗号化ファイルの切り替え（本番/別環境）

スクリプトはローカル向けに `.encrypted.local` を固定参照します。別環境では、必要なコマンドを明示的に `-f` で指定して実行してください。

```bash
# 例: 本番用ファイルを参照して起動（手動で dotenvx run を使う）
dotenvx run -f ../../.encrypted -fk ../../.env.keys -- bun --cwd apps/executor run dev
```

## 開発フロー（AI-DLC）

- Steering: `.kiro/steering/*`
- Specs: `.kiro/specs/*`
- 仕様→設計→タスク→実装 の順で進めます（詳細は `AGENTS.md` 参照）
