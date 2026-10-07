import { useState, type FormEvent } from "react";
import { isAddress, zeroAddress } from "viem";
import { useMoss, pretty } from "./context";
import { amountUnits, errorText, same } from "./protocol";
import { Action, AddressView, ErrorLine, Field, Gate } from "./ui";
export function TokenTools() {
  const m = useMoss();
  const token = m.contracts.LaunchToken;
  const [action, setAction] = useState("transfer");
  const [target, setTarget] = useState("");
  const [from, setFrom] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [allowance, setAllowance] = useState<bigint>();
  const [checking, setChecking] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      const addr = target.trim();
      const owner = from.trim();
      if (!isAddress(addr) || same(addr, zeroAddress))
        throw Error("Enter a valid nonzero recipient or spender address.");
      if (
        action === "transferFrom" &&
        (!isAddress(owner) || same(owner, zeroAddress))
      )
        throw Error("Enter the valid token owner address.");
      if (!m.state || !confirmed)
        throw Error("Review and confirm the action before submitting.");
      const value = amountUnits(amount, m.state.decimals, action === "approve");
      const args =
        action === "transferFrom" ? [owner, addr, value] : [addr, value];
      const ok = await m.run(
        action === "approve"
          ? "Set allowance"
          : action === "transferFrom"
            ? "Transfer delegated Moss"
            : "Send Moss",
        { ...token, functionName: action, args },
      );
      if (ok) {
        setConfirmed(false);
        setAmount("");
        setAllowance(undefined);
      }
    } catch (e) {
      setError(errorText(e));
    }
  };
  const checkAllowance = async () => {
    setError("");
    setChecking(true);
    try {
      const owner = action === "transferFrom" ? from.trim() : m.account;
      const spender = action === "transferFrom" ? m.account : target.trim();
      if (!owner || !spender || !isAddress(owner) || !isAddress(spender))
        throw Error(
          "Connect a wallet and enter the owner/spender address first.",
        );
      setAllowance(
        (await m.client.readContract({
          ...token,
          functionName: "allowance",
          args: [owner, spender],
        })) as bigint,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setChecking(false);
    }
  };
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Wallet utilities</span>
          <h1>Keep Moss moving.</h1>
          <p>Transfer tokens or manage a specific spending allowance.</p>
        </div>
      </div>
      <div className="form-layout">
        <div>
          <h2>{pretty(m.state?.balance, m.state?.decimals)} Moss</h2>
          <p>Connected wallet balance · USD value unavailable</p>
          <AddressView value={token.address} label="Moss token contract" />
          <p>
            Transfers are irreversible. An allowance lets the spender transfer
            up to the specified amount. Set it to zero to revoke.
          </p>
          <p className="caption">
            When replacing an existing allowance, revoke it first and wait for
            confirmation before granting a new amount. Delegated transfers
            require the owner to have already approved your connected wallet.
          </p>
        </div>
        <form
          className="panel stack"
          onSubmit={submit}
          onChange={() => {
            setConfirmed(false);
            setAllowance(undefined);
          }}
        >
          <Field label="Token action">
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="transfer">Send Moss</option>
              <option value="approve">Set or revoke allowance</option>
              <option value="transferFrom">Transfer delegated Moss</option>
            </select>
          </Field>
          {action === "transferFrom" && (
            <Field label="Token owner address">
              <input
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="0x…"
              />
            </Field>
          )}
          <Field
            label={
              action === "approve" ? "Spender address" : "Recipient address"
            }
          >
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              required
              placeholder="0x…"
              spellCheck={false}
            />
          </Field>
          <Field
            label="Amount (Moss)"
            hint={
              action === "approve"
                ? "Enter 0 to revoke this allowance."
                : undefined
            }
          >
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              placeholder="0.00"
            />
          </Field>
          {action !== "transfer" && (
            <>
              <button
                type="button"
                onClick={() => void checkAllowance()}
                disabled={checking}
              >
                {checking ? "Reading allowance…" : "Read current allowance"}
              </button>
              {allowance !== undefined && (
                <p role="status">
                  Current allowance: {pretty(allowance, m.state?.decimals)} Moss
                </p>
              )}
            </>
          )}
          <p className="notice break">
            {action === "approve"
              ? `Set the spender’s allowance to ${amount || "0"} Moss.`
              : `Send ${amount || "0"} Moss to ${target || "the recipient above"}.`}{" "}
            Network fees apply.
          </p>
          <label className="check" onChange={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={confirmed}
              required
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I checked the addresses and amount.
          </label>
          <ErrorLine text={error} />
          <Gate>
            <Action
              id={
                action === "approve"
                  ? "Set allowance"
                  : action === "transferFrom"
                    ? "Transfer delegated Moss"
                    : "Send Moss"
              }
              disabled={!confirmed}
            >
              {action === "approve"
                ? "Set allowance"
                : action === "transferFrom"
                  ? "Transfer delegated Moss"
                  : "Send Moss"}
            </Action>
          </Gate>
        </form>
      </div>
    </section>
  );
}
