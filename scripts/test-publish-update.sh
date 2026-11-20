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
    env | grep '^EXPO_PUBLIC_' | grep -v '=$' >dist/_expo/static/js/bundle.js
    if [ -f src/constants/build-info.json ]; then
      { tr -d ' \n' <src/constants/build-info.json; echo; } >>dist/_expo/static/js/bundle.js
    fi ;;
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

# The build number: worked out from the app folder's git history, built into
# the update, and the committed file put back afterwards.
NULLS='{
  "build": null,
  "commit": null
}'
git_app() {
  mkdir -p "$work/app/src/constants"
  printf '%s\n' "$NULLS" >"$work/app/src/constants/build-info.json"
  (cd "$work/app" && git init -q -b main && git add -A \
    && for i in 1 2 3; do git -c user.name=t -c user.email=t@example.test commit -q --allow-empty -m "c$i" || exit 1; done)
}
run_git() {
  rm -rf "$work/app" "$work/published"; mkdir -p "$work/app"
  printf '%s\n' "$LIVE" >"$work/eas-env"
  printf '%s\n' "$DOTENV" >"$work/app/.env"
  git_app
  [ -n "${1:-}" ] && (cd "$work/app" && git checkout -q -b "$1" \
    && git -c user.name=t -c user.email=t@example.test commit -q --allow-empty -m branch)
  (cd "$work/app" && STUB_DIR=$work PATH="$work/bin:$PATH" MAIN_REF=main \
    "$root/scripts/publish-update.sh" production "Test update" >"$work/out" 2>&1)
  status=$?
}

run_git
check 'an update from main is published' "$status:$(published)" '0:yes'
check 'it carries the build number of main' "$(bundle '"build":3,')" 1
check 'and the commit' "$(bundle "\"commit\":\"$(cd "$work/app" && git rev-parse --short=7 HEAD)\"")" 1
check 'the committed file is put back afterwards' "$(cat "$work/app/src/constants/build-info.json")" "$NULLS"
check 'git sees no change left behind' "$(cd "$work/app" && git status --porcelain -- src)" ''

run_git my-branch
check 'an update from a branch is published' "$status:$(published)" '0:yes'
check 'it has no build number' "$(bundle '"build":null,')" 1
check 'but has the commit' "$(bundle "\"commit\":\"$(cd "$work/app" && git rev-parse --short=7 HEAD)\"")" 1

# The earlier runs had no git history: the update still went out, and said so.
run 'without git history' "$LIVE" "$DOTENV"
check 'an update without git history is still published' "$status:$(published)" '0:yes'
check 'and says it has no build number' "$(grep -c 'shows no build number' "$work/out")" 1

[ $failed -eq 0 ]
