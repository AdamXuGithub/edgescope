# EdgeScope

**Opening-price valuation for Panta prediction markets on Solana.**

Every new Panta market opens at 50/50 on a bonding curve. Real probabilities are rarely 50%. EdgeScope prices
crypto-threshold markets (e.g. "Will ETH close at or above $2,700 on 30 Sep?") from spot price and realised
volatility, then shows how far the market price sits from the model — **after fees, using live Panta quotes**.

> Research and education tool only. Not financial advice, not a trading signal, not risk-free arbitrage.
> EdgeScope does not execute trades, hold funds or charge fees. Powered by Panta.

## What it shows, per market
- Market probability (Panta YES price) vs model probability
- Quoted cost per share on the opening curve, fees included (Panta `primaryorderquote`)
- Model value per $1 after fees
- Curve depth: the largest tested amount at which quoted average cost stays below the model probability
- Non-crypto markets are listed with **no model number** rather than a made-up one

## Architecture
```
Panta API ──┐                          ┌── Next.js dashboard (Vercel, ISR 60s)
            ├─> Supabase Edge Function ─┤
Price feed ─┘    es-collect (every 5m)  └── Postgres: es_markets / es_snapshots / es_valuations
```
- `supabase/functions/es-collect` — pulls the Panta catalogue, stores snapshots (Panta has no price history
  endpoint), parses questions, runs the model, requests quotes (within Panta rate limits).
- `supabase/migrations` — schema, read-only RLS, cron schedule.
- `web/` — Next.js dashboard.

## Model
Driftless lognormal. "Closes above K at T": `N(d2)`, `d2 = (ln(S/K) − σ²T/2) / (σ√T)`.
"Touches K by T": first-passage probability. σ = realised volatility from hourly closes.

Price source: Coinbase public candles (interim). Solami real-time data is being integrated as the primary source.

## Run it
1. Apply the migrations to a Supabase project.
2. Deploy `es-collect` and set the secret `PANTA_API_KEY`.
3. `cd web && npm i && npm run dev` (optionally set `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

Built for the Colosseum Crypto World's Fair hackathon.
