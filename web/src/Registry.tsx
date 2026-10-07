import { useEffect, useState, type FormEvent } from "react";
import {
  decodeEventLog,
  getAddress,
  isAddress,
  keccak256,
  toBytes,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { useMoss } from "./context";
import { errorText, same } from "./protocol";
import { Action, AddressView, ErrorLine, Field, Gate } from "./ui";
type Proposal = {
  key: Hex;
  implementation: Address;
  codeHash: Hex;
  contentHash: Hex;
  proposer: Address;
  status: number;
};
type Entry = Proposal & { id: bigint; active: boolean; expected: bigint };
const statuses = [
  "Unknown",
  "Pending review",
  "Endorsed",
  "Retired",
  "Rejected",
];
const digest = (text: string) => keccak256(toBytes(text));
export function Registry() {
  const m = useMoss();
  const r = m.contracts.MossExperimentRegistry;
  const [tab, setTab] = useState("catalog");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState("");
  const [implementation, setImplementation] = useState("");
  const [journal, setJournal] = useState("");
  const [id, setId] = useState("");
  const [selected, setSelected] = useState<Entry>();
  const [decision, setDecision] = useState("");
  const [action, setAction] = useState("approve");
  const [confirmed, setConfirmed] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [events, setEvents] = useState<
    { name: string; block: string; hash: Hex; data: string }[] | undefined
  >();
  const read = async (proposalId: bigint) => {
    const p = (await m.client.readContract({
      ...r,
      functionName: "getProposal",
      args: [proposalId],
    })) as Proposal;
    const [active, expected] = await Promise.all([
      m.client.readContract({
        ...r,
        functionName: "isActive",
        args: [proposalId],
      }),
      m.client.readContract({
        ...r,
        functionName: "activeProposal",
        args: [p.key],
      }),
    ]);
    return {
      ...p,
      id: proposalId,
      active: active as boolean,
      expected: expected as bigint,
    };
  };
  useEffect(() => {
    if (!m.state || tab !== "catalog") return;
    let cancelled = false;
    const count = m.state.count;
    setLoading(true);
    setError("");
    const ids = Array.from(
      { length: 8 },
      (_, i) => count - BigInt(page * 8 + i),
    ).filter((id) => id > 0n);
    Promise.all(ids.map(read))
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(errorText(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [m.state?.block, page, tab]);
  const propose = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const addr = implementation.trim();
      if (!isAddress(addr) || same(addr, zeroAddress))
        throw Error("Enter the address of a deployed experiment contract.");
      if (!key.trim() || !journal.trim())
        throw Error(
          "Provide an experiment identifier and the exact journal text.",
        );
      if (same(addr, r.address) || same(addr, m.contracts.LaunchToken.address))
        throw Error(
          "Choose an experiment contract other than Moss or its registry.",
        );
      const code = await m.client.getCode({ address: addr });
      if (!code || code === "0x")
        throw Error(
          "No contract code found at this address. Deploy the experiment before proposing it.",
        );
      const ok = await m.run("Propose experiment", {
        ...r,
        functionName: "propose",
        args: [digest(key.trim()), getAddress(addr), digest(journal)],
      });
      if (ok) {
        setTab("catalog");
        setPage(0);
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  const loadProposal = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSelected(undefined);
    setLoading(true);
    setConfirmed(false);
    try {
      if (!/^[1-9]\d*$/.test(id))
        throw Error("Enter a proposal ID greater than zero.");
      setSelected(await read(BigInt(id)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  const curate = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (!selected || !same(m.account, m.state?.owner))
        throw Error("Only the registry owner can change endorsements.");
      if (!decision.trim() || !confirmed)
        throw Error(
          "Enter the exact decision document and confirm the described action.",
        );
      const args =
        action === "approve"
          ? [selected.id, selected.expected, digest(decision)]
          : action === "reject"
            ? [selected.id, digest(decision)]
            : [selected.key, selected.expected, digest(decision)];
      const ok = await m.run(
        `${action[0].toUpperCase() + action.slice(1)} experiment`,
        { ...r, functionName: action, args },
      );
      if (ok) {
        setSelected(await read(selected.id));
        setConfirmed(false);
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  const history = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    setEvents(undefined);
    try {
      if (!m.state) throw Error("Wait for live state before loading events.");
      const start = from
        ? BigInt(from)
        : m.state.block > 2000n
          ? m.state.block - 2000n
          : 0n;
      const end = to ? BigInt(to) : m.state.block;
      if (
        start < 0n ||
        end < start ||
        end - start > 10000n ||
        end > m.state.block
      )
        throw Error(
          "Choose up to 10,000 blocks, ending no later than the latest displayed block.",
        );
      const logs = await m.client.getLogs({
        address: r.address,
        fromBlock: start,
        toBlock: end,
      });
      setEvents(
        logs.map((l) => {
          const decoded = decodeEventLog({
            abi: r.abi,
            data: l.data,
            topics: l.topics,
          }) as { eventName: string; args: unknown };
          return {
            name: decoded.eventName ?? "Registry event",
            block: l.blockNumber?.toString() ?? "Pending",
            hash: l.transactionHash!,
            data: JSON.stringify(
              decoded.args,
              (_, v) => (typeof v === "bigint" ? v.toString() : v),
              2,
            ),
          };
        }),
      );
      setFrom(String(start));
      setTo(String(end));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="registry section" aria-labelledby="registry-title">
      <div className="section-heading">
        <div>
          <span className="eyebrow">The experiment registry</span>
          <h1 id="registry-title">Ideas take root here.</h1>
          <p>
            A public record of proposals, endorsements and decisions. Anyone can
            propose a deployed experiment.
          </p>
        </div>
        <div className="registry-count">
          <strong>{m.state?.count.toString() ?? "—"}</strong>
          <span>proposals recorded</span>
        </div>
      </div>
      <div className="notice">
        Endorsement is the owner’s opinion, not a safety guarantee. This catalog
        never executes experiments, changes Moss or controls the pool. Direct
        code checks cannot detect changes behind a proxy.
      </div>
      <div className="subnav" aria-label="Registry views">
        {[
          ["catalog", "Browse proposals"],
          ["propose", "Propose experiment"],
          ["curate", "Review & curate"],
          ["history", "Decision history"],
        ].map(([value, label]) => (
          <button
            key={value}
            aria-pressed={tab === value}
            onClick={() => {
              setTab(value);
              setError("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <ErrorLine text={error} />
      {tab === "catalog" && (
        <>
          {loading && <p role="status">Refreshing proposals…</p>}
          {!m.state ? (
            <div className="empty">
              <h2>Waiting for the registry</h2>
              <p>
                Live proposals will appear when the network connection is
                verified.
              </p>
              <button onClick={() => void m.refresh()}>Retry connection</button>
            </div>
          ) : m.state.count === 0n ? (
            <div className="empty">
              <span className="sprout" aria-hidden="true">
                ↟
              </span>
              <h2>The first idea starts with you.</h2>
              <p>
                No proposals have been recorded yet. Describe an experiment and
                submit its deployed contract for review.
              </p>
              <button onClick={() => setTab("propose")}>
                Propose an experiment ↗
              </button>
            </div>
          ) : (
            <div className="proposal-grid">
              {entries.map((p) => (
                <article className="proposal" key={p.id.toString()}>
                  <div className="row">
                    <h2>Experiment #{p.id.toString()}</h2>
                    <span className="badge">{statuses[p.status]}</span>
                  </div>
                  <p>
                    {p.active
                      ? "Direct code matches the endorsement."
                      : p.status === 2
                        ? "Code check failed; endorsement is not currently active."
                        : "No current endorsement."}
                  </p>
                  <AddressView
                    value={p.implementation}
                    label="Experiment contract"
                  />
                  <details>
                    <summary>Proposal record</summary>
                    <dl>
                      {[
                        ["Key", p.key],
                        ["Content hash", p.contentHash],
                        ["Runtime hash", p.codeHash],
                      ].map(([label, val]) => (
                        <div key={label}>
                          <dt>{label}</dt>
                          <dd className="mono break">{val}</dd>
                        </div>
                      ))}
                      <div>
                        <dt>Proposer</dt>
                        <dd>
                          <AddressView value={p.proposer} />
                        </dd>
                      </div>
                    </dl>
                  </details>
                  <button
                    onClick={() => {
                      setId(p.id.toString());
                      setSelected(p);
                      setTab("curate");
                      setConfirmed(false);
                    }}
                  >
                    Inspect proposal
                  </button>
                </article>
              ))}
            </div>
          )}
          {m.state && m.state.count > 8n && (
            <div className="row pagination">
              <button
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                Newer proposals
              </button>
              <span>Page {page + 1}</span>
              <button
                disabled={BigInt((page + 1) * 8) >= m.state.count}
                onClick={() => setPage((p) => p + 1)}
              >
                Older proposals
              </button>
            </div>
          )}
        </>
      )}
      {tab === "propose" && (
        <div className="form-layout">
          <div>
            <h2>Put an idea on the record.</h2>
            <p>
              Proposals are permanent. The contract stores a hash of your exact
              journal text and the experiment’s current runtime code.
            </p>
            <p>
              Publish and retain the journal separately. Its text is not stored
              or uploaded by this site.
            </p>
            <p className="caption">
              Identifier: Keccak-256 of the trimmed name. Journal: Keccak-256 of
              the exact UTF-8 text, including whitespace.
            </p>
          </div>
          <form onSubmit={propose} className="panel stack">
            <Field
              label="Experiment identifier"
              hint="Reuse the same identifier for a new version of an experiment."
            >
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                required
                placeholder="e.g. moss-growth-study"
                maxLength={200}
              />
            </Field>
            <Field label="Deployed experiment address">
              <input
                value={implementation}
                onChange={(e) => setImplementation(e.target.value)}
                required
                placeholder="0x…"
                spellCheck={false}
              />
            </Field>
            <Field label="Exact journal document">
              <textarea
                value={journal}
                onChange={(e) => setJournal(e.target.value)}
                required
                rows={6}
                placeholder="Describe behavior, permissions, risks, source and test results."
              />
            </Field>
            {journal && (
              <p className="caption break">Content hash: {digest(journal)}</p>
            )}
            <Gate>
              <Action id="Propose experiment">Propose experiment</Action>
            </Gate>
          </form>
        </div>
      )}
      {tab === "curate" && (
        <div className="form-layout">
          <div>
            <h2>Review before endorsing.</h2>
            <p>
              Approval endorses a pending version and retires the previous
              version for its key. Rejection is final. Retirement withdraws an
              endorsement; it cannot stop the experiment or recover funds.
            </p>
            <p>Registry owner:</p>
            {m.state && <AddressView value={m.state.owner} />}
            <p className="caption">
              The expected active ID protects against a decision made from stale
              state.
            </p>
          </div>
          <div className="panel stack">
            <form onSubmit={loadProposal} className="stack">
              <Field label="Proposal ID">
                <input
                  inputMode="numeric"
                  value={id}
                  required
                  onChange={(e) => {
                    setId(e.target.value);
                    setSelected(undefined);
                  }}
                  placeholder="1"
                />
              </Field>
              <button disabled={loading}>
                {loading ? "Loading proposal…" : "Load proposal"}
              </button>
            </form>
            {selected && (
              <>
                <div className="notice">
                  <strong>
                    #{selected.id.toString()} · {statuses[selected.status]}
                  </strong>
                  <p>
                    Expected active ID: {selected.expected.toString()} · Code
                    endorsement {selected.active ? "active" : "inactive"}
                  </p>
                  <AddressView value={selected.implementation} />
                  <details>
                    <summary>Hashes for review</summary>
                    <p className="break">Key: {selected.key}</p>
                    <p className="break">Journal: {selected.contentHash}</p>
                    <p className="break">Runtime: {selected.codeHash}</p>
                  </details>
                </div>
                <form onSubmit={curate} className="stack">
                  <Field label="Decision">
                    <select
                      value={action}
                      onChange={(e) => {
                        setAction(e.target.value);
                        setConfirmed(false);
                      }}
                    >
                      <option value="approve">
                        Approve and replace endorsement
                      </option>
                      <option value="reject">Reject pending proposal</option>
                      <option value="retire">Retire active endorsement</option>
                    </select>
                  </Field>
                  <Field label="Exact decision document">
                    <textarea
                      rows={4}
                      required
                      value={decision}
                      onChange={(e) => setDecision(e.target.value)}
                      placeholder="Publish and retain this decision separately."
                    />
                  </Field>
                  {decision && (
                    <small className="break">
                      Decision hash: {digest(decision)}
                    </small>
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      required
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I reviewed proposal #{selected.id.toString()} and confirm
                    this {action} action.
                  </label>
                  <Gate>
                    <>
                      <Action
                        id={`${action[0].toUpperCase() + action.slice(1)} experiment`}
                        disabled={
                          !same(m.account, m.state?.owner) ||
                          !confirmed ||
                          (action === "retire"
                            ? selected.status !== 2 ||
                              selected.expected !== selected.id
                            : selected.status !== 1)
                        }
                      >
                        {action[0].toUpperCase() + action.slice(1)} experiment
                      </Action>
                      {!same(m.account, m.state?.owner) && (
                        <p className="caption">
                          Only the registry owner can submit decisions.
                        </p>
                      )}
                    </>
                  </Gate>
                </form>
              </>
            )}
          </div>
        </div>
      )}
      {tab === "history" && (
        <div className="stack">
          <h2>Decisions, preserved on chain.</h2>
          <p>
            Load a bounded block range. Decision documents are represented by
            hashes; this site does not reconstruct their content.
          </p>
          <form onSubmit={history} className="history-form">
            <Field label="From block" hint="Blank: latest block minus 2,000">
              <input
                inputMode="numeric"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </Field>
            <Field label="To block" hint="Blank: latest verified block">
              <input
                inputMode="numeric"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </Field>
            <button disabled={loading || !m.state}>
              {loading ? "Loading events…" : "Load decision history"}
            </button>
          </form>
          {events?.length === 0 && (
            <p className="notice">
              No registry events in this range. Choose earlier blocks to explore
              older history.
            </p>
          )}
          {events?.map((event, i) => (
            <article className="panel" key={i}>
              <div className="row">
                <h3>{event.name}</h3>
                <a
                  href={`${m.deployment.network.explorer}/tx/${event.hash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Block {event.block} ↗
                </a>
              </div>
              <pre>{event.data}</pre>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
