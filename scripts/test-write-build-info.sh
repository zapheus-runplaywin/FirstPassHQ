#!/usr/bin/env bash
# Tests scripts/write-build-info.js, which puts "Build N" on the app's opening
# screens: N is the build-N tag's number (commits on main up to this one), a
# commit not on main gets its short id instead, and a copy without the whole
# history is refused rather than given a wrong number. Run by the "Tests"
# workflow; it reaches no network.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
script="$root/scripts/write-build-info.js"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0

check() {
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got '$2', want '$3')"; failed=1; fi
}
commit() { git -c user.name=t -c user.email=t@example.test commit -q --allow-empty -m "$1"; }
NULLS='{
  "build": null,
  "commit": null
}'

# A club app folder with five commits on main and the committed nulls.
repo="$work/repo"
mkdir -p "$repo/src/constants"
printf '%s\n' "$NULLS" >"$repo/src/constants/build-info.json"
(cd "$repo" && git init -q -b main && git add -A && for i in 1 2 3 4 5; do commit "c$i"; done)
short() { (cd "$1" && git rev-parse --short=7 HEAD); }
info() { cat "$1/src/constants/build-info.json"; }

out=$(cd "$repo" && MAIN_REF=main node "$script")
check 'the tip of main is written' "$?" 0
check 'with its build number and commit' "$(info "$repo")" "{
  \"build\": 5,
  \"commit\": \"$(short "$repo")\"
}"
check 'and says what the app shows' "$out" "The app shows \"Build 5\" (commit $(short "$repo"))."

# An older commit on main gets that commit's number, matching its tag.
(cd "$repo" && git checkout -q HEAD~2)
(cd "$repo" && MAIN_REF=main node "$script" >/dev/null)
check 'an older commit on main gets its own number' "$(cd "$repo" && node -p "require('./src/constants/build-info.json').build")" 3
(cd "$repo" && git checkout -q main)

# A branch ahead of main has no build number.
(cd "$repo" && git checkout -q -b feature && commit branch)
out=$(cd "$repo" && MAIN_REF=main node "$script")
check 'a commit not on main has no build number' "$(info "$repo")" "{
  \"build\": null,
  \"commit\": \"$(short "$repo")\"
}"
check 'and says the app shows the commit' "$out" "Commit $(short "$repo") isn't on main, so the app shows \"Commit $(short "$repo")\"."

# Without MAIN_REF, main is origin/main; with no such branch nothing is on main.
(cd "$repo" && git checkout -q main)
(cd "$repo" && env -u MAIN_REF node "$script" >/dev/null)
check 'with no origin/main there is no build number' "$(cd "$repo" && node -p "require('./src/constants/build-info.json').build")" null

# --print writes nothing.
printf '%s\n' "$NULLS" >"$repo/src/constants/build-info.json"
printed=$(cd "$repo" && MAIN_REF=main node "$script" --print)
check '--print prints the details' "$(printf '%s' "$printed" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).build))")" 5
check '--print leaves the file alone' "$(info "$repo")" "$NULLS"

# A shallow clone would count only its own commits, so it's refused.
git clone -q --depth 1 "file://$repo" "$work/shallow" 2>/dev/null
out=$(cd "$work/shallow" && MAIN_REF=main node "$script" 2>&1)
check 'a shallow clone is refused' "$?" 1
check 'and says to fetch the whole history' "$(printf '%s' "$out" | grep -c 'fetch-depth: 0')" 1
check 'and its file is left alone' "$(info "$work/shallow")" "$NULLS"

# No git at all.
mkdir -p "$work/plain/src/constants"
printf '%s\n' "$NULLS" >"$work/plain/src/constants/build-info.json"
out=$(cd "$work/plain" && GIT_CEILING_DIRECTORIES="$work" node "$script" 2>&1)
check 'a folder without git history is refused' "$?" 1
check 'and says why' "$out" 'No git history here, so the build number is unknown.'

# The committed copy in the repo has nulls, so a development copy shows no build.
check 'the committed file has nulls' "$(git -C "$root" show HEAD:src/constants/build-info.json 2>/dev/null || cat "$root/src/constants/build-info.json")" "$NULLS"

[ $failed -eq 0 ]
