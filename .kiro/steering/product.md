# プロダクト概要（Steering）

このリポジトリは **Agentic Market Making Bot（自律運用するマーケットメイク・ボット）** のためのモノレポです。戦略ロジック（純関数）を中心に、取引所接続・データ蓄積・集計・パラメータ提案（LLM）・実行を **分離したプロセス群**で構成します。

## 目的（何を達成するか）

- **リアルタイムに板/約定/価格を観測**し、一定ルールに基づいてメーカー注文を提示/更新する
- 市場や在庫状況に応じて **安全側に倒すモード遷移**（例: NORMAL → DEFENSIVE → PAUSE）を行い、破綻を避ける
- 実運用のイベント（fill/cancel/pause 等）を蓄積し、**後段で分析できる形に整形**する
- 分析結果を元に、パラメータ改善案を **LLMで生成**しつつ、**ガード（ParamGate/運用ゲート）**で安全に適用する

## コア能力（重要な機能）

- **戦略意思決定（純関数）**: 特徴量 → リスク評価 → モード/インテント（QUOTE/CANCEL_ALL）を決定
- **実行（Executor）**: インテントを実際の注文操作へ変換し、イベントを記録する
- **データ収集（Ingestor）**: BBO/Trade/Price を時系列に蓄積し、最新値を upsert する
- **集計（Summarizer）**: fill を enrich し、markout 等の指標を算出して LLM 入力に使える形へ
- **提案（LLM Reflector）**: 直近ウィンドウの集計と現パラメータから提案を作り、ログとDBへ保存する
- **検証（Backtest）**: 過去データのリプレイで戦略ロジックを評価する

## プロセス（apps）の役割分担（パターン）

- **`apps/ingestor`**: マーケットデータを購読し `md_*` に追記、`latest_*` を upsert
- **`apps/executor`**: 戦略を実行し、注文/約定イベントを `ex_*` に記録、状態を永続化
- **`apps/summarizer`**: `ex_fill` + `md_bbo` 等から `fills_enriched` を生成し、集計/最悪fill抽出
- **`apps/llm-reflector`**: 集計 + 現パラメータから提案生成、推論ログをファイル保存、提案をDBに保存
- **`apps/backtest`**: `md_*` をリプレイし、同一の `core` ロジックでシミュレーション/指標出力

## 非目標（明示的にやらないこと）

- **単一のHTTP APIサーバを前提にしない**（各 app は CLI/常駐プロセスとして動く）
- **戦略ロジックに I/O を混ぜない**（I/O は app / adapter / repository 側に閉じる）
- **例外で通常系の制御をしない**（Result 型やガードで扱う）

## 注意（コードと周辺ファイルのドリフト）

- ルートの README や `docker-compose.yaml` に **存在しない `apps/server`** への言及がある場合があります。運用の実態は `apps/{executor,ingestor,summarizer,llm-reflector,backtest}` を中心に捉え、必要に応じて別途整備してください。

---

## 旧内容（Legacy / 参考）

以下は過去のテンプレート/別プロダクト想定の記述が残っている可能性があります。**現行の Source of Truth はこのファイル上部**（「プロダクト概要（Steering）」以降）です。

# Product Steering

## Purpose

A production-ready template for building backend APIs using Bun runtime, Hono framework, and Domain-Driven Design (DDD) principles. Designed as a starting point for monorepo projects that prioritize type safety, testability, and clean architecture.

## Value Proposition

- **Fast Development**: Bun runtime provides native TypeScript support and fast execution
- **Type Safety**: End-to-end type safety from database schema to API responses
- **Testability**: Dependency injection pattern enables easy unit testing without complex mocking
- **Clean Architecture**: DDD layering ensures maintainable, scalable codebase
- **Monorepo Ready**: Turborepo setup for managing multiple packages and apps

## Core Capabilities

### API Layer

- RESTful endpoints using Hono framework
- Request validation with Zod schemas
- Consistent error handling with Problem Details format
- CORS and logging middleware

### Domain Logic

- Domain-driven design with clear layer boundaries
- Result-based error handling (neverthrow) - no exceptions for business logic
- Shared domain error types with discriminated unions
- Value objects and entities following DDD patterns

### Data Persistence

- PostgreSQL database with Drizzle ORM
- Repository pattern for data access abstraction
- Type-safe database schemas with inferred types
- Soft delete support (deletedAt pattern)

### Developer Experience

- Hot reload development server
- TypeScript strict mode
- ESLint with architecture enforcement rules
- Prettier for code formatting
- Comprehensive test setup

## Target Use Cases

- Backend APIs requiring type safety and maintainability
- Projects needing clear separation of concerns
- Teams adopting DDD practices
- Monorepo architectures with shared packages
