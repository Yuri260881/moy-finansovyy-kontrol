-- PL/pgSQL may evaluate Boolean operands in any order. A field specific to
-- obligations must only be read after the trigger's table has been checked.
create or replace function public.guard_owner() returns trigger
language plpgsql as $$
declare owner uuid;
begin
  if tg_table_name in ('payments', 'payroll_accruals', 'receipts') then
    select user_id into owner from public.obligations where id = new.obligation_id;
  else
    owner := new.user_id;
  end if;

  if owner is distinct from new.user_id then
    raise exception 'Cross-user reference';
  end if;

  if tg_table_name = 'obligations' then
    if new.template_id is not null and not exists (
      select 1 from public.templates where id = new.template_id and user_id = new.user_id
    ) then raise exception 'Cross-user template'; end if;
  end if;

  if tg_table_name in ('templates', 'obligations', 'employees') then
    if new.object_id is not null and not exists (
      select 1 from public.objects where id = new.object_id and user_id = new.user_id
    ) then raise exception 'Cross-user object'; end if;
  end if;

  if tg_table_name in ('templates', 'obligations') then
    if new.category_id is not null and not exists (
      select 1 from public.categories where id = new.category_id and user_id = new.user_id
    ) then raise exception 'Cross-user category'; end if;
  end if;

  if tg_table_name in ('templates', 'obligations', 'payroll_accruals') then
    if new.employee_id is not null and not exists (
      select 1 from public.employees where id = new.employee_id and user_id = new.user_id
    ) then raise exception 'Cross-user employee'; end if;
  end if;

  return new;
end $$;
