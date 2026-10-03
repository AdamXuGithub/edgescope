// Read-only access to EdgeScope tables. The anon key is public by design; tables are read-only under RLS.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://tliofworxwafybsropjy.supabase.co";
const SUPABASE_ANON =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRsaW9md29yeHdhZnlic3JvcGp5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTMxOTQsImV4cCI6MjA5Njk4OTE5NH0.vEe15BbRxOeYMeT1Hv1T_iNKGT_XB-iiwKn8gWKIEcs";

export type Row = {
  market_id: string;
  category: string | null;
  question: string | null;
  phase: string | null;
  status: string | null;
  end_time: string | null;
  oracle: string | null;
  volume_usdc: number | null;
  first_seen: string | null;
  yes_price: number | null;
  snap_ts: string | null;
  asset: string | null;
  spot: number | null;
  strike: number | null;
  vol_annual: number | null;
  years_to_expiry: number | null;
  model_prob_yes: number | null;
  market_prob_yes: number | null;
  fee_rate: number | null;
  quote_side: string | null;
  cost_per_share: number | null;
  net_edge: number | null;
  depth_usdc: number | null;
  price_source: string | null;
  note: string | null;
  val_ts: string | null;
};

async function rest<T>(path: string): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

export async function getLatest(): Promise<Row[]> {
  const now = new Date().toISOString();
  return rest<Row[]>(`es_latest?select=*&end_time=gt.${now}&order=first_seen.desc`);
}

export async function getHistory(marketId: string) {
  return rest<{ ts: string; model_prob_yes: number | null; market_prob_yes: number | null }[]>(
    `es_valuations?select=ts,model_prob_yes,market_prob_yes&market_id=eq.${encodeURIComponent(marketId)}&order=ts.asc&limit=2000`,
  );
}

export type PriceRow = {
  ts: string;
  asset: string;
  source: string;
  ok: boolean;
  spot: number | null;
  vol_annual: number | null;
  bars: number | null;
  note: string | null;
};

// Last ~24h of price observations for SOL / BTC / ETH from both sources.
export async function getPrices(): Promise<PriceRow[]> {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  return rest<PriceRow[]>(
    `es_prices?select=ts,asset,source,ok,spot,vol_annual,bars,note&ts=gt.${since}&order=ts.asc&limit=5000`,
  );
}
