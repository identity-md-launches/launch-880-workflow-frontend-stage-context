import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useMoss, pretty } from "./context";
import { Swap } from "./Swap";
import { Registry } from "./Registry";
import { TokenTools } from "./TokenTools";
import { AddressView } from "./ui";
function Garden() {
  return (
    <div className="garden" aria-hidden="true">
      <div className="orb orb-one" />
      <div className="orb orb-two" />
      <div className="orb orb-three" />
      <svg viewBox="0 0 440 300">
        <g fill="none" stroke="currentColor" strokeWidth="1.3">
          {Array.from({ length: 11 }, (_, i) => (
            <g
              key={i}
              transform={`translate(${105 + i * 20} 285) rotate(${(i - 5) * 10})`}
            >
              <path
                d={`M0 0 Q${i % 2 ? 25 : -25} -90 0 -${115 + (i % 4) * 26}`}
              />
              {Array.from({ length: 9 }, (_, j) => (
                <g
                  key={j}
                  transform={`translate(${Math.sin(j / 3) * 6} ${-j * 17})`}
                >
                  <path d={`M0 0 Q-34 -2 -${25 - j * 1.9} -25 Q-8 -27 0 0`} />
                  <path d={`M0 0 Q34 -2 ${25 - j * 1.9} -25 Q8 -27 0 0`} />
                </g>
              ))}
            </g>
          ))}
        </g>
      </svg>
      <span className="garden-label">Fig. 01 — An open field for ideas</span>
      <span className="coordinate">GROWTH / ONCHAIN</span>
    </div>
  );
}
export function App() {
  const m = useMoss();
  const { deployment: d, state: s } = m;
  const [view, setView] = useState(() => location.hash.slice(1) || "trade");
  useEffect(() => {
    const listener = () => setView(location.hash.slice(1) || "trade");
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  const views = [
    ["trade", "Trade"],
    ["experiments", "Experiments"],
    ["tools", "Token tools"],
  ];
  const wrong = !!m.account && m.chainId !== d.chainId;
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <a className="brand" href="#trade" aria-label="Moss home">
          <img src="./moss.svg" width="38" height="38" alt="" />
          moss<span className="brand-label">A living experiment</span>
        </a>
        <nav aria-label="Main navigation">
          {views.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={view === id ? "page" : undefined}
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="wallet">
          {m.account ? (
            <>
              <AddressView value={m.account} />
              <button onClick={() => m.disconnect()} disabled={!!m.busy}>
                Disconnect
              </button>
            </>
          ) : (
            <button
              className="connect"
              onClick={() => void m.connect()}
              disabled={m.walletBusy}
            >
              {m.walletBusy ? "Connecting…" : "Connect wallet"}{" "}
              <span aria-hidden="true">↗</span>
            </button>
          )}
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        <div className="network-line">
          <span>
            <span
              className={m.verified ? "dot" : "dot muted"}
              aria-hidden="true"
            />
            {d.network.name}{" "}
            <span className="network-kind">
              {d.network.testnet ? "Testnet" : "Mainnet"}
            </span>
          </span>
          <span className="mono">
            {m.verified && s
              ? `Synced · block ${s.block.toLocaleString()}`
              : m.readError
                ? "Connection unavailable"
                : "Reading chain…"}
          </span>
        </div>
        {wrong && (
          <div className="network-warning" role="status">
            <span>
              Wallet is on another network. Switch to {d.network.name} to
              transact.
            </span>
            <button
              onClick={() => void m.switchChain()}
              disabled={m.walletBusy || !!m.busy}
            >
              {m.walletBusy
                ? "Switching network…"
                : `Switch to ${d.network.name}`}
            </button>
          </div>
        )}
        {m.readError && (
          <div className="network-warning" role="alert">
            <div>
              <strong>Live state is unavailable.</strong>
              <p>
                {m.readError} Displayed values may be stale; transactions are
                disabled.
              </p>
            </div>
            <button onClick={() => void m.refresh()}>Retry live reads</button>
          </div>
        )}
        <div className="transaction" aria-live="polite">
          {m.message && <p>{m.message}</p>}
          {m.hash && (
            <p>
              <a
                href={`${d.network.explorer}/tx/${m.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View transaction on explorer ↗
              </a>{" "}
              {m.busy === "Awaiting receipt" && (
                <button onClick={() => void m.retryReceipt()}>
                  Check receipt
                </button>
              )}
            </p>
          )}
        </div>
        <div role="alert">
          {m.txError && <p className="error global-error">{m.txError}</p>}
        </div>
        {view === "experiments" ? (
          <Registry />
        ) : view === "tools" ? (
          <TokenTools />
        ) : (
          <>
            <div className="hero">
              <section className="hero-copy">
                <div className="eyebrow">
                  <span className="tiny-mark">✳</span> Rooted in curiosity.
                  Recorded on chain.
                </div>
                <h1>
                  A place for
                  <br />
                  experiments
                  <br />
                  to <em>grow.</em>
                </h1>
                <p>
                  Moss brings a token and a public experiment catalog to
                  Robinhood Chain. Follow an idea from its first proposal to its
                  next chapter.
                </p>
                <a className="text-link" href="#experiments">
                  Explore the experiments <span aria-hidden="true">↗</span>
                </a>
                <Garden />
              </section>
              <div className="trade-column">
                <Swap />
                <p className="trade-note">
                  <span aria-hidden="true">↗</span> Your wallet. Your tokens.
                  Every action on chain.
                </p>
              </div>
            </div>
            <section className="stats" aria-label="Live Moss overview">
              <div>
                <span className="eyebrow">Token supply</span>
                <strong>
                  {s ? pretty(s.supply, s.decimals, 0) : "—"}{" "}
                  <small>Moss</small>
                </strong>
                <p>Fixed at deployment</p>
              </div>
              <div>
                <span className="eyebrow">Experiment proposals</span>
                <strong>{s?.count.toString() ?? "—"}</strong>
                <p>A permanent public record</p>
              </div>
              <div>
                <span className="eyebrow">Pool fee</span>
                <strong>{s ? `${s.fee / 10000}%` : "—"}</strong>
                <p>
                  {s
                    ? s.liquidity > 0n
                      ? "Active pool liquidity"
                      : "Quotes may cross liquidity ranges"
                    : "Waiting for live pool state"}
                </p>
              </div>
            </section>
            <section className="intro">
              <div>
                <span className="eyebrow">Room to explore</span>
                <h2>
                  One token.
                  <br />
                  An open-ended notebook.
                </h2>
              </div>
              <div>
                <p>
                  Anyone can propose an experiment that is already deployed. The
                  registry owner can endorse a version, replace it, reject a
                  proposal or retire an endorsement.
                </p>
                <p>
                  The record stays public. Endorsements do not guarantee safety,
                  execute an experiment, or change the Moss token.
                </p>
                <a className="text-link" href="#experiments">
                  Open the registry ↗
                </a>
              </div>
            </section>
          </>
        )}
        <details className="deployment">
          <summary>
            Deployment & live state{" "}
            <span>Source, pool and contract records</span>
          </summary>
          <div className="deployment-grid">
            <div>
              <h2>Deployed contracts</h2>
              {d.contracts.map((c) => (
                <div key={c.name} className="stack small-gap">
                  <AddressView value={c.address} label={c.name} />
                  <code className="break">{c.address}</code>
                  <a href={`./${c.abiPath}`}>Download {c.name} ABI</a>
                  <small className="break">ABI Keccak: {c.abiHash}</small>
                </div>
              ))}
              {s && (
                <p>
                  Registry owner: <AddressView value={s.owner} />
                </p>
              )}
            </div>
            <div>
              <h2>Attested pool</h2>
              <dl>
                {Object.entries(d.poolKey).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd className="mono break">{v}</dd>
                  </div>
                ))}
                <div>
                  <dt>Current sqrtPriceX96</dt>
                  <dd className="break">
                    {s?.price.toString() ?? "Unavailable"}
                  </dd>
                </div>
                <div>
                  <dt>Liquidity at current tick (raw)</dt>
                  <dd>{s?.liquidity.toString() ?? "Unavailable"}</dd>
                </div>
              </dl>
              <p className="caption">
                The pool key comes from the deployment handoff. The
                initialization guard is not an experiment registry hook.
              </p>
            </div>
            <div>
              <h2>Verification record</h2>
              <dl>
                <div>
                  <dt>Chain ID</dt>
                  <dd>{d.chainId}</dd>
                </div>
                <div>
                  <dt>Source commit</dt>
                  <dd className="break mono">{d.sourceCommit}</dd>
                </div>
                <div>
                  <dt>Attestation hash</dt>
                  <dd className="break mono">{d.attestationHash}</dd>
                </div>
                <div>
                  <dt>Launch ID</dt>
                  <dd className="break">{d.launchId}</dd>
                </div>
                <div>
                  <dt>Read status</dt>
                  <dd>
                    {m.verified
                      ? "RPC chain and contract code checked; ABIs match manifest"
                      : "Verification pending or unavailable"}
                  </dd>
                </div>
              </dl>
              <a href="./imd-deployment.json">View deployment manifest ↗</a>
              <p className="caption">
                Nonempty code is checked; runtime bytecode equivalence is not
                attested by this site. Last successful read:{" "}
                {s ? new Date(s.at).toLocaleTimeString() : "not yet available"}.
              </p>
              {s && m.account && (
                <p>
                  Gas balance:{" "}
                  {formatUnits(s.native, d.network.nativeCurrency.decimals)}{" "}
                  {d.network.nativeCurrency.symbol}
                </p>
              )}
            </div>
          </div>
        </details>
      </main>
      <footer>
        <a href="#trade" className="footer-brand">
          moss ↟
        </a>
        <p>A little curiosity goes a long way.</p>
        <a
          href={`${d.network.explorer}/address/${m.contracts.LaunchToken.address}`}
          target="_blank"
          rel="noreferrer"
        >
          View Moss on explorer ↗
        </a>
      </footer>
    </>
  );
}
