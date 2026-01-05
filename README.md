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

### 4) 各プロセスを起動

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

## 環境変数（重要）

各 app は `apps/<app>/src/env.ts` で **起動時にバリデーション**します。

- 原則: **`process.env` を直接参照しない**（`env` / `loadEnv()` を使う）
- `apps/llm-reflector` は Zod による `safeParse` を使っており、検証失敗時は例外で停止します

最低限よく使うもの（例）:

- **共通**: `DATABASE_URL`, `EXCHANGE`, `SYMBOL`, `LOG_LEVEL`
- **extended 接続**: `EXTENDED_NETWORK`, `EXTENDED_API_KEY`, `EXTENDED_STARK_PRIVATE_KEY`, `EXTENDED_STARK_PUBLIC_KEY`, `EXTENDED_VAULT_ID`
- **LLM**（`apps/llm-reflector`）: `OPENAI_API_KEY`, `OPENAI_MODEL`, `LOG_DIR`

## 開発フロー（AI-DLC）

- Steering: `.kiro/steering/*`
- Specs: `.kiro/specs/*`
- 仕様→設計→タスク→実装 の順で進めます（詳細は `AGENTS.md` 参照）

---

## 旧内容（Legacy / 参考）

以下は過去テンプレートの README です。**現行の Source of Truth はこのファイル上部**です。

# Bun + Hono + DDD Template

A production-ready template for building backend APIs using Bun runtime, Hono framework, and Domain-Driven Design (DDD) principles. Designed as a starting point for monorepo projects that prioritize type safety, testability, and clean architecture.

## Features

- 🚀 **Fast Development**: Bun runtime with native TypeScript support and hot reload
- 🔒 **Type Safety**: End-to-end type safety from database schema to API responses
- 🧪 **Testability**: Dependency injection pattern enables easy unit testing
- 🏗️ **Clean Architecture**: DDD layering with strict dependency rules
- 📦 **Monorepo Ready**: Turborepo setup for managing multiple packages and apps
- 🛡️ **Result-based Error Handling**: neverthrow for explicit error handling
- ✅ **Schema Validation**: Zod for runtime type checking at API boundaries

## Tech Stack

### Core

- **Runtime**: [Bun](https://bun.sh/) - Fast JavaScript runtime with native TypeScript support
- **Framework**: [Hono](https://hono.dev/) - Lightweight, fast web framework
- **Database**: [PostgreSQL](https://www.postgresql.org/) with [Drizzle ORM](https://orm.drizzle.team/)
- **Language**: [TypeScript](https://www.typescriptlang.org/) (strict mode)

### Key Libraries

- **neverthrow**: Result-based error handling
- **Zod**: Schema validation and type inference
- **CUID2**: Collision-resistant IDs
- **@t3-oss/env-core**: Type-safe environment variable validation

### Tooling

- **Turborepo**: Build system and task runner
- **ESLint**: Linting with architecture enforcement
- **Prettier**: Code formatting with OXC plugin
- **Bun Test**: Built-in test framework

## Project Structure

```
.
├── apps/
│   └── server/              # Main API server
│       ├── src/
│       │   ├── routes/      # HTTP endpoints
│       │   ├── usecases/    # Business logic
│       │   ├── repositories/ # Data access layer
│       │   │   ├── interfaces/  # Repository contracts
│       │   │   ├── postgres/    # PostgreSQL implementations
│       │   │   └── memory/      # In-memory implementations (testing)
│       │   ├── domain/      # Domain models and errors
│       │   ├── types/       # Shared type definitions
│       │   └── utils/       # Utility functions
│       └── tests/
│           ├── unit/        # Unit tests
│           └── integration/ # Integration tests
├── packages/
│   ├── db/                  # Database schema and migrations
│   ├── eslint-config/       # Shared ESLint configurations
│   ├── prettier-config/     # Shared Prettier configuration
│   ├── typescript-config/   # Shared TypeScript configurations
│   └── utils/               # Shared utilities (logger, etc.)
└── .kiro/                   # AI-DLC development steering
    ├── steering/            # Project-wide context and rules
    └── settings/            # Spec-driven development templates
```

## Environment Variables

This project uses [t3-env](https://env.t3.gg/) for type-safe environment variable management.

### Configuration

All environment variables are defined and validated in `apps/server/src/env.ts`. **Never use `process.env` directly** in your code - always import and use the `env` object instead.

```typescript
import { env } from "./env";

// ✅ Good: Type-safe and validated
const port = env.PORT;
const dbUrl = env.DATABASE_URL;

// ❌ Bad: No type safety or validation
const port = process.env.PORT;
```

### Available Variables

| Variable       | Type                                    | Default                                                | Description               |
| -------------- | --------------------------------------- | ------------------------------------------------------ | ------------------------- |
| `DATABASE_URL` | URL string                              | `postgres://postgres:postgres@localhost:5432/postgres` | PostgreSQL connection URL |
| `PORT`         | Positive integer                        | `8787`                                                 | Server port number        |
| `NODE_ENV`     | `development` \| `production` \| `test` | `development`                                          | Node environment          |

### Adding New Variables

1. Define the variable in `apps/server/src/env.ts`:

```typescript
export const env = createEnv({
  server: {
    // Add your new variable here
    MY_API_KEY: z.string().min(1).describe("My API key"),
  },
  // ... rest of config
});
```

2. Use it in your code:

```typescript
import { env } from "./env";

const apiKey = env.MY_API_KEY; // Type-safe!
```

### Validation

Environment variables are validated at startup. If validation fails, the application will exit with a clear error message:

```bash
❌ Invalid environment variables:
  - PORT: Invalid input: expected number, received NaN
```

## Architecture

This template follows a **Layered DDD Architecture** with strict dependency direction:

```
routes → usecases → repositories → domain
         ↓
      repositories/{provider} (implements interfaces)
```

### Layer Responsibilities

- **routes/**: HTTP endpoints, request/response handling, input parsing
- **usecases/**: Business logic orchestration, coordinates repositories
- **repositories/interfaces/**: Data access interfaces (contracts)
- **repositories/{provider}/**: Infrastructure implementations (postgres, memory)
- **domain/**: Core business logic, value objects, entities, shared errors
- **types/**: Shared type definitions
- **utils/**: Utility functions

See [`.kiro/steering/structure.md`](.kiro/steering/structure.md) for detailed architecture documentation.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.3.5
- [Node.js](https://nodejs.org/) >= 24.0.0
- [PostgreSQL](https://www.postgresql.org/) (for production)
- [Docker](https://www.docker.com/) (optional, for local PostgreSQL)

### Installation

```bash
# Install dependencies
bun install

# Start PostgreSQL (using Docker)
docker-compose up -d

# Push database schema
bun run db:push

# Start development server
bun run dev
```

The API server will be available at `http://localhost:3000`.

### Available Scripts

```bash
# Development
bun run dev              # Start all apps in development mode
bun run dev --filter=server  # Start specific app

# Building
bun run build            # Build all apps and packages

# Testing
bun run test             # Run all tests
bun run test:unit        # Run unit tests only
bun run test:integration # Run integration tests only

# Code Quality
bun run lint             # Lint all packages
bun run lint:fix         # Fix linting issues
bun run format           # Check code formatting
bun run format:fix       # Fix code formatting
bun run typecheck        # Type check all packages

# Database
bun run db:generate      # Generate migrations
bun run db:push          # Push schema to database
bun run db:studio        # Open Drizzle Studio

# Utilities
bun run clean            # Clean build artifacts and node_modules
```

## Development Workflow

This project uses **AI-DLC (AI Development Life Cycle)** with Kiro-style Spec-Driven Development.

### Key Concepts

- **Steering** (`.kiro/steering/`): Project-wide rules and context that guide AI
  - `product.md`: Product vision and capabilities
  - `tech.md`: Technology stack and patterns
  - `structure.md`: Architecture and code organization

- **Specs** (`.kiro/specs/`): Feature-specific development specifications
  - Requirements → Design → Tasks → Implementation workflow
  - Human review required at each phase

### Development Phases

1. **Phase 0 (Optional)**: Review steering documents
2. **Phase 1 (Specification)**:
   - Initialize spec with `/kiro/spec-init "description"`
   - Define requirements with `/kiro/spec-requirements {feature}`
   - Design solution with `/kiro/spec-design {feature}`
   - Generate tasks with `/kiro/spec-tasks {feature}`
3. **Phase 2 (Implementation)**: Implement with `/kiro/spec-impl {feature}`

See workspace rules for detailed workflow.

## Testing Strategy

### Unit Tests

- Test individual functions and usecases in isolation
- Use dependency injection for test doubles
- Located in `tests/unit/`

### Integration Tests

- Test API endpoints with real dependencies
- Use in-memory repositories or test database
- Located in `tests/integration/`

### Test Helpers

- `tests/helpers/memory.ts`: In-memory repository factories
- `tests/helpers/postgres.ts`: PostgreSQL test utilities

## Code Quality

### Type Safety

- TypeScript strict mode enabled
- Type inference from Zod schemas
- Discriminated unions for error types
- Branded types pattern support

### Architecture Enforcement

- ESLint rules enforce layer boundaries
- Dependency direction validation
- Custom rules for DDD compliance

### Error Handling

- Result-based error handling with neverthrow
- No exceptions for business logic
- Domain errors with discriminated unions
- HTTP error mapping at route layer

## Contributing

1. Follow the established architecture patterns
2. Write tests for new features
3. Ensure all checks pass: `bun run typecheck && bun run lint && bun run test`
4. Use the AI-DLC workflow for new features

## License

MIT

## Resources

### Documentation

- [Bun Documentation](https://bun.sh/docs)
- [Hono Documentation](https://hono.dev/)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)
- [neverthrow Documentation](https://github.com/supermacro/neverthrow)
- [Turborepo Documentation](https://turborepo.com/)

### Project Steering

- [Product Vision](.kiro/steering/product.md)
- [Technology Stack](.kiro/steering/tech.md)
- [Architecture Guide](.kiro/steering/structure.md)
