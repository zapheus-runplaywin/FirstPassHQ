#!/usr/bin/env bash
# Tests scripts/check-demo-sign-in.sh, the sign-in at the end of "Reset demo
# club", with a stand-in for curl: it signs in as admin@ with the demo
# password and the project's anon key, never prints either, and fails with a
# plain message for each way it can go wrong. Run by the "Tests" workflow; it
# reaches no network.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0

mkdir -p "$work/bin"
cat >"$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
out='' url='' headers=()
while [ $# -gt 0 ]; do
  case $1 in
    -o) out=$2; shift ;;
    -H) headers+=("$2"); shift ;;
    -w|--data) [ "$1" = --data ] && cat >"$STUB_DIR/body"; shift ;;
    http*) url=$1 ;;
  esac
  shift
done
for h in "${headers[@]}"; do cat "${h#@}"; done >"$STUB_DIR/headers-${url##*/}"
echo "$url" >>"$STUB_DIR/urls"
if [[ $url == *api-keys ]]; then
  printf '%s' "$STUB_KEYS" >"$out"; printf '%s' "${STUB_KEYS_CODE:-200}"
else
  printf '%s' "$STUB_ANSWER" >"$out"; printf '%s' "${STUB_CODE:-200}"
fi
STUB
chmod +x "$work/bin/curl"

KEYS='[{"name":"anon","type":"legacy","api_key":"anon-key-123"},{"name":"service_role","type":"legacy","api_key":"service-key-999"}]'
OK='{"access_token":"a.b.c","refresh_token":"r"}'
# run <keys> <keys http code> <answer> <answer http code>
run() {
  rm -f "$work"/headers-* "$work/body" "$work/urls"
  env -u GITHUB_ACTIONS ${ACTIONS:+GITHUB_ACTIONS=true} \
    STUB_DIR="$work" STUB_KEYS="$1" STUB_KEYS_CODE="$2" STUB_ANSWER="$3" STUB_CODE="$4" PATH="$work/bin:$PATH" \
    SUPABASE_PROJECT_ID=testref SUPABASE_ACCESS_TOKEN=token-456 DEMO_PASSWORD='Pw s3cret "quoted"' \
    "$root/scripts/check-demo-sign-in.sh" >"$work/out" 2>&1
  status=$?
}
check() {
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got '$2', want '$3')"; cat "$work/out"; failed=1; fi
}
says() { grep -c -- "$1" "$work/out"; }

run "$KEYS" 200 "$OK" 200
check 'a demo account that signs in passes' "$status:$(says 'signed in to the test project')" '0:1'
check 'it signs in on the test project' "$(tail -n 1 "$work/urls")" 'https://testref.supabase.co/auth/v1/token?grant_type=password'
check 'as admin@ with the demo password' \
  "$(jq -r '.email + "|" + .password' "$work/body")" 'admin@demo.firstpass.example|Pw s3cret "quoted"'
check 'with the anon key, never the service key' \
  "$(grep -c '^apikey: anon-key-123$' "$work/headers-token?grant_type=password"):$(grep -c service-key "$work/headers-token?grant_type=password")" '1:0'
check 'the key is read with the access token' "$(grep -c '^Authorization: Bearer token-456$' "$work/headers-api-keys")" 1
check 'never prints the password, key or token' \
  "$(grep -c -e 's3cret' -e anon-key -e token-456 -e a.b.c "$work/out")" 0

# On GitHub Actions the key is masked in the log, and that's the only line
# that names it.
ACTIONS=1 run "$KEYS" 200 "$OK" 200
check 'on GitHub Actions the key is masked' "$(grep -c '^::add-mask::anon-key-123$' "$work/out")" 1
check 'and nothing else names the password, key or token' \
  "$(grep -v '^::add-mask::' "$work/out" | grep -c -e 's3cret' -e anon-key -e token-456 -e a.b.c)" 0

run '[{"name":"default","type":"publishable","api_key":"sb_publishable_x"},{"name":"default","type":"secret","api_key":"sb_secret_y"}]' 200 "$OK" 200
check 'a project with only new keys uses the publishable one' \
  "$status:$(grep -c '^apikey: sb_publishable_x$' "$work/headers-token?grant_type=password")" '0:1'

run "$KEYS" 200 '{"code":400,"error_code":"email_provider_disabled","msg":"Email logins are disabled"}' 400
check 'the Email provider being off says so' "$status:$(says 'The Email provider is off in the test project')" '1:1'

run "$KEYS" 200 '{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}' 400
check 'a wrong password says so' "$status:$(says "didn't sign in with DEMO_PASSWORD")" '1:1'

run "$KEYS" 200 '<html>paused</html>' 503
check 'anything else, such as a paused project, says so' "$status:$(says 'If the test project is paused')" '1:1'

run '{"message":"Unauthorized"}' 401 "$OK" 200
check 'a token that cannot read the keys says so, and signs nobody in' \
  "$status:$(says "Couldn't read the test project's public key (HTTP 401)"):$(grep -c token "$work/urls")" '1:1:0'

run '[{"name":"service_role","type":"legacy","api_key":"service-key-999"}]' 200 "$OK" 200
check 'no anon or publishable key: never signs in with the service key' \
  "$status:$(says 'no anon or publishable key'):$(grep -c token "$work/urls")" '1:1:0'

[ $failed -eq 0 ]
