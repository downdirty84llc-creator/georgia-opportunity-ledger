# Backup and recovery

The archive command encrypts an existing export with AES-256-GCM and verifies
its authentication before writing recovered bytes. It does **not** export a
database, enable point-in-time recovery, copy Storage objects or schedule a job.
The production recovery gate stays open until an actual production export has
been restored and an independent protected recovery copy exists.

On 2026-11-05, the owner selected encrypted daily backups for the no-cost launch
and accepted up to 24 hours of data loss between backups. Point-in-time recovery
is no longer a launch prerequisite. A working daily schedule, failure reporting,
independent protected retention and a verified production restore remain required.

## Production evidence — November 5, 2026

Production SSL enforcement is enabled after the owner's approved restart.
The backup connection uses `verify-full` and the official Supabase CA bundle;
the pooler-to-database connection was independently verified as SSL.

An actual production export was encrypted, decrypted and restored into a new
loopback-only PostgreSQL cluster. All **81** application, Auth, Storage and
migration table counts matched, along with owners, effective table/view grants
and RLS policies. A second restore used the independently downloaded encrypted
artifact from private GitHub Actions run
[42024998535](https://github.com/downdirty84llc-creator/ledger-private-backups/actions/runs/42024998535),
and passed the same checks. Both local clusters were stopped after verification.
These are actual production-data recovery checks, not the earlier synthetic test.

The separate private repository `downdirty84llc-creator/ledger-private-backups`
contains recovery automation only. It does not replace the canonical application
repository. Daily runs are scheduled for **08:37 UTC**, with **14-day** encrypted
artifact retention and a **20 MiB** per-run retention guard. The existing GitHub
Actions spending cap is **$0**. No paid service or upgrade was enabled.

The dedicated backup login has `pg_read_all_data`, `BYPASSRLS` and read-only
transactions by default. Supabase PUBLIC extension grants still apply; protect
this credential as a database secret rather than treating it as a strictly
read-only authorization boundary. No application role membership was granted.

The export and row-count manifest share one PostgreSQL snapshot. Provider role
memberships are retained, but the standalone restore uses its bootstrap role as
the grantor because the hosted platform's internal grantor does not have the same
bootstrap history locally. Effective table permissions and RLS are compared,
not serialized ACL order. The unchanged original role export remains encrypted.

The final automation passed in run
[42026650947](https://github.com/downdirty84llc-creator/ledger-private-backups/actions/runs/42026650947).
Its independently downloaded archive passed authentication and file-hash checks,
including both required Vault values and all 16 cron definitions. These are
encrypted separately because the database archive's Vault ciphertext depends on
the original project key. The backup reader cannot decrypt Vault: the protected
operational recovery secret supplies these values, and every run checks their
names and modification times against production. Refresh that recovery secret
whenever a Vault value changes; a mismatch stops the backup.

Failure reporting was accepted by the existing Sentry project during run
`42025839280`. This proves event ingestion, not delivery of an email alert or
detection of a scheduled workflow that never starts.

External Auth/SMTP, Stripe, Resend, hosting and webhook configuration still
need their recovery material. The core-schema restore does not prove that a
replacement hosted Auth/API/Storage service is running.

Remaining recovery requirements: confirm independent password-manager/offline key
custody, configure and verify missed-run alerts, and complete the provider/service
configuration recovery procedure. A GitHub schedule can be delayed or dropped;
24 hours is the recovery target, not a guaranteed maximum without monitoring.

## Export the hosted project

Use Supabase's [current backup and restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
Verify the CLI version and `supabase db dump --help` first: CLI v3 changed
hosted-target defaults. Confirm project `bbgikfblcahhvrpxiqnd` before reading
production. Keep credentials out of shell history, logs and the repository.

The official procedure exports **roles, schema and data** separately, using
`--role-only`, a normal schema dump, and `--data-only --use-copy`. Follow the
current documented exclusions for managed Storage tables. Do not substitute a
public-table JSON download or a successful schema migration for a complete
database backup. Supabase's CLI performs platform-specific filtering that a
plain `pg_dump` does not.

Record the source project, export time, CLI/Postgres versions, each command's
exit status, export-file hashes and the current application commit in a
manifest inside the protected export folder. Include Storage object bytes
separately; database rows alone cannot restore uploaded files. Record required
Auth/SMTP, redirect, webhook, cron and secret configuration in the protected
recovery material, never in a public manifest.

## Encrypt and recover files

Run these commands in a private local folder outside this repository. On
Windows, restrict that folder's ACL to the current owner before putting any
production data in it. The key command also applies an owner-only Windows ACL;
on other systems, files are created with mode `0600`.

```text
npm run backup:archive -- create-key /private/location/ledger.backup-key
npm run backup:archive -- seal /private/location/data.sql /private/location/data.sql.golbak /private/location/ledger.backup-key
npm run backup:archive -- open /private/location/data.sql.golbak /private/location/recovered-data.sql /private/location/ledger.backup-key
```

Use the same process for the roles, schema, manifest and Storage exports, or
bundle them into a standard archive before encryption. Each file must be at
most **64 MiB**. Larger files are refused; they are never silently truncated.
Choose a reviewed streaming backup product before exceeding this limit.
Keep encrypted files and the recovery key in separate protected locations. A
lost key cannot be recovered from the archive. No external upload or recurring
service is enabled by these commands.

Both key creation and output creation refuse to overwrite existing files.
Wrong keys, tampering, unsupported versions and truncated archives fail. Compare
the original and recovered file hashes before removing plaintext exports.
Authentication proves the archive is intact; it does not prove a database can
be restored from it.

## Prove recovery on an isolated destination

1. Provision a new empty test destination with the required extensions and
   compatible Supabase platform objects. Never restore over production.
2. Authenticate/decrypt the files into a protected recovery folder.
3. Follow the official roles/schema/data restore sequence with stop-on-error
   and transactional restore options. Record every exit code.
4. Compare table counts and critical records, including Auth users, plans,
   subscriptions and editorial records. Verify RLS and grants, tier access,
   Storage contents/downloads and required application configuration.
5. Record recovery duration, the recovered export timestamp and anything
   excluded. Test access to the independent copy and key as part of recovery.

The earlier synthetic rehearsal used a disposable PostgreSQL database and
reference data. The November 5 checks above additionally restored actual
production data from the encrypted cloud copy. Neither check proves replacement
hosted Auth sessions or PITR.
Periodic logical exports leave a data-loss window between exports. The daily
backup requirement is complete only after the production recovery and scheduling
checks above pass; a synthetic rehearsal alone does not meet it.
