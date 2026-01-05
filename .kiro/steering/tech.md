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
