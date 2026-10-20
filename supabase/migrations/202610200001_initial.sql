create extension if not exists pgcrypto;
create table public.profiles (id uuid primary key references auth.users on delete cascade, timezone text not null default 'Europe/Moscow', setup_done boolean not null default false, created_at timestamptz not null default now());
create table public.objects (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, name text not null, kind text not null check(kind in ('shop','apartment')), archived boolean not null default false, created_at timestamptz not null default now(), unique(user_id,name));
create table public.categories (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, name text not null, scope text not null check(scope in ('shop','apartment','business')), unique(user_id,name,scope));
create table public.employees (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, full_name text not null, position text not null default '', object_id uuid references public.objects on delete set null, salary numeric(14,2) not null default 0 check(salary>=0), advance numeric(14,2) not null default 0 check(advance>=0), day_advance int not null default 15 check(day_advance between 1 and 31), day_final int not null default 30 check(day_final between 1 and 31), active boolean not null default true);
create table public.templates (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, title text not null, kind text not null default 'payment' check(kind in ('payment','salary','tax','report')), object_id uuid references public.objects on delete set null, category_id uuid references public.categories on delete set null, employee_id uuid references public.employees on delete cascade, planned_amount numeric(14,2) not null default 0 check(planned_amount>=0), start_date date not null, end_date date, recurrence text not null default 'once' check(recurrence in ('once','weekly','monthly','bimonthly','quarterly','semiannual','yearly','custom','twice_monthly')), days int[] not null default '{}', custom_dates date[] not null default '{}', payment_method text not null default '', notes text not null default '', period_label text not null default '', reminder_days int[] not null default '{7,3,1,0,-1}', active boolean not null default true, source_info text not null default '', created_at timestamptz not null default now());
create table public.obligations (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, template_id uuid references public.templates on delete set null, kind text not null check(kind in ('payment','salary','tax','report')), title text not null, object_id uuid references public.objects on delete set null, category_id uuid references public.categories on delete set null, employee_id uuid references public.employees on delete set null, due_date date not null, planned_amount numeric(14,2) not null default 0 check(planned_amount>=0), status text not null default 'planned' check(status in ('planned','cancelled','prepared','sent','accepted')), period_label text not null default '', payment_method text not null default '', notes text not null default '', reminder_days int[] not null default '{7,3,1,0,-1}', created_at timestamptz not null default now(), unique(template_id,due_date));
create table public.payments (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, obligation_id uuid not null references public.obligations on delete cascade, amount numeric(14,2) not null check(amount>0), paid_on date not null, comment text not null default '', created_at timestamptz not null default now());
create table public.payroll_accruals (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, employee_id uuid not null references public.employees on delete cascade, obligation_id uuid not null unique references public.obligations on delete cascade, period_month date not null, stage text not null check(stage in ('advance','final')), planned_amount numeric(14,2) not null check(planned_amount>=0));
create table public.reminder_log (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, obligation_id uuid not null references public.obligations on delete cascade, channel text not null check(channel in ('in_app','email','telegram')), offset_days int not null, scheduled_for date not null, sent_at timestamptz not null default now(), error text, unique(obligation_id,channel,offset_days,scheduled_for));
create table public.connections (user_id uuid primary key references public.profiles on delete cascade, google_refresh_token text, google_calendar_id text, telegram_chat_id text, email_enabled boolean not null default false, telegram_enabled boolean not null default false, updated_at timestamptz not null default now());
create table public.user_settings (user_id uuid primary key references public.profiles on delete cascade, tax_regime text not null default '', has_employees boolean not null default true, theme text not null default 'light', updated_at timestamptz not null default now());
create table public.receipts (id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, obligation_id uuid not null references public.obligations on delete cascade, payment_id uuid references public.payments on delete set null, storage_path text not null, filename text not null, created_at timestamptz not null default now());
create table public.audit_log (id bigint generated always as identity primary key, user_id uuid not null, entity text not null, entity_id uuid not null, action text not null, old_value jsonb, new_value jsonb, changed_at timestamptz not null default now());
create table public.calendar_events (user_id uuid not null references public.profiles on delete cascade, obligation_id uuid not null references public.obligations on delete cascade, calendar_id text not null, event_id text not null, primary key(obligation_id,calendar_id));
create index obligations_user_due on public.obligations(user_id,due_date);
create index payments_user_date on public.payments(user_id,paid_on);
create index templates_user_active on public.templates(user_id,active);

create function public.seed_user() returns trigger language plpgsql security definer set search_path=public as $$
declare n text; s text;
begin
 insert into public.profiles(id) values(new.id);
 insert into public.user_settings(user_id) values(new.id);
 insert into public.connections(user_id) values(new.id);
 insert into public.objects(user_id,name,kind) values(new.id,'Взлетная','shop'),(new.id,'Демократическая','shop'),(new.id,'Свердлова','shop'),(new.id,'Вардане','apartment'),(new.id,'Костромская','apartment');
 foreach n in array array['Аренда','Электроэнергия','Водоснабжение','Интернет','Связь','Коммунальные услуги','Вывоз мусора','Охрана','Обслуживание оборудования','Другие расходы'] loop insert into public.categories(user_id,name,scope) values(new.id,n,'shop'); end loop;
 foreach n in array array['Электроэнергия','Вода','Газ','Интернет','Квартплата','Капитальный ремонт','Налог на имущество','Другие расходы'] loop insert into public.categories(user_id,name,scope) values(new.id,n,'apartment'); end loop;
 foreach n in array array['Зарплата сотрудников','Страховые взносы','НДФЛ','Налоги ИП','Фиксированные взносы ИП','Бухгалтерские услуги','Банковские комиссии','Прочие обязательные платежи'] loop insert into public.categories(user_id,name,scope) values(new.id,n,'business'); end loop;
 for i in 1..3 loop insert into public.employees(user_id,full_name) values(new.id,'Сотрудник '||i); end loop;
 return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.seed_user();

-- Generated instances have a stable (template,date) key. Generate a rolling 24 month window.
create function public.generate_occurrences(p_user uuid, p_until date default (current_date + interval '24 months')::date) returns integer language plpgsql security definer set search_path=public as $$
declare t public.templates%rowtype; d date; month_cursor date; day_no int; step_months int; inserted int := 0; start_month date;
begin
 if auth.uid() is distinct from p_user and current_setting('role',true) <> 'service_role' then raise exception 'unauthorized'; end if;
 for t in select * from public.templates where user_id=p_user and active loop
  if t.recurrence in ('once','custom') then
   for d in select unnest(case when t.recurrence='once' then array[t.start_date] else t.custom_dates end) loop
    if d between t.start_date and p_until and (t.end_date is null or d<=t.end_date) then
     insert into public.obligations(user_id,template_id,kind,title,object_id,category_id,employee_id,due_date,planned_amount,period_label,payment_method,notes,reminder_days) values(t.user_id,t.id,t.kind,t.title,t.object_id,t.category_id,t.employee_id,d,t.planned_amount,t.period_label,t.payment_method,t.notes,t.reminder_days) on conflict(template_id,due_date) do nothing;
     get diagnostics inserted = row_count; end if;
   end loop;
  elsif t.recurrence='weekly' then
   d:=t.start_date;
   while d<=p_until and (t.end_date is null or d<=t.end_date) loop
    insert into public.obligations(user_id,template_id,kind,title,object_id,category_id,employee_id,due_date,planned_amount,period_label,payment_method,notes,reminder_days) values(t.user_id,t.id,t.kind,t.title,t.object_id,t.category_id,t.employee_id,d,t.planned_amount,t.period_label,t.payment_method,t.notes,t.reminder_days) on conflict(template_id,due_date) do nothing;
    d:=d+7;
   end loop;
  else
   step_months:=case t.recurrence when 'bimonthly' then 2 when 'quarterly' then 3 when 'semiannual' then 6 when 'yearly' then 12 else 1 end;
   start_month:=date_trunc('month',t.start_date)::date; month_cursor:=start_month;
   while month_cursor<=p_until and (t.end_date is null or month_cursor<=t.end_date) loop
    for day_no in select unnest(case when t.recurrence='twice_monthly' then t.days else array[extract(day from t.start_date)::int] end) loop
     d:=month_cursor + (least(day_no,extract(day from (month_cursor+interval '1 month - 1 day'))::int)-1);
     if d>=t.start_date and d<=p_until and (t.end_date is null or d<=t.end_date) then
      insert into public.obligations(user_id,template_id,kind,title,object_id,category_id,employee_id,due_date,planned_amount,period_label,payment_method,notes,reminder_days) values(t.user_id,t.id,t.kind,t.title,t.object_id,t.category_id,t.employee_id,d,t.planned_amount,t.period_label,t.payment_method,t.notes,t.reminder_days) on conflict(template_id,due_date) do nothing;
     end if;
    end loop;
    month_cursor:=(month_cursor + make_interval(months=>step_months))::date;
   end loop;
  end if;
 end loop;
 return inserted;
end $$;

create function public.record_payment(p_obligation uuid,p_amount numeric,p_date date,p_comment text default '') returns uuid language plpgsql security definer set search_path=public as $$
declare o public.obligations%rowtype; total numeric; payment_id uuid;
begin
 select * into o from public.obligations where id=p_obligation and user_id=auth.uid() for update;
 if not found or o.kind='report' or o.status='cancelled' then raise exception 'Payment unavailable'; end if;
 if p_amount<=0 then raise exception 'Amount must be positive'; end if;
 select coalesce(sum(amount),0) into total from public.payments where obligation_id=p_obligation;
 if total+p_amount>o.planned_amount then raise exception 'Amount exceeds plan; adjust planned amount first'; end if;
 insert into public.payments(user_id,obligation_id,amount,paid_on,comment) values(auth.uid(),p_obligation,p_amount,p_date,coalesce(p_comment,'')) returning id into payment_id;
 return payment_id;
end $$;
revoke all on function public.record_payment(uuid,numeric,date,text) from public;
grant execute on function public.record_payment(uuid,numeric,date,text) to authenticated;
revoke all on function public.generate_occurrences(uuid,date) from public;
grant execute on function public.generate_occurrences(uuid,date) to authenticated,service_role;

create function public.guard_owner() returns trigger language plpgsql as $$
declare owner uuid;
begin
 if tg_table_name='payments' then select user_id into owner from public.obligations where id=new.obligation_id;
 elsif tg_table_name='payroll_accruals' then select user_id into owner from public.obligations where id=new.obligation_id;
 elsif tg_table_name='receipts' then select user_id into owner from public.obligations where id=new.obligation_id;
 else owner:=new.user_id; end if;
 if owner is distinct from new.user_id then raise exception 'Cross-user reference'; end if;
 if tg_table_name='obligations' and new.template_id is not null and not exists(select 1 from public.templates where id=new.template_id and user_id=new.user_id) then raise exception 'Cross-user template'; end if;
 if tg_table_name in ('templates','obligations','employees') and new.object_id is not null and not exists(select 1 from public.objects where id=new.object_id and user_id=new.user_id) then raise exception 'Cross-user object'; end if;
 if tg_table_name in ('templates','obligations') and new.category_id is not null and not exists(select 1 from public.categories where id=new.category_id and user_id=new.user_id) then raise exception 'Cross-user category'; end if;
 return new;
end $$;
create trigger guard_templates before insert or update on public.templates for each row execute function public.guard_owner();
create trigger guard_obligations before insert or update on public.obligations for each row execute function public.guard_owner();
create trigger guard_employees before insert or update on public.employees for each row execute function public.guard_owner();
create trigger guard_payments before insert or update on public.payments for each row execute function public.guard_owner();
create trigger guard_receipts before insert or update on public.receipts for each row execute function public.guard_owner();
create trigger guard_payroll before insert or update on public.payroll_accruals for each row execute function public.guard_owner();
create function public.audit_finance() returns trigger language plpgsql security definer set search_path=public as $$ begin
 insert into public.audit_log(user_id,entity,entity_id,action,old_value,new_value) values(coalesce(new.user_id,old.user_id),tg_table_name,coalesce(new.id,old.id),tg_op,case when tg_op='INSERT' then null else to_jsonb(old) end,case when tg_op='DELETE' then null else to_jsonb(new) end);
 return coalesce(new,old); end $$;
create trigger audit_templates after insert or update or delete on public.templates for each row execute function public.audit_finance();
create trigger audit_obligations after insert or update or delete on public.obligations for each row execute function public.audit_finance();
create trigger audit_payments after insert or update or delete on public.payments for each row execute function public.audit_finance();
create trigger audit_employees after insert or update or delete on public.employees for each row execute function public.audit_finance();

-- Browser cannot read OAuth tokens or reminder delivery state. Edge Functions use service role.
revoke all on public.connections,public.calendar_events from anon,authenticated;
revoke all on public.audit_log from anon,authenticated;
grant select on public.audit_log to authenticated;
do $$ declare tbl text; begin
 foreach tbl in array array['profiles','objects','categories','employees','templates','obligations','payments','payroll_accruals','reminder_log','connections','user_settings','receipts','audit_log','calendar_events'] loop
  execute format('alter table public.%I enable row level security',tbl);
 end loop;
end $$;
create policy own_profiles on public.profiles for all to authenticated using(id=auth.uid()) with check(id=auth.uid());
create policy own_objects on public.objects for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_categories on public.categories for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_employees on public.employees for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_templates on public.templates for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_obligations on public.obligations for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_payments on public.payments for select to authenticated using(user_id=auth.uid());
create policy own_payroll on public.payroll_accruals for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_reminder_log on public.reminder_log for select to authenticated using(user_id=auth.uid());
create policy own_settings on public.user_settings for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_receipts on public.receipts for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
create policy own_audit on public.audit_log for select to authenticated using(user_id=auth.uid());
insert into storage.buckets(id,name,public,file_size_limit) values('receipts','receipts',false,10485760) on conflict(id) do nothing;
create policy receipts_read on storage.objects for select to authenticated using(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
create policy receipts_insert on storage.objects for insert to authenticated with check(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);
create policy receipts_delete on storage.objects for delete to authenticated using(bucket_id='receipts' and (storage.foldername(name))[1]=auth.uid()::text);

