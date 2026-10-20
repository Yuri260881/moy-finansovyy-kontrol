alter table public.payments add column request_id uuid unique;
revoke execute on function public.record_payment(uuid,numeric,date,text) from authenticated;
create function public.record_payment_once(p_obligation uuid,p_amount numeric,p_date date,p_comment text,p_request uuid) returns uuid language plpgsql security definer set search_path=public as $$
declare o public.obligations%rowtype; total numeric; result uuid;
begin
 if p_request is null then raise exception 'Request ID required'; end if;
 select * into o from public.obligations where id=p_obligation and user_id=auth.uid() for update;
 if not found or o.kind='report' or o.status='cancelled' then raise exception 'Payment unavailable'; end if;
 select id into result from public.payments where request_id=p_request and user_id=auth.uid();
 if found then return result; end if;
 if p_amount<=0 then raise exception 'Amount must be positive'; end if;
 select coalesce(sum(amount),0) into total from public.payments where obligation_id=p_obligation;
 if total+p_amount>o.planned_amount then raise exception 'Amount exceeds plan; adjust planned amount first'; end if;
 insert into public.payments(user_id,obligation_id,amount,paid_on,comment,request_id) values(auth.uid(),p_obligation,p_amount,p_date,coalesce(p_comment,''),p_request) returning id into result;
 return result;
end $$;
revoke all on function public.record_payment_once(uuid,numeric,date,text,uuid) from public;
grant execute on function public.record_payment_once(uuid,numeric,date,text,uuid) to authenticated;
