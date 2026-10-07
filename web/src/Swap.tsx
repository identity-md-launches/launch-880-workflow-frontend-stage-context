import { useEffect, useRef, useState } from "react";
import { formatUnits, zeroAddress, type Address } from "viem";
import { useMoss, pretty } from "./context";
import {
  amountUnits,
  encodeSwap,
  erc20Abi,
  errorText,
  minimumOutput,
  permitAbi,
  quoterAbi,
  routerAbi,
  same,
} from "./protocol";
import { ErrorLine, Field, Gate } from "./ui";
type Quote = {
  amount: bigint;
  out: bigint;
  min: bigint;
  created: number;
  key: string;
};
export function Swap() {
  const m = useMoss();
  const { deployment: d, client, state: s, contracts: c } = m;
  const [buy, setBuy] = useState(true);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [quote, setQuote] = useState<Quote>();
  const [error, setError] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [approval, setApproval] = useState<
    "unknown" | "token" | "permit" | "ready"
  >("unknown");
  const [clock, setClock] = useState(Date.now());
  const requestId = useRef(0);
  const quoteLock = useRef(false);
  const token = c.LaunchToken;
  const pair = same(d.poolKey.currency0, token.address)
    ? d.poolKey.currency1
    : d.poolKey.currency0;
  const input: Address = buy ? pair : token.address;
  const output: Address = buy ? token.address : pair;
  const native = same(input, zeroAddress);
  const inSymbol = buy
    ? (s?.pairSymbol ?? d.network.nativeCurrency.symbol)
    : (s?.symbol ?? "Moss");
  const outSymbol = buy
    ? (s?.symbol ?? "Moss")
    : (s?.pairSymbol ?? d.network.nativeCurrency.symbol);
  const inDecimals = buy ? s?.pairDecimals : s?.decimals;
  const outDecimals = buy ? s?.decimals : s?.pairDecimals;
  const balance = buy ? (native ? s?.native : s?.pairBalance) : s?.balance;
  const key = [buy, amount, slippage, m.account, m.chainId].join(":");
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    setQuote(undefined);
    setError("");
    setApproval("unknown");
    requestId.current++;
  }, [key]);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const readApproval = async (q: Quote) => {
    if (native) {
      setApproval("ready");
      return "ready" as const;
    }
    if (!m.account) return "unknown" as const;
    const allowance = (await client.readContract({
      address: input,
      abi: same(input, token.address) ? token.abi : erc20Abi,
      functionName: "allowance",
      args: [m.account, d.network.uniswapV4.permit2],
    })) as bigint;
    const permit = await client.readContract({
      address: d.network.uniswapV4.permit2,
      abi: permitAbi,
      functionName: "allowance",
      args: [m.account, input, d.network.uniswapV4.universalRouter],
    });
    const result =
      allowance < q.amount
        ? "token"
        : permit[0] < q.amount || Number(permit[1]) < Date.now() / 1000 + 600
          ? "permit"
          : "ready";
    if (q.key === currentKey.current) setApproval(result);
    return result;
  };
  const getQuote = async () => {
    if (quoteLock.current) return;
    quoteLock.current = true;
    const req = ++requestId.current;
    const quoteKey = key;
    setQuoting(true);
    setError("");
    setQuote(undefined);
    try {
      if (!m.ready || !s || inDecimals === undefined)
        throw Error("Connect your wallet and wait for verified pool data.");
      if (!s.price)
        throw Error("This pool is not initialized. A swap is unavailable.");
      const units = amountUnits(amount, inDecimals);
      if (units > (balance ?? 0n))
        throw Error(`Insufficient ${inSymbol} balance. Reduce the amount.`);
      const { result } = await client.simulateContract({
        address: d.network.uniswapV4.quoter,
        abi: quoterAbi,
        functionName: "quoteExactInputSingle",
        args: [
          {
            poolKey: d.poolKey,
            zeroForOne: same(input, d.poolKey.currency0),
            exactAmount: units,
            hookData: "0x",
          },
        ],
        account: m.account,
      });
      if (!result[0] || result[0] >= 1n << 128n)
        throw Error(
          "The pool returned an unusable quote. Try a smaller amount.",
        );
      const min = minimumOutput(result[0], slippage);
      if (min === 0n)
        throw Error("Minimum output rounds to zero. Increase the input.");
      const q = {
        amount: units,
        out: result[0],
        min,
        created: Date.now(),
        key: quoteKey,
      };
      if (req !== requestId.current || currentKey.current !== quoteKey) return;
      await readApproval(q);
      if (req === requestId.current) setQuote(q);
    } catch (e) {
      if (req === requestId.current) setError(errorText(e));
    } finally {
      quoteLock.current = false;
      setQuoting(false);
    }
  };
  const fresh = !!quote && quote.key === key && clock - quote.created < 60000;
  const approve = async () => {
    if (!quote || !fresh) return;
    setError("");
    try {
      const step = await readApproval(quote);
      let ok = false;
      if (step === "token")
        ok = await m.run("Approve token", {
          address: input,
          abi: same(input, token.address) ? token.abi : erc20Abi,
          functionName: "approve",
          args: [d.network.uniswapV4.permit2, quote.amount],
        });
      if (step === "permit")
        ok = await m.run("Approve router", {
          address: d.network.uniswapV4.permit2,
          abi: permitAbi,
          functionName: "approve",
          args: [
            input,
            d.network.uniswapV4.universalRouter,
            quote.amount,
            Math.floor(Date.now() / 1000) + 1800,
          ],
        });
      if (ok) await readApproval(quote);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const swap = async () => {
    if (!quote || !fresh) return;
    setError("");
    try {
      if ((await readApproval(quote)) !== "ready")
        throw Error("Allowance changed. Complete the displayed approval step.");
      if (
        currentKey.current !== quote.key ||
        Date.now() - quote.created >= 60000
      )
        throw Error("Quote expired or inputs changed. Request a new quote.");
      const encoded = encodeSwap(d, input, quote.amount, quote.min);
      const ok = await m.run("Swap", {
        address: d.network.uniswapV4.universalRouter,
        abi: routerAbi,
        functionName: "execute",
        args: [
          encoded.commands,
          encoded.inputs,
          BigInt(Math.floor(Date.now() / 1000) + 600),
        ],
        value: encoded.value,
      });
      if (ok) {
        setQuote(undefined);
        setAmount("");
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <section className="swap-card" aria-labelledby="swap-title">
      <div className="row">
        <h2 id="swap-title">Trade Moss</h2>
        <span className="eyebrow">Uniswap v4</span>
      </div>
      <div className="segmented" aria-label="Trade direction">
        <button
          aria-pressed={buy}
          disabled={!!m.busy}
          onClick={() => setBuy(true)}
        >
          Buy Moss
        </button>
        <button
          aria-pressed={!buy}
          disabled={!!m.busy}
          onClick={() => setBuy(false)}
        >
          Sell Moss
        </button>
      </div>
      <div className="amount-box">
        <div className="row">
          <label htmlFor="swap-amount">You pay</label>
          <small>
            Balance: {m.account ? pretty(balance, inDecimals) : "—"}
          </small>
        </div>
        <div className="amount-row">
          <input
            id="swap-amount"
            aria-invalid={!!error}
            aria-describedby="swap-error"
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            disabled={!!m.busy}
            onChange={(e) => setAmount(e.target.value)}
            autoComplete="off"
          />
          <span className="currency">
            <span aria-hidden="true" className={buy ? "coin eth" : "coin"}>
              {buy ? "Ξ" : "m"}
            </span>
            {inSymbol}
          </span>
        </div>
      </div>
      <div className="swap-divider" aria-hidden="true">
        ↓
      </div>
      <div className="amount-box output">
        <div className="row">
          <span>You receive</span>
          <small>Estimated</small>
        </div>
        <div className="amount-row">
          <output>{quote ? pretty(quote.out, outDecimals) : "0.00"}</output>
          <span className="currency">
            <span aria-hidden="true" className={buy ? "coin" : "coin eth"}>
              {buy ? "m" : "Ξ"}
            </span>
            {outSymbol}
          </span>
        </div>
      </div>
      <div className="slippage">
        <label htmlFor="slippage">Slippage tolerance</label>
        <div>
          <input
            id="slippage"
            inputMode="decimal"
            value={slippage}
            disabled={!!m.busy}
            onChange={(e) => setSlippage(e.target.value)}
          />
          <span>%</span>
        </div>
      </div>
      <div id="swap-error">
        <ErrorLine text={error} />
      </div>
      {quote && (
        <div className="quote-details">
          <div className="row">
            <span>Minimum received</span>
            <strong>
              {formatUnits(quote.min, outDecimals ?? 18)} {outSymbol}
            </strong>
          </div>
          <div className="row">
            <span>Quote expires</span>
            <span>
              {Math.max(0, 60 - Math.floor((clock - quote.created) / 1000))}s
            </span>
          </div>
          <p>
            1 {inSymbol} ≈{" "}
            {pretty(
              (quote.out * 10n ** BigInt(inDecimals ?? 18)) / quote.amount,
              outDecimals,
            )}{" "}
            {outSymbol}. Network fees are additional.
          </p>
          {!native && (
            <p>
              {approval === "token"
                ? `Step 1 of 3: allow Permit2 to spend exactly ${amount} ${inSymbol}.`
                : approval === "permit"
                  ? "Step 2 of 3: authorize the router for this amount, for 30 minutes."
                  : "Step 3 of 3: swap the approved amount."}
            </p>
          )}
        </div>
      )}
      <Gate>
        {!quote || !fresh ? (
          <button
            className="primary full"
            disabled={quoting || !!m.busy}
            onClick={() => void getQuote()}
          >
            {quoting
              ? "Getting quote…"
              : quote
                ? "Refresh expired quote"
                : "Get quote"}
          </button>
        ) : approval === "ready" ? (
          <button
            className="primary full"
            disabled={!!m.busy}
            onClick={() => void swap()}
          >
            {m.busy === "Swap" ? "Swapping…" : `Swap ${amount} ${inSymbol}`}
          </button>
        ) : (
          <button
            className="primary full"
            disabled={!!m.busy || approval === "unknown"}
            onClick={() => void approve()}
          >
            {m.busy ||
              (approval === "token"
                ? `Approve ${inSymbol} for Permit2`
                : "Approve router in Permit2")}
          </button>
        )}
      </Gate>
      <p className="caption centered">
        USD value unavailable · No price feed configured
      </p>
    </section>
  );
}
