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

The local rehearsal uses a disposable PostgreSQL database and synthetic/reference
data. It exercises encrypted-file round trips and restored schema/access checks.
It is not evidence of hosted Auth sessions, production backup coverage or PITR.
Periodic logical exports leave a data-loss window between exports. The daily
backup requirement is complete only after the production recovery and scheduling
checks above pass; a synthetic rehearsal alone does not meet it.
