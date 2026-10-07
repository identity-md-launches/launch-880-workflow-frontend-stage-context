import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  createPublicClient,
  custom,
  keccak256,
  parseAbi,
  encodeAbiParameters,
  parseAbiParameters,
} from "viem";
const exec = promisify(execFile);
const d = JSON.parse(
  await readFile(
    new URL("../../dist/imd-deployment.json", import.meta.url),
    "utf8",
  ),
);
const result = {
  checkedAt: new Date().toISOString(),
  readOnly: true,
  endpoints: [],
  contracts: [],
  infrastructure: [],
  state: {},
  errors: [],
};
let rpc;
for (const url of d.network.rpcUrls) {
  try {
    const { stdout } = await exec("curl", [
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      "15",
      "-H",
      "Content-Type: application/json",
      "--data",
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "eth_chainId",
        params: [],
      }),
      url,
    ]);
    const body = JSON.parse(stdout);
    if (body.error) throw Error(JSON.stringify(body.error));
    result.endpoints.push({
      url,
      chainId: parseInt(body.result, 16),
      matches: parseInt(body.result, 16) === d.chainId,
    });
    if (parseInt(body.result, 16) === d.chainId && !rpc) rpc = url;
  } catch (e) {
    result.endpoints.push({ url, error: e.message });
  }
}
if (rpc) {
  const client = createPublicClient({
    transport: custom(
      {
        request: async ({ method, params }) => {
          const { stdout } = await exec("curl", [
            "--fail",
            "--silent",
            "--show-error",
            "--max-time",
            "15",
            "-H",
            "Content-Type: application/json",
            "--data",
            JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            rpc,
          ]);
          const json = JSON.parse(stdout);
          if (json.error) throw Error(json.error.message);
          return json.result;
        },
      },
      { retryCount: 0 },
    ),
  });
  const block = await client.getBlockNumber();
  result.block = String(block);
  await Promise.all(
    d.contracts.map(async (c) => {
      try {
        const code = await client.getCode({
          address: c.address,
          blockNumber: block,
        });
        result.contracts.push({
          name: c.name,
          address: c.address,
          bytes: code ? (code.length - 2) / 2 : 0,
          codeHash: code ? keccak256(code) : null,
        });
      } catch (e) {
        result.errors.push(e.message);
      }
    }),
  );
  const infra = [
    ...Object.entries(d.network.uniswapV4).filter(
      ([, v]) => typeof v === "string",
    ),
    ["initializationGuard", d.poolKey.hooks],
  ];
  await Promise.all(
    infra.map(async ([name, address]) => {
      try {
        const code = await client.getCode({ address, blockNumber: block });
        result.infrastructure.push({
          name,
          address,
          bytes: code ? (code.length - 2) / 2 : 0,
        });
      } catch (e) {
        result.errors.push(name + ": " + e.message);
      }
    }),
  );
  const token = d.contracts.find((c) => c.name === "LaunchToken"),
    registry = d.contracts.find((c) => c.name === "MossExperimentRegistry");
  for (const [contract, functions] of [
    [token, ["symbol", "decimals", "totalSupply"]],
    [registry, ["owner", "token", "proposalCount"]],
  ]) {
    const abi = JSON.parse(
      await readFile(
        new URL(`../../dist/${contract.abiPath}`, import.meta.url),
        "utf8",
      ),
    );
    for (const functionName of functions) {
      try {
        result.state[functionName] = await client.readContract({
          address: contract.address,
          abi,
          functionName,
          blockNumber: block,
        });
      } catch (e) {
        result.errors.push(`${functionName}: ${e.message}`);
      }
    }
  }
  try {
    const id = keccak256(
      encodeAbiParameters(
        parseAbiParameters(
          "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)",
        ),
        [d.poolKey],
      ),
    );
    result.state.poolId = id;
    result.state.slot0 = await client.readContract({
      address: d.network.uniswapV4.stateView,
      abi: parseAbi([
        "function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)",
      ]),
      functionName: "getSlot0",
      args: [id],
      blockNumber: block,
    });
    result.state.liquidity = await client.readContract({
      address: d.network.uniswapV4.stateView,
      abi: parseAbi(["function getLiquidity(bytes32) view returns(uint128)"]),
      functionName: "getLiquidity",
      args: [id],
      blockNumber: block,
    });
    const { result: quote } = await client.simulateContract({
      address: d.network.uniswapV4.quoter,
      abi: parseAbi([
        "function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256,uint256)",
      ]),
      functionName: "quoteExactInputSingle",
      args: [
        {
          poolKey: d.poolKey,
          zeroForOne: true,
          exactAmount: 1000000000000000n,
          hookData: "0x",
        },
      ],
      blockNumber: block,
    });
    result.state.readOnlyQuote = {
      inputWei: "1000000000000000",
      outputMinorUnits: String(quote[0]),
      gasEstimate: String(quote[1]),
    };
  } catch (e) {
    result.errors.push("Pool read: " + e.message);
  }
}
result.status =
  rpc &&
  result.contracts.length === d.contracts.length &&
  result.contracts.every((c) => c.bytes > 0) &&
  result.infrastructure.every((c) => c.bytes > 0) &&
  result.errors.length === 0
    ? "PASS"
    : "LIMITED";
await writeFile(
  new URL("../../docs/frontend/live-read.json", import.meta.url),
  JSON.stringify(
    result,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    result,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
