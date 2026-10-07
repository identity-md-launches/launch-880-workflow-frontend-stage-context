import {
  encodeAbiParameters,
  keccak256,
  parseAbi,
  parseAbiParameters,
  parseUnits,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import type { Deployment, PoolKey } from "./config";
export const poolType =
  "(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)";
export const quoterAbi = parseAbi([
  `function quoteExactInputSingle((${poolType} poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) returns (uint256 amountOut, uint256 gasEstimate)`,
]);
export const stateAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128)",
]);
export const routerAbi = parseAbi([
  "function execute(bytes commands, bytes[] inputs, uint256 deadline) payable",
]);
export const permitAbi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
export const erc20Abi = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
]);
export const same = (a?: string, b?: string) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const poolId = (pool: PoolKey) =>
  keccak256(encodeAbiParameters(parseAbiParameters(poolType), [pool]));
export function amountUnits(text: string, decimals: number, allowZero = false) {
  if (
    !/^\d+(\.\d+)?$/.test(text) ||
    (text.split(".")[1]?.length ?? 0) > decimals
  )
    throw Error(
      `Enter a valid amount with at most ${decimals} decimal places.`,
    );
  const n = parseUnits(text, decimals);
  if (n < 0n || (!allowZero && n === 0n) || n >= 1n << 128n)
    throw Error("Enter an amount greater than zero and below the pool limit.");
  return n;
}
export function minimumOutput(out: bigint, slippage: string) {
  const p = Number(slippage);
  if (
    !Number.isFinite(p) ||
    p < 0.1 ||
    p > 5 ||
    !/^\d+(\.\d{1,2})?$/.test(slippage)
  )
    throw Error("Choose slippage between 0.1% and 5% (up to two decimals).");
  return (out * (10000n - BigInt(Math.round(p * 100)))) / 10000n;
}
export function encodeSwap(
  d: Deployment,
  input: Address,
  amount: bigint,
  min: bigint,
) {
  const p = d.poolKey;
  if (!same(input, p.currency0) && !same(input, p.currency1))
    throw Error("Currency is outside the attested pool");
  const zeroForOne = same(input, p.currency0);
  const output = zeroForOne ? p.currency1 : p.currency0;
  const tuple = `(${poolType} poolKey, bool zeroForOne, uint128 amountIn, uint128 amountOutMinimum, ${d.network.uniswapV4.extendedSwapParams ? "uint256 minHopPriceX36, " : ""}bytes hookData)`;
  const data = {
    poolKey: p,
    zeroForOne,
    amountIn: amount,
    amountOutMinimum: min,
    ...(d.network.uniswapV4.extendedSwapParams ? { minHopPriceX36: 0n } : {}),
    hookData: "0x" as Hex,
  };
  const params = [
    encodeAbiParameters(parseAbiParameters(tuple), [data]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [input, amount]),
    encodeAbiParameters(parseAbiParameters("address,uint256"), [output, min]),
  ];
  return {
    commands: "0x10" as Hex,
    inputs: [
      encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [
        "0x060c0f",
        params,
      ]),
    ],
    value: same(input, zeroAddress) ? amount : 0n,
  };
}
export async function switchNetwork(
  provider: {
    request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  },
  d: Deployment,
) {
  const params = [{ chainId: `0x${d.chainId.toString(16)}` }];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params });
  } catch (e) {
    const error = e as {
      code?: number;
      message?: string;
      cause?: { code?: number };
    };
    if (
      error.code === 4902 ||
      error.cause?.code === 4902 ||
      /unknown chain|unrecognized chain|not added/i.test(error.message ?? "")
    ) {
      if (!d.walletAddChain)
        throw Error(
          "This wallet is missing the chain and no chain setup is available.",
        );
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [d.walletAddChain],
      });
      await provider.request({ method: "wallet_switchEthereumChain", params });
    } else throw e;
  }
}
export function errorText(e: unknown) {
  const error = e as {
    shortMessage?: string;
    message?: string;
    code?: number;
    cause?: { code?: number };
  };
  if (
    error.code === 4001 ||
    error.cause?.code === 4001 ||
    /user rejected|user denied/i.test(error.shortMessage ?? error.message ?? "")
  )
    return "Request declined in your wallet. Nothing was submitted; you can try again.";
  return (
    error.shortMessage ??
    error.message ??
    "Request failed. Check your connection and try again."
  ).slice(0, 700);
}
