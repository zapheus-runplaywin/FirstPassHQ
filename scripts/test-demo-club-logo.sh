#!/usr/bin/env bash
# Tests scripts/demo-club-logo.sh, which gives the demo club (the Perth
# Pumpkins) its logo at the end of "Reset demo club", with a stand-in for
# curl: the logo's name follows its contents, a logo that's already in the
# test project is left alone, a missing one is uploaded as the demo club's
# admin with the anon key, and it never prints the key, the password or the
# sign-in. Also checks the logo file itself fits the club-branding bucket.
# Run by the "Tests" workflow; it reaches no network.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
script="$root/scripts/demo-club-logo.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0

# The stand-in: the public address serves what's in $STUB_DIR/bucket (or 404),
# and an upload that's allowed puts the request's body there.
mkdir -p "$work/bin"
cat >"$work/bin/curl" <<'STUB'
#!/usr/bin/env bash
out='' url='' body='' headers=()
while [ $# -gt 0 ]; do
  case $1 in
    -o) out=$2; shift ;;
    -H) headers+=("$2"); shift ;;
    -w) shift ;;
    --data|--data-binary) body=$2; shift ;;
    http*) url=$1 ;;
  esac
  shift
done
echo "$url" >>"$STUB_DIR/urls"
kind=other
case $url in
  *api-keys) kind=keys ;;
  *auth/v1/token*) kind=token ;;
  *object/public/*) kind=public ;;
  *storage/v1/object/*) kind=upload ;;
esac
for h in "${headers[@]}"; do cat "${h#@}"; done >"$STUB_DIR/headers-$kind"
case $kind in
  keys) printf '%s' "$STUB_KEYS" >"$out"; printf 200 ;;
  token) cat >"$STUB_DIR/sign-in"; printf '%s' "$STUB_ANSWER" >"$out"; printf '%s' "${STUB_CODE:-200}" ;;
  public)
    if [ -f "$STUB_DIR/bucket" ]; then cp "$STUB_DIR/bucket" "$out"; printf 200
    else printf '{"statusCode":"404","error":"not_found","message":"Object not found"}' >"$out"; printf 404; fi ;;
  upload)
    cp "${body#@}" "$STUB_DIR/sent"
    printf '%s' "$STUB_UPLOAD" >"$out"
    [ "${STUB_UPLOAD_CODE:-200}" = 200 ] && [ -z "${STUB_LOSE:-}" ] && cp "${body#@}" "$STUB_DIR/bucket"
    # Someone else's upload of the same file landing first.
    [ -n "${STUB_RACE:-}" ] && cp "${body#@}" "$STUB_DIR/bucket"
    printf '%s' "${STUB_UPLOAD_CODE:-200}" ;;
esac
STUB
chmod +x "$work/bin/curl"

KEYS='[{"name":"anon","type":"legacy","api_key":"anon-key-123"},{"name":"service_role","type":"legacy","api_key":"service-key-999"}]'
OK='{"access_token":"a.b.c","refresh_token":"r"}'
UPLOADED='{"Key":"club-branding/logo.png","Id":"1"}'
# A stand-in logo, so the test doesn't depend on the real file's bytes.
printf 'logo-bytes-one' >"$work/logo.png"

# run [NAME=value ...]: "upload" against the stand-in.
run() {
  rm -f "$work"/headers-* "$work/urls" "$work/sign-in" "$work/sent"
  env -u GITHUB_ACTIONS STUB_DIR="$work" STUB_KEYS="$KEYS" STUB_ANSWER="$OK" STUB_UPLOAD="$UPLOADED" \
    PATH="$work/bin:$PATH" DEMO_LOGO_FILE="$work/logo.png" DEMO_LOGO_WAIT=0 \
    SUPABASE_PROJECT_ID=testref SUPABASE_ACCESS_TOKEN=token-456 DEMO_PASSWORD='Pw s3cret "quoted"' \
    "$@" "$script" upload >"$work/out" 2>&1
  status=$?
}
check() {
  if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got '$2', want '$3')"; cat "$work/out" 2>/dev/null; failed=1; fi
}
says() { grep -c -- "$1" "$work/out"; }
asked() { grep -c -- "$1" "$work/urls"; }

# The name.
name=$(DEMO_LOGO_FILE="$work/logo.png" "$script" name)
check 'the name is made from the file' "$(grep -c -E '^demo-club-logo-[0-9a-f]{12}\.png$' <<<"$name")" 1
check 'the same file always has the same name' "$(DEMO_LOGO_FILE="$work/logo.png" "$script" name)" "$name"
printf 'logo-bytes-two' >"$work/other.png"
check 'a changed logo gets a new name, so phones never show an old copy' \
  "$([ "$(DEMO_LOGO_FILE="$work/other.png" "$script" name)" != "$name" ] && echo new)" new
DEMO_LOGO_FILE="$work/none.png" "$script" name >"$work/out" 2>&1
check 'a missing logo file says so' "$?:$(says "logo is missing")" '1:1'
"$script" >"$work/out" 2>&1
check 'it does nothing without being told name or upload' "$?:$(says Usage)" '2:1'

# Not in the test project yet: uploaded as the demo club's admin.
rm -f "$work/bucket"
run
check 'a logo the test project lacks is uploaded' "$status:$(says "logo is in the test project ($name)")" '0:1'
check 'to the club-branding bucket on the test project, under its name' \
  "$(grep 'storage/v1/object/club-branding' "$work/urls")" "https://testref.supabase.co/storage/v1/object/club-branding/$name"
check 'the very file' "$(cmp -s "$work/sent" "$work/logo.png" && echo same)" same
check 'as admin@ with the demo password' \
  "$(jq -r '.email + "|" + .password' "$work/sign-in")" 'admin@demo.firstpass.example|Pw s3cret "quoted"'
check "with the admin's sign-in and the anon key, as a PNG" \
  "$(grep -c -e '^Authorization: Bearer a.b.c$' -e '^apikey: anon-key-123$' -e '^Content-Type: image/png$' "$work/headers-upload")" 3
check 'never the service key or the access token' "$(cat "$work/headers-upload" "$work/headers-token" | grep -c -e service-key -e token-456)" 0
check 'then it checks the public address serves it' "$(tail -n 1 "$work/urls")" \
  "https://testref.supabase.co/storage/v1/object/public/club-branding/$name"
check 'never prints the password, key or sign-in' "$(grep -c -e 's3cret' -e anon-key -e token-456 -e a.b.c "$work/out")" 0

run GITHUB_ACTIONS=true
check 'already there: nothing is uploaded and nobody signs in' \
  "$status:$(says 'already in the test project'):$(asked api-keys):$(asked auth/v1):$(asked 'object/club-branding')" '0:1:0:0:0'
check 'and it needs no password or token for that' \
  "$(env -u SUPABASE_ACCESS_TOKEN -u DEMO_PASSWORD STUB_DIR="$work" PATH="$work/bin:$PATH" DEMO_LOGO_FILE="$work/logo.png" \
    SUPABASE_PROJECT_ID=testref "$script" upload >/dev/null 2>&1; echo $?)" 0

# On GitHub Actions the key and the sign-in are masked, and nothing else names them.
rm -f "$work/bucket"
run GITHUB_ACTIONS=true
check 'on GitHub Actions the key and the sign-in are masked' \
  "$status:$(grep -c -e '^::add-mask::anon-key-123$' -e '^::add-mask::a.b.c$' "$work/out")" '0:2'
check 'and nothing else names the password, key or sign-in' \
  "$(grep -v '^::add-mask::' "$work/out" | grep -c -e 's3cret' -e anon-key -e token-456 -e a.b.c)" 0

# What can go wrong.
printf 'something-else' >"$work/bucket"
run
check 'a different file under the same name is refused, and nothing is uploaded' \
  "$status:$(says 'different file'):$(asked 'object/club-branding')" '1:1:0'

rm -f "$work/bucket"
run STUB_ANSWER='{"code":400,"error_code":"invalid_credentials","msg":"Invalid login credentials"}' STUB_CODE=400
check 'when admin@ does not sign in, it says so and uploads nothing' \
  "$status:$(says "didn't sign in to upload the logo (HTTP 400)"):$(asked 'object/club-branding')" '1:1:0'

run STUB_KEYS='[{"name":"service_role","type":"legacy","api_key":"service-key-999"}]'
check 'no anon or publishable key: never signs in with the service key' \
  "$status:$(says 'no anon or publishable key'):$(asked auth/v1)" '1:1:0'

run STUB_UPLOAD_CODE=403 STUB_UPLOAD='{"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}'
check 'an upload the bucket refuses says why' \
  "$status:$(says "didn't upload (HTTP 403, Unauthorized: new row violates row-level security policy)")" '1:1'

run STUB_LOSE=1
check 'an upload the test project then does not serve fails' "$status:$(says "doesn't serve it")" '1:1'

# The name taken a moment ago by someone else's upload: fine only when it's this file.
DUPLICATE='{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}'
rm -f "$work/bucket"
run STUB_UPLOAD_CODE=409 STUB_UPLOAD="$DUPLICATE"
check 'an upload that finds the name taken, and not by this file, fails' "$status:$(says "doesn't serve it")" '1:1'
run STUB_UPLOAD_CODE=409 STUB_UPLOAD="$DUPLICATE" STUB_RACE=1
check 'an upload that finds this very file already there passes' "$status:$(says 'logo is in the test project')" '0:1'

# The real logo: a square PNG within the bucket's limits, and the drawing it came from.
real="$root/supabase/demo-club-logo.png"
check "the demo club's logo is a square PNG of at least 512 pixels" "$(python3 - "$real" <<'PY'
import struct, sys
data = open(sys.argv[1], 'rb').read()
ok = data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR'
width, height = struct.unpack('>II', data[16:24]) if ok else (0, 0)
print('yes' if ok and width == height and width >= 512 else f'no ({width}x{height})')
PY
)" yes
limit=$(grep -o "'club-branding', 'club-branding', true, [0-9]*" "$root"/supabase/migrations/*club_branding_and_features.sql | grep -o '[0-9]*$')
check 'the bucket takes PNG files' "$(grep -c "'club-branding', 'club-branding', true, $limit, array\['image/png'" "$root"/supabase/migrations/*club_branding_and_features.sql)" 1
check "and the logo is under the bucket's size limit" "$([ "$(wc -c <"$real")" -lt "${limit:-0}" ] && echo under)" under
check 'the drawing the logo was made from is kept beside it' "$(grep -c '<svg' "$root/supabase/demo-club-logo.svg")" 1
check "the real logo's name" "$("$script" name | grep -c -E '^demo-club-logo-[0-9a-f]{12}\.png$')" 1

[ $failed -eq 0 ]
