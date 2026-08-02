#!/usr/bin/env bash
#
# Apply every migration to a throwaway PostgreSQL instance and check the result.
#
#   ./scripts/verify-schema.sh              # ephemeral cluster, torn down after
#   ./scripts/verify-schema.sh <conn-url>   # run the checks against a database
#                                           # that already has the migrations
#
# What the default mode proves, from nothing:
#
#   1. every migration in supabase/migrations applies, in order;
#   2. supabase/seed.sql loads, and loads a second time unchanged;
#   3. supabase/verify-rls.sql passes — tier-by-tier visibility, the
#      privilege-escalation guards, and the function grants PostgREST would
#      otherwise expose as RPC endpoints.
#
# This is the same sequence the `migrations` job in .github/workflows/ci.yml
# runs. Having it in one script is what stops the two drifting: CI calls this
# rather than repeating the steps in YAML.
#
# It needs `initdb` and `psql` on PATH (Debian: postgresql-16, which installs
# them under /usr/lib/postgresql/16/bin). No Docker and no Supabase CLI: the
# point is that anyone can check the schema without either.
set -euo pipefail

cd "$(dirname "$0")/.."

BOOTSTRAP=supabase/ci-bootstrap.sql
SEED=supabase/seed.sql
VERIFY=supabase/verify-rls.sql

# --- Mode 2: an existing database -------------------------------------------
#
# Only the assertions run. The migrations are assumed already applied, because
# re-applying them to a database someone else is using is not a check, it is an
# incident.

if [[ $# -gt 0 && "$1" != "--help" && "$1" != "-h" ]]; then
  echo "Checking the database you pointed at."
  echo "It writes fixtures and rolls them back, so do not aim this at production."
  echo
  exec psql "$1" -v ON_ERROR_STOP=1 -f "${VERIFY}"
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

# --- Mode 1: an ephemeral cluster -------------------------------------------

for binary in initdb pg_ctl psql; do
  if ! command -v "${binary}" >/dev/null 2>&1; then
    echo "Missing ${binary}. On Debian: apt-get install postgresql-16," >&2
    echo "then add /usr/lib/postgresql/16/bin to PATH." >&2
    exit 127
  fi
done

PORT="${VERIFY_SCHEMA_PORT:-55432}"
WORKDIR=$(mktemp -d)
# initdb refuses to run as root, so as root the cluster runs as a dedicated
# unprivileged user. Everywhere else it runs as whoever invoked the script.
RUNAS=""
if [[ "$(id -u)" == "0" ]]; then
  RUNAS="ledger-pgcheck"
  id -u "${RUNAS}" >/dev/null 2>&1 || useradd -m "${RUNAS}"
  chown -R "${RUNAS}" "${WORKDIR}"
fi

as_pg() {
  if [[ -n "${RUNAS}" ]]; then
    su "${RUNAS}" -c "PATH=$PATH $*"
  else
    eval "$*"
  fi
}

cleanup() {
  as_pg "pg_ctl -D ${WORKDIR}/data stop -m immediate" >/dev/null 2>&1 || true
  rm -rf "${WORKDIR}"
}
trap cleanup EXIT

echo "Starting a throwaway PostgreSQL cluster on port ${PORT}"
as_pg "initdb -D ${WORKDIR}/data -U postgres --auth=trust" >/dev/null
as_pg "pg_ctl -D ${WORKDIR}/data -o '-p ${PORT} -k ${WORKDIR}' -l ${WORKDIR}/log start" >/dev/null

export PGHOST="${WORKDIR}" PGPORT="${PORT}" PGUSER=postgres PGDATABASE=postgres
for _ in $(seq 1 20); do
  psql -tAc 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
psql -tAc 'select 1' >/dev/null || { echo "The cluster did not come up." >&2; exit 1; }

run() {
  local label="$1" file="$2"
  printf '  %-46s' "${label}"
  if psql -v ON_ERROR_STOP=1 -q -f "${file}" >"${WORKDIR}/out" 2>&1; then
    echo "ok"
  else
    echo "FAILED"
    echo
    sed 's/^/    /' "${WORKDIR}/out" | head -20 >&2
    exit 1
  fi
}

echo
echo "Schema"
run "Supabase stand-ins (ci-bootstrap.sql)" "${BOOTSTRAP}"

count=0
for file in supabase/migrations/*.sql; do
  count=$((count + 1))
  printf '  %-46s' "$(basename "${file}")"
  if psql -v ON_ERROR_STOP=1 -q -f "${file}" >"${WORKDIR}/out" 2>&1; then
    echo "ok"
  else
    echo "FAILED"
    echo
    sed 's/^/    /' "${WORKDIR}/out" | head -20 >&2
    exit 1
  fi
done

echo
echo "Reference data"
run "first load" "${SEED}"
# Twice, because the runbook claims it is idempotent and that claim is only
# worth something if something checks it.
run "second load (idempotent)" "${SEED}"

echo
echo "Row-level security"
if ! psql -v ON_ERROR_STOP=1 -f "${VERIFY}" >"${WORKDIR}/verify" 2>&1; then
  grep -E 'ERROR|FAILED' "${WORKDIR}/verify" | sed 's/^/  /' >&2
  exit 1
fi
grep -oE 'ok  .*' "${WORKDIR}/verify" | sed 's/^/  /'

checks=$(grep -c 'ok  ' "${WORKDIR}/verify" || true)
echo
echo "${count} migrations applied, reference data idempotent, ${checks} checks passed."
