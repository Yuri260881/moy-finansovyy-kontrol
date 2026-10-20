-- Prevent references to another user's employee, and enforce numeric payment bounds.
create or replace function public.guard_owner() returns trigger language plpgsql as $$
declare owner uuid;
begin
 if tg_table_name in ('payments','payroll_accruals','receipts') then select user_id into owner from public.obligations where id=new.obligation_id;
 else owner:=new.user_id; end if;
 if owner is distinct from new.user_id then raise exception 'Cross-user reference'; end if;
 if tg_table_name='obligations' and new.template_id is not null and not exists(select 1 from public.templates where id=new.template_id and user_id=new.user_id) then raise exception 'Cross-user template'; end if;
 if tg_table_name in ('templates','obligations','employees') and new.object_id is not null and not exists(select 1 from public.objects where id=new.object_id and user_id=new.user_id) then raise exception 'Cross-user object'; end if;
 if tg_table_name in ('templates','obligations') and new.category_id is not null and not exists(select 1 from public.categories where id=new.category_id and user_id=new.user_id) then raise exception 'Cross-user category'; end if;
 if tg_table_name in ('templates','obligations','payroll_accruals') and new.employee_id is not null and not exists(select 1 from public.employees where id=new.employee_id and user_id=new.user_id) then raise exception 'Cross-user employee'; end if;
 return new;
end $$;
create function public.prevent_underfunded_plan() returns trigger language plpgsql as $$
begin
 if new.planned_amount < (select coalesce(sum(amount),0) from public.payments where obligation_id=new.id) then raise exception 'Plan cannot be less than already paid'; end if;
 return new;
end $$;
create trigger check_obligation_plan before update of planned_amount on public.obligations for each row execute function public.prevent_underfunded_plan();
