#!/usr/bin/env bash
set -euo pipefail

echo "=== SkillsHub Development Setup ==="
echo ""

# 1. Copy .env.example to .env if not exists
if [ ! -f .env ]; then
  echo "[1/7] Creating .env from .env.example..."
  cp .env.example .env
  echo "  Created .env — edit it to add your API keys"
else
  echo "[1/7] .env already exists, skipping"
fi

# 2. Start infrastructure services
echo ""
echo "[2/7] Starting PostgreSQL and MinIO via docker-compose..."
docker compose up -d postgres minio
echo "  Services started"

# 3. Wait for services to be healthy
echo ""
echo "[3/7] Waiting for services to be healthy..."

echo -n "  Waiting for PostgreSQL..."
for i in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U skillshub > /dev/null 2>&1; then
    echo " ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo " TIMEOUT"
    echo "  ERROR: PostgreSQL did not become ready in time"
    exit 1
  fi
  sleep 1
  echo -n "."
done

echo -n "  Waiting for MinIO..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:9000/minio/health/live > /dev/null 2>&1; then
    echo " ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo " TIMEOUT"
    echo "  ERROR: MinIO did not become ready in time"
    exit 1
  fi
  sleep 1
  echo -n "."
done

# 4. Run DB migrations
echo ""
echo "[4/7] Running database migrations..."
pnpm db:migrate || echo "  WARNING: Migrations not yet wired up"

# 5. Create S3 bucket via MinIO client
echo ""
echo "[5/7] Creating S3 bucket..."
if command -v mc > /dev/null 2>&1; then
  mc alias set skillshub-local http://localhost:9000 minioadmin minioadmin 2>/dev/null || true
  mc mb skillshub-local/skillshub-artifacts 2>/dev/null || echo "  Bucket already exists"
else
  echo "  MinIO client (mc) not installed. Creating bucket via curl..."
  # Use the AWS CLI or a simple PUT request to create the bucket
  curl -sf -X PUT http://localhost:9000/skillshub-artifacts \
    -H "Authorization: AWS4-HMAC-SHA256" 2>/dev/null || \
  echo "  NOTE: Install 'mc' (MinIO client) to create the bucket, or it will be auto-created on first use"
fi

# 6. Check Claude Code CLI
echo ""
echo "[6/7] Checking Claude Code CLI..."
if command -v claude > /dev/null 2>&1; then
  echo "  Claude Code CLI is installed: $(claude --version 2>/dev/null || echo 'version unknown')"
else
  echo "  Claude Code CLI is NOT installed."
  echo "  Install with: npm install -g @anthropic-ai/claude-code"
  echo "  Docs: https://docs.anthropic.com/en/docs/claude-code"
fi

# 7. Check Codex CLI
echo ""
echo "[7/7] Checking Codex CLI..."
if command -v codex > /dev/null 2>&1; then
  echo "  Codex CLI is installed: $(codex --version 2>/dev/null || echo 'version unknown')"
else
  echo "  Codex CLI is NOT installed."
  echo "  Install with: npm install -g @openai/codex"
  echo "  Docs: https://github.com/openai/codex"
fi

# Summary
echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit .env and add your ANTHROPIC_API_KEY and OPENAI_API_KEY"
echo "  2. Run 'pnpm install' to install dependencies"
echo "  3. Run 'pnpm build' to build all packages"
echo "  4. Run 'bash scripts/test-runner.sh' to verify the runner works"
echo ""
