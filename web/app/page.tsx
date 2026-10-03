import { getLatest, getPrices, type PriceRow, type Row } from "@/lib/data";
import styles from "./page.module.css";

export const dynamic = "force-dynamic"; // always render with fresh data (ISR was serving stale pages)

const pct = (x: number | null | undefined, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);
const usd = (x: number | null | undefined) =>
  x == null ? "—" : `$${Number(x).toLocaleString("en-US", { maximumFractionDigits: x < 100 ? 2 : 0 })}`;

function timeLeft(iso: string | null) {
  if (!iso) return "—";
  const s = (new Date(iso).getTime() - Date.now()) / 1000;
  if (s <= 0) return "expired";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function kindLabel(r: Row) {
  const k = (r as unknown as { parsed?: { kind?: string; dir?: string } }).parsed?.kind;
  if (k === "close_above") return "closes above";
  if (k === "close_below") return "closes below";
  if (k === "touch") return "touches";
  return "";
}

function gap(r: Row) {
  if (r.model_prob_yes == null || r.market_prob_yes == null) return null;
  return r.model_prob_yes - r.market_prob_yes;
}

export default async function Home() {
  let rows: Row[] = [];
  let prices: PriceRow[] = [];
  let error = "";
  try {
    [rows, prices] = await Promise.all([getLatest(), getPrices().catch(() => [] as PriceRow[])]);
  } catch (e) {
    error = String(e);
  }
  const modeled = rows.filter((r) => r.model_prob_yes != null);
  const other = rows.filter((r) => r.model_prob_yes == null);
  modeled.sort((a, b) => Math.abs(gap(b) ?? 0) - Math.abs(gap(a) ?? 0));
  const biggest = modeled[0];
  const updated = rows.map((r) => r.val_ts).filter(Boolean).sort().pop();

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>EdgeScope</h1>
          <p className={styles.sub}>
            Opening-price valuation for Panta prediction markets. Every new Panta market opens at 50/50. EdgeScope
            prices crypto-threshold markets from spot price and realised volatility, then shows how far the market
            price sits from the model — after fees, using live Panta quotes.
          </p>
        </div>
        <span className={styles.powered}>Powered by Panta</span>
      </header>

      <section className={styles.stats}>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Live markets</span>
          <span className={styles.statValue}>{rows.length}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>With a price model</span>
          <span className={styles.statValue}>{modeled.length}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Largest model–market gap</span>
          <span className={styles.statValue}>{biggest ? pct(Math.abs(gap(biggest) ?? 0)) : "—"}</span>
        </div>
        <div className={styles.stat}>
          <span className={styles.statLabel}>Last update</span>
          <span className={styles.statValueSmall}>
            {updated ? new Date(updated).toUTCString().replace(" GMT", " UTC") : "—"}
          </span>
        </div>
      </section>

      {error && <p className={styles.error}>Data temporarily unavailable.</p>}

      <h2 className={styles.h2}>Price feeds</h2>
      <p className={styles.muted}>
        Spot and volatility come from on-chain Solana DEX trades decoded by Solami Blur (wrapped SOL, cbBTC, Wormhole
        WETH). Coinbase is shown as an off-chain cross-check; if the two disagree by more than 3% the model falls back
        to the reference and says so.
      </p>
      <div className={styles.feeds}>
        {["SOL", "BTC", "ETH"].map((a) => (
          <Feed key={a} asset={a} rows={prices.filter((p) => p.asset === a)} />
        ))}
      </div>

      <h2 className={styles.h2}>Crypto price markets</h2>
      {modeled.length === 0 && <p className={styles.muted}>No live crypto price markets right now.</p>}
      <div className={styles.cards}>
        {modeled.map((r) => {
          const g = gap(r);
          return (
            <article key={r.market_id} className={styles.card}>
              <div className={styles.cardTop}>
                <span className={styles.badge}>{r.asset}</span>
                <span className={styles.badgeMuted}>{r.phase === "primary" ? "primary (opening curve)" : r.phase}</span>
                <span className={styles.expiry}>ends in {timeLeft(r.end_time)}</span>
              </div>
              <h3 className={styles.q}>{r.question}</h3>
              <div className={styles.bars}>
                <Bar label="Market price (YES)" value={r.market_prob_yes} tone="market" />
                <Bar label="Model probability (YES)" value={r.model_prob_yes} tone="model" />
              </div>
              <dl className={styles.grid}>
                <div>
                  <dt>Model − market</dt>
                  <dd className={g != null && Math.abs(g) >= 0.1 ? styles.strong : ""}>
                    {g == null ? "—" : `${g > 0 ? "+" : ""}${(g * 100).toFixed(1)} pts`}
                  </dd>
                </div>
                <div>
                  <dt>Spot / level</dt>
                  <dd>
                    {usd(r.spot)} / {kindLabel(r)} {usd(r.strike)}
                  </dd>
                </div>
                <div>
                  <dt>Realised vol (annual)</dt>
                  <dd>{pct(r.vol_annual, 0)}</dd>
                </div>
                <div>
                  <dt>Quoted cost per share, fees incl.</dt>
                  <dd>
                    {r.cost_per_share == null ? "—" : `${r.cost_per_share.toFixed(3)} (${r.quote_side?.toUpperCase()})`}
                  </dd>
                </div>
                <div>
                  <dt>Model value per $1, after fees</dt>
                  <dd>{r.net_edge == null ? "—" : `${r.net_edge > 0 ? "+" : ""}${(r.net_edge * 100).toFixed(1)}%`}</dd>
                </div>
                <div>
                  <dt>Curve depth to model price</dt>
                  <dd>{r.depth_usdc == null ? "—" : r.depth_usdc === 0 ? "none" : `≈ ${usd(r.depth_usdc)}`}</dd>
                </div>
              </dl>
              {r.note && <p className={styles.note}>{r.note}</p>}
            </article>
          );
        })}
      </div>

      <h2 className={styles.h2}>Other live markets (no model)</h2>
      <ul className={styles.list}>
        {other.map((r) => (
          <li key={r.market_id}>
            <span className={styles.cat}>{r.category}</span>
            <span>{r.question || "(untitled market)"}</span>
            <span className={styles.muted}>
              YES {pct(r.market_prob_yes ?? r.yes_price)} · ends in {timeLeft(r.end_time)}
            </span>
          </li>
        ))}
      </ul>

      <section className={styles.method}>
        <h2 className={styles.h2}>How it works</h2>
        <ol>
          <li>Every 5 minutes EdgeScope reads the Panta market catalogue and stores a price snapshot (Panta has no price-history endpoint).</li>
          <li>Crypto threshold questions are parsed into asset, level and expiry. Anything else is listed without a number.</li>
          <li>
            The model is a driftless lognormal: probability of closing above a level uses N(d2); “touches” uses the
            first-passage formula. Volatility is realised volatility from hourly closes (Solami on-chain bars when available, otherwise Coinbase).
          </li>
          <li>
            For markets on Panta&apos;s opening curve, EdgeScope requests real Panta quotes, so cost per share includes the
            ~2% protocol fee and curve slippage. “Curve depth” is the largest tested amount at which the quoted average
            cost still sits below the model probability.
          </li>
          <li>Winning shares pay about 1 USDC; resolution depends on the market&apos;s oracle, which carries its own risk.</li>
        </ol>
      </section>

      <footer className={styles.disclaimer}>
        <p>
          <strong>Research and education only. Not financial advice.</strong> EdgeScope shows the output of a simple
          statistical model next to market prices. It does not recommend buying or selling anything, does not consider
          your circumstances, and is not a risk-free arbitrage. Models are wrong often. EdgeScope does not execute
          trades, hold funds, or charge fees, and its operator does not hold an Australian Financial Services Licence.
          Prediction markets may be restricted where you live.
        </p>
        <p className={styles.muted}>
          Data: Panta API (market prices and quotes), Solami Blur (on-chain Solana DEX prices), Coinbase public prices
          (cross-check and fallback). Powered by Panta.
        </p>
      </footer>
    </main>
  );
}

function Bar({ label, value, tone }: { label: string; value: number | null; tone: "market" | "model" }) {
  return (
    <div className={styles.barRow}>
      <span className={styles.barLabel}>{label}</span>
      <div className={styles.barTrack}>
        {value != null && (
          <div className={tone === "model" ? styles.barModel : styles.barMarket} style={{ width: `${Math.max(1, value * 100)}%` }} />
        )}
        <div className={styles.barMid} />
      </div>
      <span className={styles.barValue}>{pct(value)}</span>
    </div>
  );
}

function Feed({ asset, rows }: { asset: string; rows: PriceRow[] }) {
  const onchain = rows.filter((r) => r.source === "solami-blur");
  const ref = rows.filter((r) => r.source !== "solami-blur" && r.ok);
  const lastOn = [...onchain].reverse().find((r) => r.ok && r.spot != null);
  const lastOnAny = onchain[onchain.length - 1];
  const lastRef = ref[ref.length - 1];
  const gapBps = lastOn?.spot && lastRef?.spot ? (lastOn.spot / lastRef.spot - 1) * 1e4 : null;
  const live = lastOnAny?.ok;
  const used = live && gapBps != null && Math.abs(gapBps) <= 300 ? "Solami (on-chain)" : lastRef ? "Coinbase (fallback)" : "—";
  return (
    <article className={styles.feed}>
      <div className={styles.cardTop}>
        <span className={styles.badge}>{asset}</span>
        <span className={live ? styles.dotOn : styles.dotOff} />
        <span className={styles.muted}>{live ? "Solami live" : "Solami pending"}</span>
        <span className={styles.expiry}>model uses: {used}</span>
      </div>
      <dl className={styles.grid}>
        <div>
          <dt>On-chain (Solami Blur)</dt>
          <dd>{usd(lastOn?.spot ?? null)}</dd>
        </div>
        <div>
          <dt>Reference (Coinbase)</dt>
          <dd>{usd(lastRef?.spot ?? null)}</dd>
        </div>
        <div>
          <dt>On-chain vs reference</dt>
          <dd>{gapBps == null ? "—" : `${gapBps > 0 ? "+" : ""}${gapBps.toFixed(0)} bps`}</dd>
        </div>
        <div>
          <dt>Realised vol (annual)</dt>
          <dd>{pct((lastOn ?? lastRef)?.vol_annual ?? null, 0)}</dd>
        </div>
      </dl>
      <Spark a={onchain.filter((r) => r.ok)} b={ref} />
      {!live && lastOnAny?.note && <p className={styles.note}>{lastOnAny.note}</p>}
    </article>
  );
}

// Two-line sparkline: on-chain (solid) vs reference (dashed), last 24h.
function Spark({ a, b }: { a: PriceRow[]; b: PriceRow[] }) {
  const pts = [...a, ...b].filter((r) => r.spot != null);
  if (pts.length < 2) return <div className={styles.sparkEmpty}>Collecting history…</div>;
  const t0 = Math.min(...pts.map((r) => Date.parse(r.ts))), t1 = Math.max(...pts.map((r) => Date.parse(r.ts)));
  const lo = Math.min(...pts.map((r) => r.spot!)), hi = Math.max(...pts.map((r) => r.spot!));
  const W = 300, Hh = 56;
  const path = (rs: PriceRow[]) =>
    rs
      .filter((r) => r.spot != null)
      .map((r, i) => {
        const x = t1 === t0 ? 0 : ((Date.parse(r.ts) - t0) / (t1 - t0)) * W;
        const y = hi === lo ? Hh / 2 : Hh - ((r.spot! - lo) / (hi - lo)) * (Hh - 4) - 2;
        return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  return (
    <svg className={styles.spark} viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="none" role="img" aria-label="24 hour price">
      <path d={path(b)} className={styles.sparkRef} />
      <path d={path(a)} className={styles.sparkOn} />
    </svg>
  );
}
