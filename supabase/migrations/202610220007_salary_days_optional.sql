-- Newly seeded employees have no pay schedule until the owner sets one.
alter table public.employees alter column day_advance drop not null;
alter table public.employees alter column day_final drop not null;
alter table public.employees alter column day_advance drop default;
alter table public.employees alter column day_final drop default;

update public.employees
set day_advance = null, day_final = null
where full_name in ('Сотрудник 1', 'Сотрудник 2', 'Сотрудник 3')
  and position = '' and object_id is null
  and salary = 0 and advance = 0
  and day_advance = 15 and day_final = 30
  and not exists (
    select 1 from public.payroll_accruals where employee_id = employees.id
  );
