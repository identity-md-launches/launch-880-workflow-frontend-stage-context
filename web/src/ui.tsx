import {
  cloneElement,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { getAddress, type Address } from "viem";
import { useMoss } from "./context";
export function AddressView({
  value,
  label,
}: {
  value: Address;
  label?: string;
}) {
  const { deployment } = useMoss();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const address = getAddress(value);
  return (
    <span className="address">
      <a
        href={`${deployment.network.explorer}/address/${address}`}
        target="_blank"
        rel="noreferrer"
        title={address}
        aria-label={`${label ?? "Address"}: ${address} on explorer`}
      >
        {label ?? `${address.slice(0, 6)}…${address.slice(-4)}`} ↗
      </a>
      <button
        type="button"
        className="copy"
        aria-label={`Copy ${label ?? address}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setError(`Copy manually: ${address}`);
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
      {error && <span role="status">{error}</span>}
    </span>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactElement<{
    id?: string;
    name?: string;
    "aria-describedby"?: string;
  }>;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        name: children.props.name ?? id,
        "aria-describedby": hint ? `${id}-hint` : undefined,
      })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Gate({ children }: { children: ReactNode }) {
  const m = useMoss();
  if (!m.account)
    return (
      <button
        type="button"
        className="primary full"
        onClick={() => void m.connect()}
        disabled={m.walletBusy}
      >
        {m.walletBusy ? "Connecting…" : "Connect wallet"}
      </button>
    );
  if (m.chainId !== m.deployment.chainId)
    return (
      <p className="notice">
        Switch networks using the control above to continue.
      </p>
    );
  if (!m.ready)
    return (
      <div className="notice">
        <p>Transactions wait for verified live state.</p>
        <button type="button" onClick={() => void m.refresh()}>
          Refresh connection
        </button>
      </div>
    );
  return children;
}
export function Action({
  id,
  children,
  disabled = false,
}: {
  id: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  const m = useMoss();
  return (
    <button
      className="primary"
      type="submit"
      disabled={disabled || !!m.busy || !m.ready}
    >
      {m.busy === id ? `${id}…` : children}
    </button>
  );
}
export function ErrorLine({ text }: { text: string }) {
  return (
    <p className={text ? "error" : "empty-message"} role="alert">
      {text}
    </p>
  );
}
