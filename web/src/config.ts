import {
  createPublicClient,
  defineChain,
  fallback,
  http,
  keccak256,
  toBytes,
  type Abi,
  type Address,
} from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};
export type Deployment = {
  version: 1;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  poolKey: PoolKey;
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    uniswapV4: {
      poolManager: Address;
      universalRouter: Address;
      quoter: Address;
      stateView: Address;
      positionManager: Address;
      permit2: Address;
      extendedSwapParams?: boolean;
    };
    pairToken?: { address: Address; symbol: string; decimals: number };
    otherPairTokens?: { address: Address; symbol: string; decimals: number }[];
  };
  walletAddChain?: Record<string, unknown>;
};
export function canonical(v: unknown): unknown {
  return Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        )
      : v;
}
export function abiHash(abi: Abi) {
  return keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2);
}
export async function loadRuntime() {
  const response = await fetch("./imd-deployment.json", { cache: "no-store" });
  if (!response.ok)
    throw Error(
      "Deployment configuration is unavailable. Reload to try again.",
    );
  const deployment: Deployment = await response.json();
  if (
    deployment.version !== 1 ||
    deployment.chainId !== deployment.network?.chainId ||
    !deployment.poolKey
  )
    throw Error(
      "Deployment configuration is inconsistent. Transactions are unavailable.",
    );
  const contracts = Object.fromEntries(
    await Promise.all(
      deployment.contracts.map(async (c) => {
        if (
          !/^[\w/-]+\.json$/.test(c.abiPath) ||
          c.abiPath.includes("..") ||
          c.abiPath.startsWith("/")
        )
          throw Error("Unsafe ABI path");
        const res = await fetch(`./${c.abiPath}`);
        if (!res.ok) throw Error(`Cannot load ${c.name} ABI`);
        const abi: Abi = await res.json();
        if (!Array.isArray(abi) || abiHash(abi) !== c.abiHash)
          throw Error(`${c.name} ABI verification failed`);
        return [c.name, { ...c, abi }];
      }),
    ),
  );
  if (!contracts.LaunchToken || !contracts.MossExperimentRegistry)
    throw Error("Required contracts are missing");
  const n = deployment.network;
  const chain = defineChain({
    id: deployment.chainId,
    name: n.name,
    nativeCurrency: n.nativeCurrency,
    rpcUrls: { default: { http: n.rpcUrls } },
    blockExplorers: { default: { name: "Explorer", url: n.explorer } },
    testnet: n.testnet,
  });
  const transport = () =>
    fallback(
      n.rpcUrls.map((url) => http(url, { timeout: 10000, retryCount: 1 })),
      { rank: false },
    );
  const client = createPublicClient({ chain, transport: transport() });
  const wagmi = createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: transport() },
    multiInjectedProviderDiscovery: true,
  });
  return { deployment, contracts, chain, client, wagmi };
}
export type Runtime = Awaited<ReturnType<typeof loadRuntime>>;
