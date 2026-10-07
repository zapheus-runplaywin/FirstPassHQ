#!/usr/bin/env bash
# Applies new migrations to the linked Supabase project, used by the
# "Deploy migrations" workflow. Stops before anything can lose data unless
# ALLOW_DATA_LOSS=true. Extra arguments (such as --db-url) go to the CLI.
set -euo pipefail

if [ -n "${ALREADY_APPLIED:-}" ]; then
  if ! [[ "$ALREADY_APPLIED" =~ ^[0-9]{14}([[:space:]]+[0-9]{14})*$ ]]; then
    echo "::error::Already applied must be migration versions like 20261007030000, separated by spaces."
    exit 1
  fi
  # Unquoted on purpose: one argument per version.
  # shellcheck disable=SC2086
  supabase migration repair --status applied $ALREADY_APPLIED "$@"
fi

supabase db push --dry-run "$@" | tee dry-run.txt
pending=$(grep -oE '[0-9]{14}_[A-Za-z0-9_]+\.sql' dry-run.txt | sort -u || true)

if [ -z "$pending" ]; then
  echo "The database is up to date."
  exit 0
fi

first=$(ls supabase/migrations | sort | head -1)
if grep -qx "$first" <<<"$pending"; then
  echo "::error::Supabase has no record of any migrations, so this would rerun them all."
  echo "Run this workflow by hand and list the versions already run in the SQL editor under 'Already applied'."
  exit 1
fi

if [ "${ALLOW_DATA_LOSS:-false}" != "true" ]; then
  # shellcheck disable=SC2046
  if ! python3 scripts/check-migrations.py $(sed 's|^|supabase/migrations/|' <<<"$pending"); then
    echo "::error::Nothing was applied. If Matt agrees to this, run the workflow by hand with 'Allow data loss' ticked."
    exit 1
  fi
fi

supabase db push --yes "$@"
