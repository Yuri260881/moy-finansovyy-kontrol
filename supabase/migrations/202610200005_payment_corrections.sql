-- Corrections are explicit, audited cancellations; the client cannot mutate payment rows directly.
create function public.void_payment(p_payment uuid) returns void language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
 select obligation_id into target from public.payments where id=p_payment and user_id=auth.uid();
 if target is null then raise exception 'Payment not found'; end if;
 perform 1 from public.obligations where id=target for update;
 delete from public.payments where id=p_payment and user_id=auth.uid();
end $$;
revoke all on function public.void_payment(uuid) from public;
grant execute on function public.void_payment(uuid) to authenticated;
