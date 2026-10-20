-- Private application storage: never exposed through the public Data API.
create schema if not exists brawl_private;
revoke all on schema brawl_private from public, anon, authenticated;
create table brawl_private.sheets (
  name text primary key,
  headers jsonb not null check (jsonb_typeof(headers) = 'array')
);
create table brawl_private.rows (
  sheet text not null references brawl_private.sheets(name),
  row_no integer not null check (row_no >= 2),
  cells jsonb not null check (jsonb_typeof(cells) = 'array'),
  primary key (sheet,row_no) deferrable initially deferred
);
create index brawl_row_lookup on brawl_private.rows(sheet,(cells->>0));
create table brawl_private.settings (key text primary key, value text not null);
create table brawl_private.cache (key text primary key, value text not null, expires_at timestamptz not null);
create index brawl_cache_expiry on brawl_private.cache(expires_at);
create table brawl_private.rate_limits (key text primary key, hits integer not null, expires_at timestamptz not null);
alter table brawl_private.sheets enable row level security;
alter table brawl_private.rows enable row level security;
alter table brawl_private.settings enable row level security;
alter table brawl_private.cache enable row level security;
alter table brawl_private.rate_limits enable row level security;
revoke all on all tables in schema brawl_private from public,anon,authenticated;
alter default privileges in schema brawl_private revoke all on tables from public,anon,authenticated;
