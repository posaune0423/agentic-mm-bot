# Structure Steering

> **Last Updated**: 2025-12-30  
> **Changes**: Updated repository structure to reflect actual implementation (interfaces/, postgres/, memory/ subdirectories)

## Architecture Pattern

**Layered DDD Architecture** with strict dependency direction:

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
- **types/**: Shared type definitions (HTTP errors, etc.)
- **utils/**: Utility functions (error handling, etc.)

### Dependency Rules

- Domain layer must NOT import from routes, usecases, or repository implementations
- Routes should use usecases, not domain directly (soft rule)
- Usecases depend on repository interfaces, not implementations
- Repository implementations (postgres, memory) implement repository interfaces
- Utils and types are shared across layers

## Directory Organization

### Application Structure (`apps/server/src/`)

```
src/
├── app.ts              # Application assembly, route mounting
├── server.ts           # Server entry point
├── routes/             # HTTP route handlers
│   ├── index.ts        # Route aggregation
│   ├── health.ts       # Health check endpoint
│   └── {resource}.ts   # Resource-specific routes
├── usecases/           # Business logic usecases
│   └── {action}-{resource}/
│       ├── index.ts    # Public exports
│       ├── input.ts    # Input validation schema
│       └── usecase.ts  # Usecase implementation
├── repositories/       # Repository layer
│   ├── interfaces/     # Repository interfaces (contracts)
│   │   ├── index.ts
│   │   └── {resource}-repository.ts
│   ├── postgres/       # PostgreSQL implementations
│   │   ├── db.ts       # Database connection
│   │   ├── index.ts
│   │   └── {resource}-repository.ts
│   └── memory/         # In-memory implementations (for testing)
│       ├── index.ts
│       └── {resource}-repository.ts
├── domain/             # Domain layer
│   ├── index.ts
│   └── errors.ts       # Domain error types
├── types/              # Shared type definitions
│   └── http-error.ts   # HTTP error types
└── utils/              # Utility functions
    └── http-error.ts   # Error handling utilities
```

### Package Structure (`packages/`)

- **db/**: Database schema definitions, Drizzle config
- **eslint-config/**: Shared ESLint configurations
- **prettier-config/**: Shared Prettier configuration
- **typescript-config/**: Shared TypeScript configurations
- **utils/**: Shared utilities (logger, etc.)

## Naming Conventions

### Files & Directories

- **Routes**: `{resource}.ts` (e.g., `posts.ts`, `users.ts`)
- **Usecases**: `{action}-{resource}/` directory (e.g., `create-post/`)
- **Repository Interfaces**: `interfaces/{resource}-repository.ts` (e.g., `interfaces/post-repository.ts`)
- **Repository Implementations**: `{provider}/{resource}-repository.ts` (e.g., `postgres/post-repository.ts`, `memory/post-repository.ts`)

### Functions & Types

- **Usecase execution**: `execute{Action}{Resource}` (e.g., `executeCreatePost`)
- **Input parsing**: `parse{Action}{Resource}Input` (e.g., `parseCreatePostInput`)
- **Factory functions**: `create{Thing}` (e.g., `createPostgresPostRepository`)
- **Error factories**: `{errorType}Error` (e.g., `notFoundError`, `validationError`)
- **Interfaces**: PascalCase (e.g., `PostRepository`, `CreatePostInput`)
- **Types**: PascalCase (e.g., `PostRepositoryError`, `DomainError`)

### Exports

- Each usecase directory has `index.ts` for public API
- Repository interfaces exported from `repositories/`
- Domain types exported from `domain/shared/`

## Import Patterns

### Import Order

1. External dependencies (hono, neverthrow, zod, etc.)
2. Workspace packages (`@bun-hono-ddd-template/*`)
3. Relative imports (same layer or parent layers)

### Import Style

- Use type imports for interfaces/types: `import type { PostRepository }`
- Use value imports for functions/classes: `import { executeCreatePost }`
- Group imports with blank lines between groups

### Layer Boundaries

- Routes import from usecases, repository interfaces (for DI), and utils
- Usecases import from repository interfaces and domain
- Repository interfaces import from domain (for error types)
- Repository implementations import from interfaces and domain
- Utils and types are shared across layers

## Code Organization Patterns

### Usecase Pattern

Each usecase follows this structure:

- `input.ts`: Zod schema + `parse{Action}{Resource}Input` function
- `usecase.ts`: `execute{Action}{Resource}` function with `{Action}{Resource}Deps` interface
- `index.ts`: Re-exports public API

### Repository Pattern

- Interface defined in `repositories/interfaces/{resource}-repository.ts`
- Implementation in `repositories/{provider}/{resource}-repository.ts`
- Factory function: `create{Provider}{Resource}Repository`
- Multiple implementations supported (postgres for production, memory for testing)

### Error Handling Pattern

- Domain errors use discriminated unions (`type` field)
- Factory functions return error objects (no throwing)
- Usecases return `Result<T, E>` with domain errors
- Routes convert domain errors to HTTP responses

### Dependency Injection Pattern

- Dependencies passed as function parameters
- Interface-based dependencies (not concrete classes)
- Factory functions accept dependencies as options
- Default instances created at application boundaries

## Monorepo Patterns

### Workspace Packages

- Shared packages prefixed with `@bun-hono-ddd-template/`
- Use `workspace:*` protocol for internal dependencies
- Catalog pattern for version management

### Package Exports

- Each package exports from `src/index.ts`
- Type definitions included in package exports
- Config packages export configuration objects

## Testing Structure

- Tests mirror source structure: `tests/routes/`, `tests/domain/`
- Test files: `{name}.test.ts`
- Helper utilities in `tests/helpers/`
- Use dependency injection for test doubles
