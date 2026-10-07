import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  decodeAbiParameters,
  parseAbiParameters,
  zeroAddress,
  type Abi,
  type Address,
} from "viem";
import {
  amountUnits,
  encodeSwap,
  minimumOutput,
  poolType,
  switchNetwork,
} from "../src/protocol";
import { abiHash, type Deployment } from "../src/config";
const d = JSON.parse(
  readFileSync(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
) as Deployment;
describe("attested deployment", () => {
  it("binds both implementation-derived ABIs", () => {
    for (const c of d.contracts) {
      const abi = JSON.parse(
        readFileSync(
          new URL(`../../dist/${c.abiPath}`, import.meta.url),
          "utf8",
        ),
      ) as Abi;
      expect(abiHash(abi)).toBe(c.abiHash);
    }
  });
  it("ABI object key order is canonical", () =>
    expect(
      abiHash([
        {
          type: "function",
          name: "x",
          inputs: [],
          outputs: [],
          stateMutability: "view",
        },
      ]),
    ).toBe(
      abiHash([
        {
          name: "x",
          outputs: [],
          inputs: [],
          stateMutability: "view",
          type: "function",
        },
      ]),
    ));
});
describe("amounts and slippage", () => {
  it("preserves token precision", () =>
    expect(amountUnits("1.123456", 6)).toBe(1123456n));
  it.each(["", "-1", "1e5", "1.0000001", "0", "Infinity", ".1"])(
    "rejects unsafe six-decimal input %s",
    (v) => expect(() => amountUnits(v, 6)).toThrow(),
  );
  it("permits explicit zero allowance revocation", () =>
    expect(amountUnits("0", 18, true)).toBe(0n));
  it("rejects uint128 overflow", () =>
    expect(() => amountUnits(String(1n << 128n), 0)).toThrow());
  it("rounds minimum output down", () =>
    expect(minimumOutput(101n, "0.5")).toBe(100n));
  it.each(["0", "5.01", "-1", "NaN", "0.555"])(
    "rejects invalid slippage %s",
    (v) => expect(() => minimumOutput(100n, v)).toThrow(),
  );
});
describe("router payload", () => {
  for (const extended of [true, false])
    it(`uses correct ${extended ? "six" : "five"}-field tuple`, () => {
      const config = {
        ...d,
        network: {
          ...d.network,
          uniswapV4: { ...d.network.uniswapV4, extendedSwapParams: extended },
        },
      };
      const x = encodeSwap(config, d.poolKey.currency0, 100n, 90n);
      expect(x.commands).toBe("0x10");
      expect(x.value).toBe(100n);
      const [actions, params] = decodeAbiParameters(
        parseAbiParameters("bytes,bytes[]"),
        x.inputs[0],
      );
      expect(actions).toBe("0x060c0f");
      const [decoded] = decodeAbiParameters(
        parseAbiParameters(
          `(${poolType} poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,${extended ? "uint256 minHopPriceX36," : ""}bytes hookData)`,
        ),
        params[0],
      );
      expect((decoded as any).poolKey.hooks.toLowerCase()).toBe(
        d.poolKey.hooks,
      );
      expect((decoded as any).poolKey.fee).toBe(d.poolKey.fee);
      expect((decoded as any).amountOutMinimum).toBe(90n);
      expect((decoded as any).zeroForOne).toBe(true);
      expect(
        decodeAbiParameters(
          parseAbiParameters("address,uint256"),
          params[1],
        )[1],
      ).toBe(100n);
    });
  it("ERC20 input sends no ETH and reverses direction", () => {
    const x = encodeSwap(d, d.poolKey.currency1, 100n, 90n);
    expect(x.value).toBe(0n);
    const [, params] = decodeAbiParameters(
      parseAbiParameters("bytes,bytes[]"),
      x.inputs[0],
    );
    const [decoded] = decodeAbiParameters(
      parseAbiParameters(`(${poolType},bool,uint128,uint128,uint256,bytes)`),
      params[0],
    );
    expect((decoded as any)[1]).toBe(false);
  });
  it("works when ERC20 pair is sorted either way", () => {
    for (const currency0 of [
      d.poolKey.currency1,
      "0x1111111111111111111111111111111111111111" as Address,
    ]) {
      const currency1 =
        currency0 === d.poolKey.currency1
          ? "0xffffffffffffffffffffffffffffffffffffffff"
          : d.poolKey.currency1;
      const conf = {
        ...d,
        poolKey: { ...d.poolKey, currency0, currency1: currency1 as Address },
      };
      expect(encodeSwap(conf, currency1 as Address, 10n, 9n).value).toBe(0n);
    }
  });
  it("rejects a currency outside the pool", () =>
    expect(() =>
      encodeSwap(d, "0x1111111111111111111111111111111111111111", 1n, 1n),
    ).toThrow());
});
describe("wallet network negotiation", () => {
  it("adds an unknown chain using the exact chain table then switches again", async () => {
    const calls: any[] = [];
    await switchNetwork(
      {
        request: async (arg) => {
          calls.push(arg);
          if (calls.length === 1) throw { code: 4902 };
          return null;
        },
      },
      d,
    );
    expect(calls.map((c) => c.method)).toEqual([
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ]);
    expect(calls[1].params).toEqual([d.walletAddChain]);
  });
  it("does not add a chain after user rejection", async () => {
    const calls: string[] = [];
    await expect(
      switchNetwork(
        {
          request: async (arg) => {
            calls.push(arg.method);
            throw { code: 4001 };
          },
        },
        d,
      ),
    ).rejects.toEqual({ code: 4001 });
    expect(calls).toHaveLength(1);
  });
  it("handles explicit unknown-chain messages", async () => {
    let n = 0;
    await switchNetwork(
      {
        request: async () => {
          if (++n === 1) throw { message: "Unrecognized chain ID" };
        },
      },
      d,
    );
    expect(n).toBe(3);
  });
});
