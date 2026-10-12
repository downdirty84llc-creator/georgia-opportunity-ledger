// Local/CI only: run against the throwaway database used by verify-schema.sh.
// Uses psql and Node built-ins, so no database client dependency is required.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const connection = process.argv[2] ? [process.argv[2]] : [];
const clients = [];
function connect() {
  const child = spawn(
    process.env.PSQL_BIN || 'psql',
    [...connection, '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let output = '',
    errors = '',
    pending = null,
    serial = 0;
  child.stdout.on('data', (chunk) => {
    output += chunk;
    if (pending && output.includes(pending.marker)) {
      const result = output.slice(0, output.indexOf(pending.marker)).trim();
      output = output.slice(
        output.indexOf(pending.marker) + pending.marker.length,
      );
      const { resolve, timer } = pending;
      pending = null;
      clearTimeout(timer);
      resolve(result);
    }
  });
  child.stderr.on('data', (chunk) => {
    errors += chunk;
  });
  function fail(error) {
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = null;
    }
  }
  child.on('error', fail);
  child.on('exit', (code) => fail(new Error(`psql exited ${code}: ${errors}`)));
  const client = {
    query(sql) {
      assert.equal(pending, null, 'one command at a time per connection');
      output = '';
      return new Promise((resolve, reject) => {
        const marker = `LEDGER_QUERY_DONE_${++serial}`;
        const timer = setTimeout(() => {
          child.kill();
          fail(new Error(`psql query timed out: ${errors}`));
        }, 15000);
        pending = { marker, resolve, reject, timer };
        child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async close() {
      if (child.exitCode !== null) return;
      const closed = once(child, 'exit');
      child.stdin.end('rollback;\n\\q\n');
      await closed;
    },
  };
  clients.push(client);
  return client;
}

const member = 'eeeeeeee-0000-4000-8000-000000000010';
const staff = 'eeeeeeee-0000-4000-8000-000000000011';
const claim = `select public.claim_account_for_purge('${member}',
  (select deletion_requested_at from public.profiles where id='${member}'));`;
const coordinator = connect();
const cancellation = connect();
const worker = connect();
let created = false;
try {
  // A collision is an error; never remove or overwrite pre-existing fixtures.
  await coordinator.query(`begin;
    insert into auth.users(id,email) values
      ('${member}','purge.concurrent@example.test'),
      ('${staff}','purge.concurrent.admin@example.test');
    alter table public.profiles disable trigger guard_profile_privilege_changes_trigger;
    update public.profiles set role='super_administrator' where id='${staff}';
    update public.profiles set account_status='closed',
      deletion_requested_at=clock_timestamp()-interval '720 hours'+interval '10 seconds'
      where id='${member}';
    alter table public.profiles enable trigger guard_profile_privilege_changes_trigger;
    commit;`);
  created = true;
  await cancellation.query(`begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${member}',true);
    select public.cancel_account_deletion();`);
  await coordinator.query(`select pg_sleep(greatest(0, extract(epoch from
    (select deletion_requested_at + interval '720 hours' - clock_timestamp()
     from public.profiles where id='${member}'))));`);
  // Prove the old selection is stale while a valid cancellation is uncommitted.
  assert.equal(
    await coordinator.query(`select count(*) from public.accounts_due_for_purge(30)
    where id='${member}';`),
    '1',
  );
  assert.equal(
    await worker.query(claim),
    'f',
    'must skip a cancellation holding the lock',
  );
  await cancellation.query('commit;');
  assert.equal(
    await worker.query(claim),
    'f',
    'must not claim a successfully reopened account',
  );
  console.log(
    '  ok  stale purge candidate cannot defeat a successful cancellation',
  );

  await coordinator.query(`select set_config('request.jwt.claim.sub','${staff}',false);
    update public.profiles set account_status='closed',
      deletion_requested_at=clock_timestamp()-interval '721 hours' where id='${member}';`);
  await worker.query('begin;');
  assert.equal(await worker.query(claim), 't');
  // Staff starts reopening while the claim holds the lock. The trigger must
  // see the committed claim after waiting, even though its statement is older.
  const reopening =
    cancellation.query(`set application_name='ledger_purge_reopening_check';
    begin; set local role authenticated;
    select set_config('request.jwt.claim.sub','${staff}',true);
    do $$ begin
      begin
        update public.profiles set account_status='active', deletion_requested_at=null
        where id='${member}';
        raise exception 'Claimed account was reopened';
      exception when insufficient_privilege then null;
      end;
    end $$; commit;`);
  let waiting = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (
      (await coordinator.query(`select exists(select 1 from pg_stat_activity
      where application_name='ledger_purge_reopening_check' and wait_event_type='Lock');`)) ===
      't'
    ) {
      waiting = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(waiting, 'observed reopening blocked on the claim transaction');
  await worker.query('commit;');
  await reopening;
  assert.equal(
    await coordinator.query(
      `select account_status from public.profiles where id='${member}';`,
    ),
    'closed',
  );
  assert.equal(
    await worker.query(claim),
    't',
    'retry of a durable claim succeeds',
  );
  console.log(
    '  ok  committed claim prevents a waiting staff reversal and remains retryable',
  );

  // Check that stronger snapshot isolation cannot bypass the claim guard.
  // Recreate only our disposable member fixture; the admin fixture stays put.
  await coordinator.query(`delete from auth.users where id='${member}';
    insert into auth.users(id,email) values ('${member}','purge.concurrent@example.test');
    update public.profiles set account_status='closed',
      deletion_requested_at=clock_timestamp()-interval '721 hours' where id='${member}';`);
  await cancellation.query(`begin isolation level repeatable read;
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${staff}',true);
    select account_status from public.profiles where id='${member}';`);
  assert.equal(await worker.query(claim), 't');
  await cancellation.query(`do $$ begin
    begin
      update public.profiles set account_status='active', deletion_requested_at=null
      where id='${member}';
      raise exception 'Old snapshot bypassed purge claim';
    exception when serialization_failure then null;
    end;
    end $$; rollback;`);
  console.log(
    '  ok  pre-claim repeatable-read snapshot cannot reopen the account',
  );
} finally {
  await Promise.all(clients.slice(1).map((client) => client.close()));
  if (created)
    await coordinator.query(
      `delete from auth.users where id in ('${member}','${staff}');`,
    );
  await coordinator.close();
}
