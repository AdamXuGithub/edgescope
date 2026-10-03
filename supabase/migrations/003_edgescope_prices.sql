-- Spot price log per asset and source, so the dashboard can show the on-chain (Solami Blur) price
-- next to the off-chain reference (Coinbase) and which source the model actually used.
create table if not exists public.es_prices (
  id bigint generated always as identity primary key,
  ts timestamptz not null default now(),
  asset text not null,           -- SOL / BTC / ETH
  source text not null,          -- solami-blur / coinbase-hourly
  mint text,                     -- Solana mint used for the on-chain price (null for Coinbase)
  spot numeric,
  vol_annual numeric,
  bars int,                      -- number of hourly bars used for volatility
  ok boolean not null default true,
  note text
);
create index if not exists es_prices_asset_ts on public.es_prices(asset, ts desc);
alter table public.es_prices enable row level security;
create policy es_prices_read on public.es_prices for select to anon, authenticated using (true);
