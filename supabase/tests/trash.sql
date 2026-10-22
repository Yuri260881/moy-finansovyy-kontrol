-- Transactional integration test. No user financial records are changed.
begin;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles limit 1), true);
do $$
declare uid uuid := auth.uid(); t uuid; a uuid; b uuid; n int;
begin
 if uid is null then raise exception 'A seeded test user is required'; end if;
 insert into public.templates(user_id,title,start_date,planned_amount,recurrence)
 values(uid,'__transactional_trash_test__',current_date,10,'monthly') returning id into t;
 insert into public.obligations(user_id,template_id,kind,title,due_date,planned_amount)
 values(uid,t,'payment','__transactional_trash_test__',current_date,10) returning id into a;
 insert into public.obligations(user_id,template_id,kind,title,due_date,planned_amount)
 values(uid,t,'payment','__transactional_trash_test__',current_date+31,10) returning id into b;
 perform public.trash_obligation(a,false);
 if not exists(select 1 from public.obligations where id=a and deleted_at is not null) then raise exception 'single delete failed'; end if;
 if exists(select 1 from public.obligations where id=b and deleted_at is not null) then raise exception 'single deletion touched series'; end if;
 begin
  perform public.record_payment_once(a,1,current_date,'test',gen_random_uuid());
  raise exception 'payment allowed in trash';
 exception when others then
  if sqlerrm <> 'Нельзя оплатить удалённое обязательство' then raise; end if;
 end;
 perform public.restore_obligation(a);
 perform public.record_payment_once(a,1,current_date,'test',gen_random_uuid());
 perform public.trash_obligation(a,true);
 n := (select count(*) from public.obligations where template_id=t and deleted_at is not null);
 if n<>2 or exists(select 1 from public.templates where id=t and active) then raise exception 'series delete failed'; end if;
 if not exists(select 1 from public.payments where obligation_id=a) then raise exception 'payment history lost'; end if;
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
  perform public.restore_obligation(a);
  raise exception 'cross-user restore allowed';
 exception when others then
  if sqlerrm <> 'Обязательство не найдено' then raise; end if;
 end;
end $$;
rollback;
