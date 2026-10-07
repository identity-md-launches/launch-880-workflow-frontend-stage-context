import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import {
  createWalletClient,
  custom,
  formatUnits,
  zeroAddress,
  type Address,
  type Abi,
  type Hex,
} from "viem";
import type { Runtime } from "./config";
import {
  erc20Abi,
  errorText,
  poolId,
  same,
  stateAbi,
  switchNetwork,
} from "./protocol";
export type Snapshot = {
  block: bigint;
  at: number;
  symbol: string;
  decimals: number;
  supply: bigint;
  balance: bigint;
  native: bigint;
  pairBalance: bigint;
  pairSymbol: string;
  pairDecimals: number;
  owner: Address;
  count: bigint;
  price: bigint;
  liquidity: bigint;
  fee: number;
};
type Write = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
};
type Ctx = Runtime & {
  account?: Address;
  chainId?: number;
  state?: Snapshot;
  readError: string;
  verified: boolean;
  refresh: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  switchChain: () => Promise<void>;
  walletBusy: boolean;
  ready: boolean;
  busy: string;
  message: string;
  txError: string;
  hash?: Hex;
  run: (id: string, call: Write) => Promise<boolean>;
  retryReceipt: () => Promise<void>;
};
const Context = createContext<Ctx>(null!);
export const useMoss = () => useContext(Context);
export const pretty = (n: bigint | undefined, d = 18, max = 6) =>
  n === undefined
    ? "—"
    : new Intl.NumberFormat("en", { maximumFractionDigits: max }).format(
        Number(formatUnits(n, d)),
      );
export function MossProvider({
  runtime,
  children,
}: {
  runtime: Runtime;
  children: ReactNode;
}) {
  const { address: account, chainId, connector } = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const [state, setState] = useState<Snapshot>();
  const [verified, setVerified] = useState(false);
  const [readError, setReadError] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [txError, setTxError] = useState("");
  const [hash, setHash] = useState<Hex>();
  const lock = useRef(false);
  const reading = useRef(false);
  const identity = useRef(account);
  identity.current = account;
  const { client, deployment: d, contracts: c } = runtime;
  const token = c.LaunchToken;
  const registry = c.MossExperimentRegistry;
  const verify = useCallback(async () => {
    const actual = await client.getChainId();
    if (actual !== d.chainId)
      throw Error("RPC returned the wrong network. Transactions are disabled.");
    const addresses = [
      ...d.contracts.map((c) => c.address),
      ...(Object.values(d.network.uniswapV4).filter(
        (v) => typeof v === "string",
      ) as Address[]),
      d.poolKey.hooks,
    ].filter((a) => !same(a, zeroAddress));
    const codes = await Promise.all(
      [...new Set(addresses)].map((address) => client.getCode({ address })),
    );
    if (codes.some((code) => !code || code === "0x"))
      throw Error(
        "A configured contract has no deployed code. Transactions are disabled.",
      );
  }, [client, d]);
  const refresh = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    const requestedAccount = account;
    try {
      await verify();
      const block = await client.getBlockNumber({ cacheTime: 0 });
      const common = { blockNumber: block };
      const readToken = (functionName: string, args?: readonly unknown[]) =>
        client.readContract({ ...token, ...common, functionName, args });
      const readRegistry = (functionName: string) =>
        client.readContract({ ...registry, ...common, functionName });
      const pair = same(d.poolKey.currency0, token.address)
        ? d.poolKey.currency1
        : d.poolKey.currency0;
      const pairNative = same(pair, zeroAddress);
      const [
        symbol,
        decimals,
        supply,
        owner,
        count,
        linked,
        balance,
        native,
        slot,
        liquidity,
        pairSymbol,
        pairDecimals,
        pairBalance,
      ] = await Promise.all([
        readToken("symbol"),
        readToken("decimals"),
        readToken("totalSupply"),
        readRegistry("owner"),
        readRegistry("proposalCount"),
        readRegistry("token"),
        account ? readToken("balanceOf", [account]) : 0n,
        account ? client.getBalance({ address: account, ...common }) : 0n,
        client.readContract({
          address: d.network.uniswapV4.stateView,
          abi: stateAbi,
          functionName: "getSlot0",
          args: [poolId(d.poolKey)],
          ...common,
        }),
        client.readContract({
          address: d.network.uniswapV4.stateView,
          abi: stateAbi,
          functionName: "getLiquidity",
          args: [poolId(d.poolKey)],
          ...common,
        }),
        pairNative
          ? d.network.nativeCurrency.symbol
          : client.readContract({
              address: pair,
              abi: erc20Abi,
              functionName: "symbol",
              ...common,
            }),
        pairNative
          ? d.network.nativeCurrency.decimals
          : client.readContract({
              address: pair,
              abi: erc20Abi,
              functionName: "decimals",
              ...common,
            }),
        !pairNative && account
          ? client.readContract({
              address: pair,
              abi: erc20Abi,
              functionName: "balanceOf",
              args: [account],
              ...common,
            })
          : 0n,
      ]);
      if (!same(linked as Address, token.address))
        throw Error(
          "Registry token does not match the handoff. Transactions are disabled.",
        );
      if (identity.current !== requestedAccount) return;
      setState({
        block,
        at: Date.now(),
        symbol: symbol as string,
        decimals: Number(decimals),
        supply: supply as bigint,
        owner: owner as Address,
        count: count as bigint,
        balance: balance as bigint,
        native,
        price: slot[0],
        liquidity,
        fee: slot[3],
        pairSymbol,
        pairDecimals: Number(pairDecimals),
        pairBalance,
      });
      setVerified(true);
      setReadError("");
    } catch (e) {
      setVerified(false);
      setReadError(errorText(e));
    } finally {
      reading.current = false;
    }
  }, [account, client, d, token, registry, verify]);
  useEffect(() => {
    setVerified(false);
    setState(undefined);
    void refresh();
    const timer = setInterval(
      () => {
        if (document.visibilityState === "visible") void refresh();
      },
      account ? 5000 : 30000,
    );
    return () => clearInterval(timer);
  }, [refresh, account]);
  const connect = async () => {
    setWalletBusy(true);
    setTxError("");
    try {
      const available =
        connectors.find((c) => c.id !== "injected") ?? connectors[0];
      if (!available || !(await available.getProvider()))
        throw Error(
          "No browser wallet found. Install an Ethereum-compatible wallet, then reload this page.",
        );
      await connectAsync({ connector: available });
    } catch (e) {
      setTxError(errorText(e));
    } finally {
      setWalletBusy(false);
    }
  };
  const switchChain = async () => {
    setWalletBusy(true);
    setTxError("");
    try {
      const provider = await connector?.getProvider();
      if (!provider) throw Error("Reconnect your wallet to switch networks.");
      await switchNetwork(provider as Parameters<typeof switchNetwork>[0], d);
    } catch (e) {
      setTxError(errorText(e));
    } finally {
      setWalletBusy(false);
    }
  };
  const ready =
    !!account &&
    chainId === d.chainId &&
    verified &&
    !!state &&
    Date.now() - state.at < 20000;
  const run = async (id: string, call: Write) => {
    if (lock.current) return false;
    if (!ready || !account || !connector) {
      setTxError(
        "Connect on the correct network and refresh verified live state before submitting.",
      );
      return false;
    }
    lock.current = true;
    setBusy(id);
    setHash(undefined);
    setTxError("");
    let sent: Hex | undefined;
    let resolved = false;
    let replacedAction = false;
    try {
      setMessage(`${id}: checking network and simulating…`);
      await verify();
      const provider = await connector.getProvider();
      const wallet = createWalletClient({
        account,
        chain: runtime.chain,
        transport: custom(provider as Parameters<typeof custom>[0]),
      });
      if (
        (await wallet.getChainId()) !== d.chainId ||
        !same((await wallet.getAddresses())[0], account)
      )
        throw Error(
          "Wallet account or network changed. Refresh and review the action again.",
        );
      const { request } = await client.simulateContract({ ...call, account });
      const [gas, gasPrice] = await Promise.all([
        client.estimateContractGas({ ...call, account }),
        client.getGasPrice(),
      ]);
      setMessage(
        `${id}: confirm in your wallet. Estimated network fee ${formatUnits(gas * gasPrice, d.network.nativeCurrency.decimals)} ${d.network.nativeCurrency.symbol}.`,
      );
      sent = await wallet.writeContract({
        ...request,
        chain: runtime.chain,
        account,
      });
      setHash(sent);
      setMessage(`${id}: submitted. Waiting for confirmation…`);
      const receipt = await client.waitForTransactionReceipt({
        hash: sent,
        timeout: 120000,
        confirmations: 1,
        onReplaced: (replacement) => {
          sent = replacement.transaction.hash;
          setHash(sent);
          replacedAction = replacement.reason !== "repriced";
        },
      });
      resolved = true;
      if (replacedAction)
        throw Error(
          "Transaction was replaced with a different action. Review the explorer before trying again.",
        );
      if (receipt.status !== "success")
        throw Error(
          "Transaction reverted on chain. Open the explorer for details; no action was completed.",
        );
      setMessage("Confirmed on chain. Refreshing balances and contract state.");
      await refresh();
      return true;
    } catch (e) {
      setMessage("");
      if (sent && !resolved) {
        try {
          const receipt = await client.getTransactionReceipt({ hash: sent });
          resolved = true;
          if (receipt.status === "success" && !replacedAction) {
            setMessage(
              "Confirmed on chain. Refreshing balances and contract state.",
            );
            await refresh();
            return true;
          }
          setTxError(
            "The transaction reverted or was replaced. Review its receipt on the explorer.",
          );
        } catch {
          setTxError(errorText(e));
          setMessage(
            "Confirmation is still unknown. Check the receipt before submitting another transaction.",
          );
        }
      } else setTxError(errorText(e));
      return false;
    } finally {
      if (!sent || resolved) {
        lock.current = false;
        setBusy("");
      } else setBusy("Awaiting receipt");
    }
  };
  const retryReceipt = async () => {
    if (!hash) return;
    setTxError("");
    try {
      const r = await client.getTransactionReceipt({ hash });
      setMessage(
        r.status === "success"
          ? "Confirmed on chain."
          : "Transaction reverted on chain.",
      );
      lock.current = false;
      setBusy("");
      await refresh();
    } catch {
      setTxError(
        "Receipt is not available yet. Keep the transaction hash and check again.",
      );
    }
  };
  return (
    <Context.Provider
      value={{
        ...runtime,
        account,
        chainId,
        state,
        readError,
        verified,
        refresh,
        connect,
        disconnect,
        switchChain,
        walletBusy,
        ready,
        busy,
        message,
        txError,
        hash,
        run,
        retryReceipt,
      }}
    >
      {children}
    </Context.Provider>
  );
}
