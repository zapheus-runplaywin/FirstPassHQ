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

# JSON, because the plain-text list goes to stderr and its format changes
# between environments (in GitHub Actions stdout only said "Finished").
#
# --include-all: two pull requests can merge in the opposite order to their
# migration versions (PR #44's 20261008020000 merged after PR #43's
# 20261008030000). Without it the CLI refuses to apply the older one, and the
# deploy stops with no message.
if ! supabase db push --dry-run --include-all --output-format json "$@" > dry-run.json; then
  # The CLI writes its error into the JSON output, so show it.
  cat dry-run.json
  echo "::error::The dry run failed. Nothing was applied."
  exit 1
fi
cat dry-run.json
pending=$(python3 -c '
import json, sys
result = json.load(open("dry-run.json"))
if not isinstance(result.get("migrations"), list):
    sys.exit("The dry run did not list its migrations.")
print("\n".join(sorted(result["migrations"])))
')

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

# Security problems always stop the deploy; there is no setting to skip this.
# shellcheck disable=SC2046
if ! python3 scripts/check-migration-security.py $(sed 's|^|supabase/migrations/|' <<<"$pending"); then
  echo "::error::Nothing was applied. Fix the migration in a new pull request."
  exit 1
fi

if [ "${ALLOW_DATA_LOSS:-false}" != "true" ]; then
  # shellcheck disable=SC2046
  if ! python3 scripts/check-migrations.py $(sed 's|^|supabase/migrations/|' <<<"$pending"); then
    echo "::error::Nothing was applied. If Matt agrees to this, run the workflow by hand with 'Allow data loss' ticked."
    exit 1
  fi
fi

supabase db push --include-all --yes "$@"
