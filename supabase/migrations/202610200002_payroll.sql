create function public.create_payroll_accrual() returns trigger language plpgsql security definer set search_path=public as $$
declare employee public.employees%rowtype;
begin
 if new.kind='salary' and new.employee_id is not null then
  select * into employee from public.employees where id=new.employee_id;
  insert into public.payroll_accruals(user_id,employee_id,obligation_id,period_month,stage,planned_amount)
  values(new.user_id,new.employee_id,new.id,date_trunc('month',new.due_date)::date,
    case when new.title like 'Аванс:%' then 'advance' else 'final' end,new.planned_amount)
  on conflict(obligation_id) do nothing;
 end if;
 return new;
end $$;
create trigger payroll_from_obligation after insert on public.obligations for each row execute function public.create_payroll_accrual();
