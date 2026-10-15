-- Server-side per-user minute bucket for the ARWANA AI Edge Function.
-- Only the trusted service_role may call the RPC; browser roles have no table or RPC access.
create table if not exists public.arwana_ai_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null check (request_count >= 0)
);

alter table public.arwana_ai_rate_limits enable row level security;
revoke all on table public.arwana_ai_rate_limits from public, anon, authenticated, service_role;

create or replace function public.arwana_ai_consume_rate(
  p_user_id uuid,
  p_window_start timestamptz,
  p_limit integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_count integer;
begin
  if p_user_id is null or p_window_start is null or p_limit is null or p_limit < 1 then
    return false;
  end if;

  insert into public.arwana_ai_rate_limits as current_limit (user_id, window_start, request_count)
  values (p_user_id, p_window_start, 1)
  on conflict (user_id) do update
    set window_start = excluded.window_start,
        request_count = case
          when current_limit.window_start = excluded.window_start then current_limit.request_count + 1
          else 1
        end
  returning request_count into v_request_count;

  return v_request_count <= p_limit;
end;
$$;

revoke all on function public.arwana_ai_consume_rate(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.arwana_ai_consume_rate(uuid, timestamptz, integer) to service_role;
