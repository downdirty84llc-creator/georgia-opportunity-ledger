\set ON_ERROR_STOP on
begin;
do $$ declare first_run jsonb; second_run jsonb; run_id uuid;
begin
 first_run:=public.claim_job_run('recovery-fixture','today',now()); run_id:=(first_run->>'id')::uuid;
 if public.claim_job_run('recovery-fixture','today',now()) is not null then raise exception 'A concurrent worker took ownership'; end if;
 if not public.checkpoint_job_run(run_id,'{"cursor":"member-1105"}') then raise exception 'Could not save progress'; end if;
 update public.job_runs set lease_until=clock_timestamp()-interval '1 second' where id=run_id;
 second_run:=public.claim_job_run('recovery-fixture','today',now());
 if second_run->'state'->>'cursor'<>'member-1105' then raise exception 'Killed worker lost progress'; end if;
 if public.checkpoint_job_run(run_id,'{}') or public.finish_job_run(run_id,'{"status":"succeeded"}') then raise exception 'Stale worker changed a reclaimed job'; end if;
 if not public.finish_job_run((second_run->>'id')::uuid,'{"status":"failed"}') then raise exception 'Failure was not recorded'; end if;
 second_run:=public.claim_job_run('recovery-fixture','today',now());
 if second_run is null then raise exception 'Failed run did not release its window'; end if;
 if not public.finish_job_run((second_run->>'id')::uuid,'{"status":"succeeded"}') then raise exception 'Success was not recorded'; end if;
 if public.claim_job_run('recovery-fixture','today',now()) is not null then raise exception 'Completed window ran twice'; end if;
 if has_function_privilege('authenticated','public.checkpoint_job_run(uuid,jsonb)','execute') then raise exception 'Member can rewrite a job cursor'; end if;
 raise notice 'ok  live lease exclusion, checkpoint recovery, stale worker fencing, failed retry and completed window dedupe';
end $$;
rollback;
