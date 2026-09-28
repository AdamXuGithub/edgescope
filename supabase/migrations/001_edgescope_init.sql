-- EdgeScope tables (all prefixed es_). Public read-only via RLS; writes only from the collector (service role).
create table if not exists public.es_markets (
  market_id text primary key, category text, question text, phase text, status text,
  start_time timestamptz, end_time timestamptz, resolution_time timestamptz,
  oracle text, price_source text, resolved boolean, volume_usdc numeric, created_on_chain timestamptz,
  parsed jsonb, raw jsonb, first_seen timestamptz not null default now(), last_seen timestamptz not null default now()
);
create table if not exists public.es_snapshots (
  id bigint generated always as identity primary key,
  market_id text not null references public.es_markets(market_id) on delete cascade,
  ts timestamptz not null default now(), phase text, yes_price numeric, no_price numeric, volume_usdc numeric
);
create index if not exists es_snapshots_market_ts on public.es_snapshots(market_id, ts desc);
create table if not exists public.es_valuations (
  id bigint generated always as identity primary key,
  market_id text not null references public.es_markets(market_id) on delete cascade,
  ts timestamptz not null default now(), asset text, spot numeric, strike numeric, vol_annual numeric,
  years_to_expiry numeric, model_prob_yes numeric, market_prob_yes numeric, fee_rate numeric,
  quote_side text, quote_amount_usdc numeric, quote_shares numeric, cost_per_share numeric,
  net_edge numeric, depth_usdc numeric, price_source text, note text
);
create index if not exists es_valuations_market_ts on public.es_valuations(market_id, ts desc);
create table if not exists public.es_runs (
  id bigint generated always as identity primary key, ts timestamptz not null default now(), kind text, ok boolean, detail jsonb
);
alter table public.es_markets enable row level security;
alter table public.es_snapshots enable row level security;
alter table public.es_valuations enable row level security;
alter table public.es_runs enable row level security;
create policy es_markets_read on public.es_markets for select to anon, authenticated using (true);
create policy es_snapshots_read on public.es_snapshots for select to anon, authenticated using (true);
create policy es_valuations_read on public.es_valuations for select to anon, authenticated using (true);
create or replace view public.es_latest with (security_invoker = on) as
select m.market_id, m.category, m.question, m.phase, m.status, m.end_time, m.oracle, m.volume_usdc, m.parsed, m.first_seen,
  s.yes_price, s.ts as snap_ts,
  v.asset, v.spot, v.strike, v.vol_annual, v.years_to_expiry, v.model_prob_yes, v.market_prob_yes, v.fee_rate,
  v.quote_side, v.cost_per_share, v.net_edge, v.depth_usdc, v.price_source, v.note, v.ts as val_ts
from public.es_markets m
left join lateral (select * from public.es_snapshots s where s.market_id=m.market_id order by ts desc limit 1) s on true
left join lateral (select * from public.es_valuations v where v.market_id=m.market_id order by ts desc limit 1) v on true;
