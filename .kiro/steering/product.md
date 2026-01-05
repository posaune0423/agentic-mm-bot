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
