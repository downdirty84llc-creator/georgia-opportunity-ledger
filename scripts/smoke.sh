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
#
# The first thing it does is confirm the host is answering at all. An earlier
# version did not, and reported "ok — nothing sensitive is advertised" against a
# server that was not running: curl returned nothing, grep found nothing in the
# nothing, and the check passed. A security check that passes when it could not
# look is worse than no check, so reachability is a hard precondition now and
# every content assertion re-confirms it actually fetched something.
set -euo pipefail

BASE="${1:-${NEXT_PUBLIC_SITE_URL:-http://127.0.0.1:3000}}"
BASE="${BASE%/}"
failures=0

# `curl -o /dev/null -w '%{http_code}'` already prints 000 when the connection
# fails, so an `|| echo 000` fallback on top of it printed "000000" and made
# every failure unreadable. Exit status is swallowed separately instead.
status_of() {
  local path="$1" code
  code=$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 20 "${BASE}${path}") || true
  printf '%s' "${code:-000}"
}

echo "Smoke test against ${BASE}"
echo
printf 'Host is reachable ... '
root_status=$(status_of /)
if [[ "${root_status}" == "000" ]]; then
  echo "NO"
  echo
  echo "  ${BASE} did not answer at all. Nothing below would mean anything," >&2
  echo "  so no checks were run. Is the deployment up and the URL right?" >&2
  exit 2
fi
echo "yes (${root_status})"

check() {
  local description="$1" expected="$2" path="$3" actual
  actual=$(status_of "${path}")

  if [[ ",${expected}," == *",${actual},"* ]]; then
    printf '  ok    %-44s %s\n' "${path}" "${actual}"
  else
    printf '  FAIL  %-44s %s (wanted %s) — %s\n' \
      "${path}" "${actual}" "${expected}" "${description}"
    failures=$((failures + 1))
  fi
}

# Asserts a string is absent from a document that was actually retrieved.
# The fetch is checked first: "absent from an empty response" is not a result.
absent() {
  local description="$1" needle="$2" path="$3" body
  body=$(curl -s -L --max-time 20 "${BASE}${path}") || body=''

  if [[ -z "${body}" ]]; then
    printf '  FAIL  %-44s empty response — could not check for %q\n' \
      "${path}" "${needle}"
    failures=$((failures + 1))
    return
  fi

  if grep -qi -- "${needle}" <<<"${body}"; then
    printf '  FAIL  %-44s contains %q — %s\n' "${path}" "${needle}" "${description}"
    failures=$((failures + 1))
  else
    printf '  ok    %-44s no %q\n' "${path}" "${needle}"
  fi
}

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
# A redirect to sign-in is a 200 after -L; what matters is that member content
# is not what came back, which the absence checks below cover. 405 counts: an
# endpoint that only accepts POST leaks nothing by refusing a GET.
check "member API refuses anonymous" "401,403,404,405" "/api/v1/saved-opportunities"
check "admin API refuses anonymous"  "401,403,404,405" "/api/v1/admin/opportunities"
check "staff API refuses anonymous"  "401,403,404,405" "/api/v1/admin/staff"
check "attachment id does not leak"  "401,403,404,405" "/api/v1/attachments/00000000-0000-0000-0000-000000000000"
check "jobs refuse without secret"   "401,403"         "/api/v1/jobs/prune"

echo
echo "Nothing sensitive is advertised"
absent "member routes must not be in the sitemap"  "/dashboard" "/sitemap.xml"
absent "admin routes must not be in the sitemap"   "/admin"     "/sitemap.xml"
absent "account routes must not be in the sitemap" "/account"   "/sitemap.xml"

echo
if (( failures > 0 )); then
  echo "${failures} check(s) failed."
  exit 1
fi
echo "All checks passed."
