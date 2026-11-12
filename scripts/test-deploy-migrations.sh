#!/usr/bin/env bash
# Tests scripts/deploy-migrations.sh with a stand-in supabase command, so no
# database is needed. Run by the "Tests" workflow.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0

pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; failed=1; }

# The stand-in prints the dry-run JSON from $PENDING (space separated) and
# records each real push in $work/pushed.
mkdir -p "$work/bin"
cat >"$work/bin/supabase" <<'STUB'
#!/usr/bin/env bash
if [[ " $* " == *" --dry-run "* ]]; then
  python3 -c 'import json, os; print(json.dumps({"migrations": os.environ.get("PENDING", "").split()}))'
elif [[ "$1 $2" == "db push" ]]; then
  echo "$PENDING" >>"$PUSHED"
fi
STUB
chmod +x "$work/bin/supabase"

# A copy of the repo's scripts, and thousands of migrations so that a pipe
# closed early (head) would break sort almost every time.
proj="$work/proj"
mkdir -p "$proj/supabase/migrations"
cp -r "$root/scripts" "$proj/scripts"
for i in $(seq 1 3000); do
  : >"$proj/supabase/migrations/2026$(printf %010d "$i")_old.sql"
done
newest=20991231000000_new.sql
echo "comment on schema public is 'standard public schema';" \
  >"$proj/supabase/migrations/$newest"

run() { (cd "$proj" && PATH="$work/bin:$PATH" PUSHED="$work/pushed" scripts/deploy-migrations.sh) >"$work/out" 2>&1; }

rm -f "$work/pushed"
if PENDING="" run && [ ! -e "$work/pushed" ]; then pass "up to date pushes nothing"; else fail "up to date pushes nothing"; cat "$work/out"; fi

ok=1
for i in $(seq 1 25); do
  rm -f "$work/pushed"
  if ! PENDING="$newest" run || [ "$(cat "$work/pushed" 2>/dev/null)" != "$newest" ]; then ok=0; cat "$work/out"; break; fi
done
if [ "$ok" = 1 ]; then pass "a new migration is pushed, 25 runs in a row"; else fail "a new migration is pushed, 25 runs in a row"; fi

rm -f "$work/pushed"
if ! PENDING="20260000000001_old.sql $newest" run && [ ! -e "$work/pushed" ] && grep -q "no record of any migrations" "$work/out"; then
  pass "the first migration still pending stops the deploy"
else
  fail "the first migration still pending stops the deploy"; cat "$work/out"
fi

exit $failed
