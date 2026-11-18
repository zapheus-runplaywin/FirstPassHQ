#!/usr/bin/env bash
# Tests scripts/publish-update.sh with stand-ins for EAS and Expo: an update is
# built with the channel's live project and its demo club (when it has one),
# never with the .env test clubs, and is refused when the demo club points at
# the live project or the .env address leaks in some other way. Run by the
# "Tests" workflow; it reaches no network.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0

# npx stand-in. "eas env:pull" writes $work/eas-env; "expo export" writes the
# EXPO_PUBLIC values it was given into the bundle; "eas update" records it.
mkdir -p "$work/bin" "$work/app"
cat >"$work/bin/npx" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *"env:pull"*)
    while [ $# -gt 0 ]; do [ "$1" = --path ] && cp "$STUB_DIR/eas-env" "$2"; shift; done ;;
  *"expo export"*)
    mkdir -p dist/_expo/static/js
    env | grep '^EXPO_PUBLIC_' | grep -v '=$' >dist/_expo/static/js/bundle.js ;;
  *" update "*) echo published >>"$STUB_DIR/published" ;;
esac
STUB
chmod +x "$work/bin/npx"

# run <name> <eas env> <.env>: publishes from a folder with that .env.
run() {
  rm -rf "$work/app" "$work/published"; mkdir -p "$work/app"
  printf '%s\n' "$2" >"$work/eas-env"
  printf '%s\n' "$3" >"$work/app/.env"
  (cd "$work/app" && STUB_DIR=$work PATH="$work/bin:$PATH" \
    "$root/scripts/publish-update.sh" production "Test update" >"$work/out" 2>&1)
  status=$?
}
check() {
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got '$2', want '$3')"; cat "$work/out"; failed=1; fi
}
bundle() { grep -c -- "$1" "$work/app/dist/_expo/static/js/bundle.js" 2>/dev/null || true; }
published() { [ -f "$work/published" ] && echo yes || echo no; }

LIVE='EXPO_PUBLIC_SUPABASE_URL=https://live.example.test
EXPO_PUBLIC_SUPABASE_ANON_KEY=live-key'
DEMO='EXPO_PUBLIC_DEMO_CLUB_URL=https://test.example.test
EXPO_PUBLIC_DEMO_CLUB_ANON_KEY=test-key'
DOTENV='EXPO_PUBLIC_SUPABASE_URL=https://test.example.test
EXPO_PUBLIC_SUPABASE_ANON_KEY=test-key
EXPO_PUBLIC_TEST_CLUB_2_URL=https://hawks.example.test
EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY=hawks-key'

run 'without a demo club' "$LIVE" "$DOTENV"
check 'an update without a demo club is published' "$status:$(published)" '0:yes'
check 'it uses the live project' "$(bundle 'SUPABASE_URL=https://live.example.test')" 1
check 'it has no demo club' "$(bundle DEMO_CLUB)" 0
check 'it has no .env test club' "$(bundle hawks)" 0

run 'with a demo club' "$LIVE
$DEMO" "$DOTENV"
check 'an update with the demo club is published' "$status:$(published)" '0:yes'
check 'it keeps the demo club on the test project' "$(bundle 'DEMO_CLUB_URL=https://test.example.test')" 1
check 'it still has no .env test club' "$(bundle hawks)" 0

run 'demo club on the live project' "$LIVE
EXPO_PUBLIC_DEMO_CLUB_URL=https://live.example.test
EXPO_PUBLIC_DEMO_CLUB_ANON_KEY=live-key" "$DOTENV"
check 'a demo club on the live project is refused' "$status:$(published)" '1:no'
check 'and says why' "$(grep -c 'points at the live project' "$work/out")" 1

run 'no live project' "$DEMO" "$DOTENV"
check 'an environment with no live project is refused' "$status:$(published)" '1:no'

[ $failed -eq 0 ]
