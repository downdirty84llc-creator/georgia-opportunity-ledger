#!/usr/bin/env bash
#
# Post-deployment smoke test.
#
#   ./scripts/smoke.sh https://ledger.example.com
#
# Checks the things that are cheap to verify and expensive to get wrong: the
# public pages answer, the access boundary holds, the jobs are not reachable
# without their secret, and nothing sensitive is being indexed. It does not
# sign in — it is deliberately runnable against production by anyone, at any
# time, without credentials.
set -euo pipefail

BASE="${1:-${NEXT_PUBLIC_SITE_URL:-http://127.0.0.1:3000}}"
BASE="${BASE%/}"
failures=0

check() {
  local description="$1" expected="$2" path="$3"
  local actual
  actual=$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 20 "${BASE}${path}" || echo 000)

  if [[ ",${expected}," == *",${actual},"* ]]; then
    printf '  ok    %-44s %s\n' "${path}" "${actual}"
  else
    printf '  FAIL  %-44s %s (wanted %s) — %s\n' "${path}" "${actual}" "${expected}" "${description}"
    failures=$((failures + 1))
  fi
}

absent() {
  local description="$1" needle="$2" path="$3"
  if curl -s --max-time 20 "${BASE}${path}" | grep -qi -- "${needle}"; then
    printf '  FAIL  %-44s contains %q — %s\n' "${path}" "${needle}" "${description}"
    failures=$((failures + 1))
  else
    printf '  ok    %-44s no %q\n' "${path}" "${needle}"
  fi
}

echo "Smoke test against ${BASE}"

echo
echo "Public pages answer"
for path in / /pricing /commercial-property /funding /pricing-reports \
            /how-it-works /insights /sample-report /login /register \
            /legal/terms /legal/privacy /legal/accessibility /legal/acceptable-use; do
  check "public page" "200" "${path}"
done
check "sitemap" "200" "/sitemap.xml"
check "robots" "200" "/robots.txt"

echo
echo "Access boundary holds"
# A redirect to sign-in is a 200 after -L; what matters is that the member
# content is not what came back, which the content checks below cover.
check "member API refuses anonymous" "401,403,404" "/api/v1/saved-opportunities"
check "admin API refuses anonymous"  "401,403,404" "/api/v1/admin/opportunities"
check "staff API refuses anonymous"  "401,403,404" "/api/v1/admin/staff"
check "attachment id does not leak"  "401,403,404" "/api/v1/attachments/00000000-0000-0000-0000-000000000000"
check "jobs refuse without secret"   "401,403"     "/api/v1/jobs/prune"

echo
echo "Nothing sensitive is advertised"
absent "member routes must not be in the sitemap" "/dashboard" "/sitemap.xml"
absent "admin routes must not be in the sitemap"  "/admin"     "/sitemap.xml"
absent "account routes must not be in the sitemap" "/account"  "/sitemap.xml"

echo
if (( failures > 0 )); then
  echo "${failures} check(s) failed."
  exit 1
fi
echo "All checks passed."
