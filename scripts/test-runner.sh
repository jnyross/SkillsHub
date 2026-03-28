#!/usr/bin/env bash
set -euo pipefail

echo "=== SkillsHub Runner Smoke Test ==="
echo ""

# Source .env if it exists
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# Check if runner is built
if [ ! -f apps/runner/dist/smoke-test.js ]; then
  echo "Runner not built. Building now..."
  pnpm build --filter=runner
fi

BACKEND="${1:-both}"

case "$BACKEND" in
  claude-code)
    echo "Testing Claude Code backend..."
    node apps/runner/dist/smoke-test.js --backend claude-code
    ;;
  codex)
    echo "Testing Codex backend..."
    node apps/runner/dist/smoke-test.js --backend codex
    ;;
  both)
    echo "Testing both backends..."
    node apps/runner/dist/smoke-test.js --backend both
    ;;
  *)
    echo "Usage: $0 [claude-code|codex|both]"
    exit 1
    ;;
esac

echo ""
echo "=== Smoke Test Complete ==="
