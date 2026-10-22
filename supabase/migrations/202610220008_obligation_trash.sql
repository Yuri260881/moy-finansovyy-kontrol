-- Soft deletion preserves receipts, payments, audit history and occurrence keys.
alter table public.obligations add column if not exists deleted_at timestamptz;

create or replace function public.trash_obligation(p_id uuid, p_series boolean default false)
returns void language plpgsql security definer set search_path=public as $$
declare o public.obligations%rowtype;
begin
 select * into o from public.obligations where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'Обязательство не найдено'; end if;
 if p_series and o.template_id is not null then
  update public.templates set active=false where id=o.template_id and user_id=auth.uid();
  update public.obligations set deleted_at=now() where template_id=o.template_id and user_id=auth.uid() and deleted_at is null;
 else
  update public.obligations set deleted_at=now() where id=o.id and deleted_at is null;
 end if;
end $$;

create or replace function public.restore_obligation(p_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 update public.obligations set deleted_at=null where id=p_id and user_id=auth.uid();
 if not found then raise exception 'Обязательство не найдено'; end if;
end $$;

create or replace function public.prevent_payment_in_trash()
returns trigger language plpgsql set search_path=public as $$
begin
 perform 1 from public.obligations where id=new.obligation_id and deleted_at is null for update;
 if not found then raise exception 'Нельзя оплатить удалённое обязательство'; end if;
 return new;
end $$;
create trigger payment_not_in_trash before insert or update on public.payments
for each row execute function public.prevent_payment_in_trash();
revoke all on function public.trash_obligation(uuid,boolean) from public;
revoke all on function public.restore_obligation(uuid) from public;
grant execute on function public.trash_obligation(uuid,boolean) to authenticated;
grant execute on function public.restore_obligation(uuid) to authenticated;
