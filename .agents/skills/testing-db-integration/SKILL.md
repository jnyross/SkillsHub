# Testing SkillsHub DB/Domain/Execution Packages

## Prerequisites

### Infrastructure
- PostgreSQL 16 and MinIO must be running via Docker Compose:
  ```bash
  docker compose up -d postgres minio
  ```
- Verify services are healthy:
  ```bash
  docker ps --format '{{.Names}} {{.Status}}'
  ```

### Database Setup
- Push Prisma schema to Postgres before running DB integration tests:
  ```bash
  cd packages/db
  DATABASE_URL="$DATABASE_URL" npx prisma db push --accept-data-loss
  ```
- Generate Prisma client (done automatically by `pnpm run build`):
  ```bash
  cd packages/db
  npx prisma generate
  ```

### Build
- Always build all packages before running tests:
  ```bash
  pnpm run build
  ```

## Running Tests

### All packages (79 tests total)
```bash
# DB integration tests (29 tests, requires real Postgres)
cd packages/db && DATABASE_URL="$DATABASE_URL" npx vitest run

# Domain unit tests (32 tests, no external deps)
cd packages/domain && npx vitest run

# Execution unit tests (18 tests, no external deps)
cd packages/execution && npx vitest run
```

### Run a specific test file
```bash
cd packages/db
DATABASE_URL="$DATABASE_URL" npx vitest run src/__tests__/review-gate.test.ts
```

## Test Architecture

- **DB tests** (`packages/db/src/__tests__/`): Integration tests against real PostgreSQL. Each test file uses `beforeEach` to TRUNCATE all tables in dependency order. Tests run sequentially (one file at a time) via `vitest.config.ts` pool settings to avoid deadlocks.
- **Domain tests** (`packages/domain/src/__tests__/`): Pure unit tests for state machine transitions. No external dependencies.
- **Execution tests** (`packages/execution/src/__tests__/`): Unit tests for execution envelope building and comparability hash computation. No external dependencies.

## Common Pitfalls

### ExecutionEnvelope creation requires iterationId and evalSnapshotId
When creating `ExecutionEnvelope` records directly (e.g., in test helpers), you must include `iterationId`, `evalSnapshotId`, and `runnerVersion` fields. The field names in the Prisma schema differ from the domain types:
- Schema uses `runnerVersion` (not `runnerImageHash`)
- Schema uses `resourceProfileHash` (not `resourceProfile`)
- Schema uses `retryPolicyHash` (not `retryPolicy`)

### Prisma transactions roll back on throw
If you need a side effect (like marking a record as stale) to persist even when the function throws an error, you must return from the transaction normally and throw AFTER the transaction commits. Throwing inside `prisma.$transaction()` rolls back all changes.

### Test isolation
Each test file truncates all tables in `beforeEach`. The truncation order matters due to foreign key constraints — truncate child tables before parent tables, or use `CASCADE`.

## Devin Secrets Needed
- No external secrets needed for local testing
- PostgreSQL and MinIO use default credentials from `docker-compose.yml`
- The `DATABASE_URL` environment variable must be set (see `.env.example` for the format)
