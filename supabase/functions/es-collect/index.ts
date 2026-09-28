// EdgeScope collector: pulls Panta markets, stores price snapshots, values crypto markets.
// Runs on a schedule (pg_cron -> this function). Research / education tool only.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PANTA = "https://live-api.panta.market/api/v1";
const PANTA_KEY = Deno.env.get("PANTA_API_KEY") ?? "";
// Any funded public wallet works for quote simulation; nothing is signed or sent.
const QUOTE_WALLET = Deno.env.get("QUOTE_WALLET") ?? "Bji2jpKEYAphqJv9q3J8cXJPcnWLtamWD21zLSqHkE2z";
const FEE_RATE = 0.02; // Panta primary fee, about 200 basis points
const DEPTH_STEPS = [10, 25, 50, 100, 250, 500, 1000, 2500];

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const H = { "X-Api-Key": PANTA_KEY, "Content-Type": "application/json" };

type Parsed = {
  asset: string | null;
  kind: "close_above" | "close_below" | "touch" | null;
  strike: number | null;
  dir?: "up" | "down" | "either";
  reason?: string;
};

const ASSETS: Record<string, string[]> = {
  BTC: ["bitcoin", "btc"],
  ETH: ["ethereum", "eth", "ether"],
  SOL: ["solana", "sol"],
};

export function parseQuestion(q: string): Parsed {
  const t = (q || "").toLowerCase();
  if (!t) return { asset: null, kind: null, strike: null, reason: "Untitled market" };
  if (t.includes("marketcap") || t.includes("market cap")) {
    return { asset: null, kind: null, strike: null, reason: "Market-cap question: no model yet" };
  }
  let asset: string | null = null;
  for (const [sym, words] of Object.entries(ASSETS)) {
    if (words.some((w) => new RegExp(`(^|[^a-z$])\\$?${w}([^a-z]|$)`).test(t))) { asset = sym; break; }
  }
  if (!asset) return { asset: null, kind: null, strike: null, reason: "Not a BTC/ETH/SOL price question: no model" };
  const m = t.match(/\$\s?([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|m)?/) ?? t.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|m)?\s*(?:usd|dollars)/);
  if (!m) return { asset, kind: null, strike: null, reason: "No price level found in the question" };
  let strike = parseFloat(m[1].replace(/,/g, ""));
  if (m[2] === "k") strike *= 1e3;
  if (m[2] === "m") strike *= 1e6;
  let kind: Parsed["kind"] = null;
  let dir: Parsed["dir"];
  if (/\b(drop to|fall to|dip to|drop below|fall below)\b/.test(t)) { kind = "touch"; dir = "down"; }
  else if (/\b(hit|reach|touch|cross)\b/.test(t)) { kind = "touch"; dir = "either"; }
  else if (/(at or above|above|over|higher than|greater than|>=)/.test(t)) kind = "close_above";
  else if (/(at or below|below|under|lower than|less than|<=)/.test(t)) kind = "close_below";
  if (!kind) return { asset, kind: null, strike, reason: "Resolution rule not recognised: no model" };
  return { asset, kind, strike, dir };
}

// Standard normal cumulative distribution
function ncdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const s = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const tt = 1 / (1 + p * z);
  const y = 1 - (((((a5 * tt + a4) * tt) + a3) * tt + a2) * tt + a1) * tt * Math.exp(-z * z);
  return 0.5 * (1 + s * y);
}

// Probability under a driftless (martingale) lognormal model using realised volatility.
export function modelProb(kind: string, S: number, K: number, sigma: number, T: number, dir: string = "either"): number {
  const sT = sigma * Math.sqrt(T);
  if (kind === "close_above" || kind === "close_below") {
    const d2 = (Math.log(S / K) - 0.5 * sigma * sigma * T) / sT;
    const pAbove = ncdf(d2);
    return kind === "close_above" ? pAbove : 1 - pAbove;
  }
  // touch: first-passage probability of log price hitting a barrier
  if (dir === "down" && S <= K) return 1;
  if (dir === "up" && S >= K) return 1;
  if (K >= S) {
    const b = Math.log(K / S), mu = -0.5 * sigma * sigma;
    return Math.min(1, ncdf((-b + mu * T) / sT) + Math.exp((2 * mu * b) / (sigma * sigma)) * ncdf((-b - mu * T) / sT));
  } else {
    const b = Math.log(S / K), mu = 0.5 * sigma * sigma;
    return Math.min(1, ncdf((-b + mu * T) / sT) + Math.exp((2 * mu * b) / (sigma * sigma)) * ncdf((-b - mu * T) / sT));
  }
}

// Price source. Until Solami is connected this uses Coinbase public hourly candles.
async function spotAndVol(asset: string): Promise<{ spot: number; vol: number; source: string } | null> {
  const r = await fetch(`https://api.exchange.coinbase.com/products/${asset}-USD/candles?granularity=3600`, {
    headers: { "User-Agent": "EdgeScope" },
  });
  if (!r.ok) return null;
  const rows: number[][] = await r.json(); // [time, low, high, open, close, volume], newest first
  const closes = rows.map((x) => x[4]).reverse();
  if (closes.length < 48) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return { spot: closes[closes.length - 1], vol: Math.sqrt(v * 24 * 365), source: "coinbase-hourly" };
}

async function pantaGet(path: string) {
  const r = await fetch(`${PANTA}${path}`, { headers: H });
  if (!r.ok) throw new Error(`Panta ${path} ${r.status}`);
  return r.json();
}

async function quote(marketId: string, side: string, amount: number) {
  const r = await fetch(`${PANTA}/primaryorderquote/`, {
    method: "POST",
    headers: H,
    body: JSON.stringify({ wallet: QUOTE_WALLET, marketId, side, amountUsdc: amount.toFixed(2) }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const shares = parseFloat(j.shares);
  if (!shares) return null;
  return { amount, shares, cost: amount / shares };
}

const ts = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);

Deno.serve(async () => {
  const started = Date.now();
  const log: Record<string, unknown> = {};
  try {
    if (!PANTA_KEY) throw new Error("PANTA_API_KEY not set");
    // throttle: skip if a run finished in the last 60 seconds
    const { data: last } = await sb.from("es_runs").select("ts").eq("kind", "collect").eq("ok", true)
      .order("ts", { ascending: false }).limit(1);
    if (last?.[0] && Date.now() - new Date(last[0].ts).getTime() < 60_000) {
      return new Response(JSON.stringify({ skipped: true }), { headers: { "Content-Type": "application/json" } });
    }

    // 1. catalogue
    const all: any[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const j = await pantaGet(`/markets/${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      all.push(...(j.items ?? []));
      cursor = j.nextCursor ?? null;
      pages++;
    } while (cursor && pages < 50);
    log.catalogue = all.length;

    const now = Date.now() / 1000;
    const live = all.filter((m) => !m.resolved && m.endTime && m.endTime > now);
    log.live = live.length;

    // 2. detail + snapshot for live markets
    const priceCache: Record<string, Awaited<ReturnType<typeof spotAndVol>>> = {};
    let valued = 0, quotes = 0;
    for (const m of live) {
      const d = await pantaGet(`/markets/${m.marketId}/`);
      const question = d.question || d.title || "";
      const parsed = parseQuestion(question);
      await sb.from("es_markets").upsert({
        market_id: d.marketId, category: d.category, question, phase: d.phase, status: d.status,
        start_time: ts(d.startTime), end_time: ts(d.endTime), resolution_time: ts(d.resolutionTime),
        oracle: d.oracle, price_source: d.priceSource, resolved: d.resolved,
        volume_usdc: d.totalVolumeUsdc ?? d.volumeUsdc, created_on_chain: ts(d.createdAt),
        parsed, raw: d, last_seen: new Date().toISOString(),
      }, { onConflict: "market_id" });
      const yes = d.yesPrice != null ? parseFloat(d.yesPrice) : null;
      await sb.from("es_snapshots").insert({
        market_id: d.marketId, phase: d.phase,
        yes_price: yes, no_price: d.noPrice != null ? parseFloat(d.noPrice) : null,
        volume_usdc: d.totalVolumeUsdc ?? d.volumeUsdc,
      });

      // 3. valuation (crypto price questions only)
      if (!parsed.kind || !parsed.asset || !parsed.strike) {
        await sb.from("es_valuations").insert({ market_id: d.marketId, market_prob_yes: yes, note: parsed.reason ?? "No model" });
        continue;
      }
      if (!(parsed.asset in priceCache)) priceCache[parsed.asset] = await spotAndVol(parsed.asset);
      const px = priceCache[parsed.asset];
      if (!px) {
        await sb.from("es_valuations").insert({ market_id: d.marketId, market_prob_yes: yes, note: "Spot price unavailable" });
        continue;
      }
      const T = Math.max((d.endTime - now) / (365 * 24 * 3600), 1 / (365 * 24 * 60));
      const p = modelProb(parsed.kind, px.spot, parsed.strike, px.vol, T, parsed.dir);
      const row: Record<string, unknown> = {
        market_id: d.marketId, asset: parsed.asset, spot: px.spot, strike: parsed.strike, vol_annual: px.vol,
        years_to_expiry: T, model_prob_yes: p, market_prob_yes: yes, fee_rate: FEE_RATE, price_source: px.source,
      };

      if (d.phase === "primary") {
        // Compare the side the model disagrees with the market on, using real quotes (fees included).
        const side = yes == null || p >= yes ? "yes" : "no";
        const pSide = side === "yes" ? p : 1 - p;
        const q0 = await quote(d.marketId, side, DEPTH_STEPS[0]);
        quotes++;
        if (q0) {
          row.quote_side = side;
          row.quote_amount_usdc = q0.amount;
          row.quote_shares = q0.shares;
          row.cost_per_share = q0.cost;
          row.net_edge = pSide / q0.cost - 1; // expected return per dollar after fees, under the model
          // depth: the largest tested amount at which the model still breaks even
          let depth = 0;
          if (pSide / q0.cost > 1) {
            depth = q0.amount;
            for (const a of DEPTH_STEPS.slice(1)) {
              const q = await quote(d.marketId, side, a);
              quotes++;
              if (!q || pSide / q.cost <= 1) break;
              depth = a;
            }
          }
          row.depth_usdc = depth;
        } else {
          row.note = "Panta quote unavailable";
        }
      } else {
        row.note = "Secondary phase: no opening-curve quote; compare model with last trade price";
        if (yes != null) row.net_edge = null;
      }
      await sb.from("es_valuations").insert(row);
      valued++;
    }
    log.valued = valued;
    log.quotes = quotes;
    log.ms = Date.now() - started;
    await sb.from("es_runs").insert({ kind: "collect", ok: true, detail: log });
    return new Response(JSON.stringify(log), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    log.error = String(e);
    await sb.from("es_runs").insert({ kind: "collect", ok: false, detail: log });
    return new Response(JSON.stringify(log), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
