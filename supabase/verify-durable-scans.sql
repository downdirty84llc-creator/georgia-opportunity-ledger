\set ON_ERROR_STOP on
begin;
insert into public.reports(id,title,slug,report_type,status,minimum_access_rank,published_at)
values ('98989898-9898-4898-8898-989898989898','Durable scanner fixture','durable-scanner-fixture','weekly','published',0,now());
insert into public.attachments(id,report_id,file_name,file_path,mime_type,file_size,checksum,scan_status)
select md5('bouncer-test-'||n)::uuid,'98989898-9898-4898-8898-989898989898',n||'.pdf','bouncer-fixture/'||n||'.pdf','application/pdf',10,repeat('a',64),'pending'
from generate_series(1,5) n;
do $$
declare v_id uuid:=md5('bouncer-test-1')::uuid; lease uuid:='11111111-1111-4111-8111-111111111111'; other uuid:='22222222-2222-4222-8222-222222222222'; j jsonb; fn text;
begin
  foreach fn in array array['pending_attachment_scans()','claim_attachment_scan(uuid,uuid)','begin_attachment_scan(uuid,uuid)','checkpoint_attachment_scan(uuid,uuid,text)','finish_attachment_scan(uuid,uuid,text,text)'] loop
    if has_function_privilege('anon','public.'||fn,'execute') or has_function_privilege('authenticated','public.'||fn,'execute') then raise exception 'Client can execute scanner mutation %',fn; end if;
    if not has_function_privilege('service_role','public.'||fn,'execute') then raise exception 'Worker cannot execute %',fn; end if;
  end loop;
  if has_table_privilege('authenticated','public.attachment_scan_jobs','select') or has_table_privilege('anon','public.attachment_scan_jobs','insert') then raise exception 'Scanner state leaked'; end if;
  raise notice 'ok  scanner RPCs and task rows are service-only';
  j:=public.claim_attachment_scan(v_id,lease);
  if j->>'phase'<>'ready' or (j->>'start_new')::boolean is distinct from true then raise exception 'First claim missing'; end if;
  if public.claim_attachment_scan(v_id,other) is not null then raise exception 'Two workers claimed same file'; end if;
  if public.finish_attachment_scan(v_id,lease,'clean',null) then raise exception 'Unsubmitted file cleared'; end if;
  raise notice 'ok  one worker owns a claim and cannot clear before submission';
  if not public.finish_attachment_scan(v_id,lease,'retry','download unavailable') then raise exception 'Download retry failed'; end if;
  update public.attachment_scan_jobs set next_attempt_at=now()-interval '1 minute' where attachment_id=v_id;
  j:=public.claim_attachment_scan(v_id,other);
  if j->>'phase'<>'ready' then raise exception 'Download retry spent scan state'; end if;
  if not public.begin_attachment_scan(v_id,other) then raise exception 'Could not mark provider creation'; end if;
  if public.begin_attachment_scan(v_id,lease) then raise exception 'Stale worker began submission'; end if;
  raise notice 'ok  download failures can retry without requesting a provider scan';
  update public.attachment_scan_jobs set lease_until=now()-interval '1 minute' where attachment_id=v_id;
  j:=public.claim_attachment_scan(v_id,lease);
  if j->>'phase'<>'requesting' or (j->>'start_new')::boolean then raise exception 'Uncertain submission was restarted'; end if;
  if public.checkpoint_attachment_scan(v_id,other,'scan_stale') then raise exception 'Expired worker checkpoint accepted'; end if;
  if not public.finish_attachment_scan(v_id,lease,'failed','uncertain submission') then raise exception 'Could not record uncertain submission'; end if;
  if public.claim_attachment_scan(v_id,other) is not null then raise exception 'Review task automatically retried'; end if;
  raise notice 'ok  lost creation responses require review and cannot spend another credit';

  v_id:=md5('bouncer-test-2')::uuid;
  perform public.claim_attachment_scan(v_id,lease);
  perform public.begin_attachment_scan(v_id,lease);
  if not public.checkpoint_attachment_scan(v_id,lease,'scan_saved') then raise exception 'Checkpoint failed'; end if;
  if not public.finish_attachment_scan(v_id,lease,'pending','provider still scanning') then raise exception 'Pending checkpoint failed'; end if;
  update public.attachment_scan_jobs set next_attempt_at=now()-interval '1 minute' where attachment_id=v_id;
  j:=public.claim_attachment_scan(v_id,other);
  if j->>'provider_scan_id'<>'scan_saved' or j->>'phase'<>'polling' or (j->>'start_new')::boolean then raise exception 'Saved ID lost'; end if;
  if public.finish_attachment_scan(v_id,lease,'infected','stale hit') then raise exception 'Stale verdict accepted'; end if;
  if not public.finish_attachment_scan(v_id,other,'clean',null) then raise exception 'Clean completion failed'; end if;
  if public.finish_attachment_scan(v_id,other,'failed','late failure') then raise exception 'Terminal verdict replaced'; end if;
  if (select scan_status from public.attachments where attachments.id=v_id)<>'clean' then raise exception 'Clean verdict lost'; end if;
  raise notice 'ok  polls reuse provider ID and stale workers cannot replace a final verdict';

  v_id:=md5('bouncer-test-3')::uuid;
  perform public.claim_attachment_scan(v_id,lease);
  perform public.begin_attachment_scan(v_id,lease);
  perform public.checkpoint_attachment_scan(v_id,lease,'scan_infected');
  perform public.finish_attachment_scan(v_id,lease,'infected','malware detected');
  if (select scan_status from public.attachments where attachments.id=v_id)<>'infected' then raise exception 'Quarantine not persisted'; end if;
  if public.finish_attachment_scan(v_id,lease,'clean',null) then raise exception 'Quarantine reversed'; end if;
  update public.attachment_scan_jobs set lease_until=now()-interval '1 minute' where attachment_id=v_id;
  j:=public.claim_attachment_scan(v_id,other);
  if j->>'phase'<>'quarantined' or j->>'provider_scan_id'<>'scan_infected' then raise exception 'Removal retry lost scan state'; end if;
  if not public.finish_attachment_scan(v_id,other,'removed',null) then raise exception 'Removal completion failed'; end if;
  if (select scan_status from public.attachments where attachments.id=v_id)<>'infected' then raise exception 'Removal made malware readable'; end if;
  raise notice 'ok  quarantined object removal resumes without clearing or rescanning';

  v_id:=md5('bouncer-test-4')::uuid;
  perform public.claim_attachment_scan(v_id,lease);
  perform public.begin_attachment_scan(v_id,lease);
  perform public.checkpoint_attachment_scan(v_id,lease,'scan_changed');
  update public.attachments set checksum=repeat('b',64) where attachments.id=v_id;
  if public.finish_attachment_scan(v_id,lease,'clean',null) then raise exception 'Changed object cleared by old scan'; end if;
  update public.attachment_scan_jobs set lease_until=now()-interval '1 minute' where attachment_id=v_id;
  if public.claim_attachment_scan(v_id,other) is not null then raise exception 'Changed task silently reused'; end if;
  if (select phase from public.attachment_scan_jobs where attachment_id=v_id)<>'review' then raise exception 'Changed task not flagged'; end if;
  raise notice 'ok  a verdict cannot clear changed attachment metadata';
end;
$$;
rollback;
