#!/usr/bin/env bash
# Apply all migrations and seeds, in order, to $DATABASE_URL.
# Usage:
#   DATABASE_URL=postgres://yash:yash_dev_password@localhost:5432/yash_poultry ./scripts/apply.sh
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgres://yash:yash_dev_password@localhost:5432/yash_poultry}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

for f in "$ROOT"/db/migrations/*.sql; do
    echo "==> migration: $(basename "$f")"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

for f in "$ROOT"/db/seeds/*.sql; do
    echo "==> seed: $(basename "$f")"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo "Done."
