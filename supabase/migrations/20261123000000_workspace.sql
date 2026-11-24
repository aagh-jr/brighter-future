create table public.workspaces (
  owner uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  ledger jsonb not null check (
    jsonb_typeof(ledger) = 'object' and octet_length(ledger::text) <= 5000000
    and ledger ?& array['accounts','transactions','budgets','goals']
    and jsonb_typeof(ledger->'accounts') = 'array'
    and jsonb_typeof(ledger->'transactions') = 'array'
    and jsonb_typeof(ledger->'budgets') = 'array'
    and jsonb_typeof(ledger->'goals') = 'array'
  ),
  version integer not null default 1 check (version > 0)
);
alter table public.workspaces enable row level security;
revoke all on public.workspaces from anon, authenticated;
grant select, insert, update on public.workspaces to authenticated;
create policy workspace_read on public.workspaces for select to authenticated using ((select auth.uid()) = owner);
create policy workspace_insert on public.workspaces for insert to authenticated with check ((select auth.uid()) = owner);
create policy workspace_update on public.workspaces for update to authenticated using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
