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
Solami Blur ┤    es-collect (every 5m)  └── Postgres: es_markets / es_snapshots / es_valuations / es_prices
Coinbase ───┘
```
- `supabase/functions/es-collect` — pulls the Panta catalogue, stores snapshots (Panta has no price history
  endpoint), parses questions, runs the model, requests quotes (within Panta rate limits).
- `supabase/migrations` — schema, read-only RLS, cron schedule.
- `web/` — Next.js dashboard.

## Model
Driftless lognormal. "Closes above K at T": `N(d2)`, `d2 = (ln(S/K) − σ²T/2) / (σ√T)`.
"Touches K by T": first-passage probability. σ = realised volatility from hourly closes.

## Price data (Solami)
- **Primary:** Solami Blur REST — decoded on-chain Solana DEX trades. EdgeScope reads `/data/token/ohlcv` (hourly
  bars for realised volatility) and `/data/token/price` (latest trade) for wrapped SOL, cbBTC and Wormhole WETH.
- **Cross-check / fallback:** Coinbase public hourly candles. Both sources are logged to `es_prices` every run; if the
  on-chain and reference prices differ by more than 3%, the model uses the reference and flags it on the card.
- Set the secret `SOLAMI_API_KEY` (an API key with the DataApi permission) on the `es-collect` function.

## Run it
1. Apply the migrations to a Supabase project.
2. Deploy `es-collect` and set the secrets `PANTA_API_KEY` and `SOLAMI_API_KEY`.
3. `cd web && npm i && npm run dev` (optionally set `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`).

Built for the Colosseum Crypto World's Fair hackathon.
