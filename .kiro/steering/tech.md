# 技術方針（Steering）

このプロジェクトは **Bun + TypeScript** をベースに、モノレポ（Turborepo）で複数の実行プロセス（apps）と共有ライブラリ（packages）を管理します。重要なのは「純粋な戦略ロジック」と「I/O・インフラ」を分離することです。

## 実行環境 / ツールチェーン

- **Runtime**: Bun（TypeScriptを直接実行）
- **Language**: TypeScript（型安全を前提に実装）
- **Monorepo**: Turborepo（`bun run dev|build|test|lint|typecheck` を横断実行）
- **Lint/Format**: ESLint / Prettier（共有設定を packages として持つ）

## 主要ライブラリ / 技術選定（パターン）

- **DB**: PostgreSQL
- **ORM/Query**: Drizzle ORM（`drizzle-orm/node-postgres`）+ `pg`（Pool）
- **Env**: `@t3-oss/env-core` による **起動時バリデーション**
  - 原則: `process.env` を直接参照せず、`env` / `loadEnv()` を通す
- **Error Handling**: `neverthrow`（`Result` / `ResultAsync`）
  - 原則: 予期できる失敗は Result で返し、例外は最外周で捕捉する
- **Logging**: `@agentic-mm-bot/utils` の logger を使用（`console.log` は使わない）

## アーキテクチャ原則（重要）

- **`packages/core` は純関数**:
  - DB/HTTP/WS/FS など I/O に依存しない
  - 通常系で例外を投げない（pure + deterministic を維持）
- **外部依存は Port/Adapter で抽象化**:
  - `packages/adapters` が `ports/*` を公開し、venue実装（例: extended）を提供する
- **アプリ（apps）は composition root**:
  - `src/main.ts` で env / logger / DB / adapter / repository を組み立てて実行する

## コーディング規約（抜粋）

- **ファイル名**: kebab-case（例: `decision-cycle.ts`）
- **ネスト回避**: 早期リターンで読みやすさを優先
- **Optional chaining**: `?.` / `??` を活用し冗長化を避ける
- **テスト容易性**: 外部依存は注入し、ユニットテストで差し替え可能に

---

## 旧内容（Legacy / 参考）

以下は過去のテンプレート/別プロダクト想定の記述が残っている可能性があります。**現行の Source of Truth はこのファイル上部**（「技術方針（Steering）」以降）です。

# Technology Steering

## Runtime & Framework

**Bun**: Primary runtime environment

- Native TypeScript support (no compilation step)
- Fast HTTP server capabilities
- Built-in test runner
- Hot reload for development (`bun run --hot`)

**Hono**: Web framework

- Lightweight and fast
- TypeScript-first design
- Middleware ecosystem (cors, logger)
- Context-based request handling

## Language & Type System

**TypeScript**: Strict mode enabled

- Native TypeScript preview (`@typescript/native-preview`)
- Type inference from Zod schemas
- Discriminated unions for error types
- Branded types pattern support

## Database & ORM

**PostgreSQL**: Primary database

- Connection pooling with `pg` library
- Drizzle ORM for type-safe queries
- Schema definitions in `packages/db`
- Migration support via Drizzle

**Drizzle ORM**: Type-safe database access

- Schema-first approach
- Type inference from schema
- Query builder API
- CUID2 for ID generation

## Error Handling

**neverthrow**: Result-based error handling

- `Result<T, E>` type for explicit error handling
- No exceptions for business logic
- Composable error chains
- Type-safe error propagation

## Validation

**Zod**: Schema validation

- Runtime type checking
- Input validation at API boundaries
- Type inference from schemas
- Detailed error messages

## Monorepo Tooling

**Turborepo**: Build system and task runner

- Task caching and parallelization
- Workspace dependency management
- Task dependencies (`dependsOn`)
- Remote caching support

**Bun Workspaces**: Package management

- Workspace protocol (`workspace:*`)
- Catalog pattern for dependency versions
- Shared tooling packages

## Code Quality

**ESLint**: Linting with architecture rules

- Dependency direction enforcement
- Layer boundary protection
- Custom rules for DDD compliance

**Prettier**: Code formatting

- OXC plugin for formatting
- Import organization plugin
- Consistent code style

## Testing

**Bun Test**: Built-in test framework

- No additional test runner needed
- Fast test execution
- Mock support via dependency injection

## Development Patterns

### Dependency Injection

- All external dependencies injected as parameters
- Enables testability without complex mocking
- Factory functions for creating instances

### Result Types

- All domain operations return `Result<T, E>`
- No exceptions thrown in business logic
- Explicit error handling at boundaries

### Repository Pattern

- Interface definitions in `repositories/`
- Implementations in `infra/`
- Database-agnostic domain layer
