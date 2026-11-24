create table public.plaid_items (
  owner uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  encrypted_token text not null,
  primary key (owner, item_id)
);
alter table public.plaid_items enable row level security;
revoke all on public.plaid_items from public, anon, authenticated;
grant select, insert, update, delete on public.plaid_items to service_role;
