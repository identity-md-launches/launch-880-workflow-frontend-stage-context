import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, extname } from "node:path";
import assert from "node:assert/strict";
import {
  decodeFunctionData,
  encodeFunctionResult,
  parseAbi,
  toHex,
  keccak256,
  toBytes,
} from "viem";
const root = fileURLToPath(new URL("../../", import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(root, "test/scratch/browsers");
const { chromium, expect } = await import("@playwright/test");
const { default: AxeBuilder } = await import("@axe-core/playwright");
const dist = resolve(root, "dist");
const evidence = resolve(root, "docs/frontend");
await mkdir(evidence, { recursive: true });
const d = JSON.parse(
  await readFile(resolve(dist, "imd-deployment.json"), "utf8"),
);
const token = d.contracts.find((c) => c.name === "LaunchToken"),
  registry = d.contracts.find((c) => c.name === "MossExperimentRegistry");
const tokenAbi = JSON.parse(
    await readFile(resolve(dist, token.abiPath), "utf8"),
  ),
  registryAbi = JSON.parse(
    await readFile(resolve(dist, registry.abiPath), "utf8"),
  );
const poolType =
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const quoteAbi = parseAbi([
  `function quoteExactInputSingle((${poolType} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256,uint256)`,
]);
const stateAbi = parseAbi([
  "function getSlot0(bytes32) view returns(uint160,int24,uint24,uint24)",
  "function getLiquidity(bytes32) view returns(uint128)",
]);
const permitAbi = parseAbi([
  "function allowance(address,address,address) view returns(uint160,uint48,uint48)",
  "function approve(address,address,uint160,uint48)",
]);
const routerAbi = parseAbi(["function execute(bytes,bytes[],uint256) payable"]);
const owner = "0x1111111111111111111111111111111111111111",
  outsider = "0x2222222222222222222222222222222222222222",
  implementation = "0x3333333333333333333333333333333333333333";
const zeroHash = `0x${"0".repeat(64)}`,
  blockHash = `0x${"a".repeat(64)}`;
const mock = {
  allowance: 0n,
  permit: 0n,
  expiry: 0,
  proposals: [],
  sent: [],
  simRevert: false,
  missingCode: false,
  rpcFail: false,
  delayReceipt: false,
  block: 82378753n,
};
function abiFor(address) {
  address = address.toLowerCase();
  if (address === token.address) return tokenAbi;
  if (address === registry.address) return registryAbi;
  if (address === d.network.uniswapV4.quoter) return quoteAbi;
  if (address === d.network.uniswapV4.stateView) return stateAbi;
  if (address === d.network.uniswapV4.permit2) return permitAbi;
  if (address === d.network.uniswapV4.universalRouter) return routerAbi;
  throw Error("Unexpected contract " + address);
}
function receipt(hash) {
  return {
    transactionHash: hash,
    transactionIndex: "0x0",
    blockHash,
    blockNumber: "0x4e90001",
    from: owner,
    to: token.address,
    cumulativeGasUsed: "0x5208",
    gasUsed: "0x5208",
    effectiveGasPrice: "0x3b9aca00",
    contractAddress: null,
    logs: [],
    logsBloom: "0x" + "0".repeat(512),
    status: "0x1",
    type: "0x2",
  };
}
function call(tx) {
  const abi = abiFor(tx.to);
  const decoded = decodeFunctionData({ abi, data: tx.data });
  const { functionName: f, args = [] } = decoded;
  let result;
  if (f === "symbol" || f === "name") result = "Moss";
  else if (f === "decimals") result = 18;
  else if (f === "totalSupply") result = 10n ** 27n;
  else if (f === "balanceOf") result = 100000n * 10n ** 18n;
  else if (f === "owner") result = owner;
  else if (f === "token") result = token.address;
  else if (f === "proposalCount") result = BigInt(mock.proposals.length);
  else if (f === "getSlot0") result = [2n ** 96n, 0, 0, d.poolKey.fee];
  else if (f === "getLiquidity") result = 0n;
  else if (f === "allowance")
    result =
      tx.to.toLowerCase() === d.network.uniswapV4.permit2
        ? [mock.permit, mock.expiry, 0]
        : mock.allowance;
  else if (f === "quoteExactInputSingle")
    result = [
      args[0].zeroForOne
        ? args[0].exactAmount * 2000n
        : args[0].exactAmount / 2000n,
      200000n,
    ];
  else if (f === "getProposal") {
    result = mock.proposals[Number(args[0]) - 1];
    if (!result) throw Error("UnknownProposal");
  } else if (f === "isActive") {
    result = mock.proposals[Number(args[0]) - 1]?.status === 2;
  } else if (f === "activeProposal") {
    const i = mock.proposals.findIndex(
      (p) => p.key === args[0] && p.status === 2,
    );
    result = BigInt(i + 1);
  } else if (f === "execute") {
    if (mock.simRevert) throw Error("PRICE_LIMIT: simulation rejected");
    result = undefined;
  } else if (f === "propose") result = BigInt(mock.proposals.length + 1);
  else if (
    ["approve", "transfer", "transferFrom"].includes(f) &&
    tx.to.toLowerCase() === token.address
  )
    result = true;
  else result = undefined;
  return encodeFunctionResult({ abi, functionName: f, result });
}
async function rpc(body) {
  if (mock.rpcFail)
    return {
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32000, message: "Mock RPC unavailable" },
    };
  try {
    let result;
    const p = body.params ?? [];
    switch (body.method) {
      case "eth_chainId":
        result = toHex(d.chainId);
        break;
      case "eth_blockNumber":
        result = toHex(mock.block++);
        break;
      case "eth_getCode":
        result = mock.missingCode ? "0x" : "0x6001600055";
        break;
      case "eth_getBalance":
        result = toHex(10n ** 20n);
        break;
      case "eth_call":
        result = call(p[0]);
        break;
      case "eth_estimateGas":
        result = "0x493e0";
        break;
      case "eth_gasPrice":
        result = "0x3b9aca00";
        break;
      case "eth_getTransactionByHash":
        result = {
          hash: p[0],
          nonce: "0x0",
          blockHash,
          blockNumber: "0x4e90001",
          transactionIndex: "0x0",
          from: owner,
          to: d.network.uniswapV4.universalRouter,
          value: "0x0",
          gas: "0x493e0",
          gasPrice: "0x3b9aca00",
          input: "0x",
          v: "0x1",
          r: zeroHash,
          s: zeroHash,
          type: "0x0",
        };
        break;
      case "eth_getTransactionReceipt":
        result = mock.delayReceipt ? null : receipt(p[0]);
        break;
      case "eth_getLogs":
        result = [];
        break;
      case "eth_getBlockByNumber":
        result = {
          number: "0x4e90001",
          hash: blockHash,
          parentHash: zeroHash,
          nonce: "0x0000000000000000",
          sha3Uncles: zeroHash,
          logsBloom: "0x" + "0".repeat(512),
          transactionsRoot: zeroHash,
          stateRoot: zeroHash,
          receiptsRoot: zeroHash,
          miner: owner,
          difficulty: "0x0",
          totalDifficulty: "0x0",
          extraData: "0x",
          size: "0x1",
          gasLimit: "0x1c9c380",
          gasUsed: "0x0",
          timestamp: toHex(Math.floor(Date.now() / 1000)),
          transactions: [],
          uncles: [],
          baseFeePerGas: "0x1",
        };
        break;
      default:
        throw Error("Unhandled RPC method " + body.method);
    }
    return { jsonrpc: "2.0", id: body.id, result };
  } catch (e) {
    return {
      jsonrpc: "2.0",
      id: body.id,
      error: { code: 3, message: `execution reverted: ${e.message}` },
    };
  }
}
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://local");
    if (!url.pathname.startsWith("/preview/")) {
      res.writeHead(404).end();
      return;
    }
    const name = decodeURIComponent(url.pathname.slice(9)) || "index.html";
    const path = resolve(dist, name);
    if (!path.startsWith(dist + "/")) throw Error();
    const body = await readFile(path);
    res
      .writeHead(200, {
        "Content-Type": types[extname(path)] ?? "application/octet-stream",
      })
      .end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const report = {
  date: new Date().toISOString(),
  browser: browser.version(),
  productionSubpath: "/preview/",
  checks: [],
  screenshots: [],
  errors: [],
  accessibility: [],
  viewports: [],
};
const check = (name) => {
  report.checks.push(name);
  console.log("PASS " + name);
};
let context;
async function newPage(wallet = true) {
  context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  await context.route("https://**", async (route) => {
    if (!d.network.rpcUrls.some((r) => route.request().url().startsWith(r))) {
      await route.abort();
      return;
    }
    const body = route.request().postDataJSON();
    const result = Array.isArray(body)
      ? await Promise.all(body.map(rpc))
      : await rpc(body);
    await route.fulfill({
      json: result,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await context.exposeFunction("recordTransaction", async (tx) => {
    const decoded = decodeFunctionData({ abi: abiFor(tx.to), data: tx.data });
    mock.sent.push({ to: tx.to, ...decoded, value: tx.value });
    const { functionName: f, args = [] } = decoded;
    if (f === "approve" && tx.to.toLowerCase() === token.address)
      mock.allowance = args[1];
    if (
      f === "approve" &&
      tx.to.toLowerCase() === d.network.uniswapV4.permit2
    ) {
      mock.permit = args[2];
      mock.expiry = Number(args[3]);
    }
    if (f === "propose")
      mock.proposals.push({
        key: args[0],
        implementation: args[1],
        contentHash: args[2],
        codeHash: keccak256("0x6001600055"),
        proposer: owner,
        status: 1,
      });
    if (f === "approve" && tx.to.toLowerCase() === registry.address)
      mock.proposals[Number(args[0]) - 1].status = 2;
    if (f === "reject") mock.proposals[Number(args[0]) - 1].status = 4;
    if (f === "retire") {
      const p = mock.proposals.find((p) => p.key === args[0] && p.status === 2);
      p.status = 3;
    }
    return "0x" + mock.sent.length.toString(16).padStart(64, "0");
  });
  if (wallet)
    await context.addInitScript(
      ({ owner, chain }) => {
        const listeners = {};
        const state = {
          account: owner,
          chain: "0x1",
          connected: false,
          added: false,
          rejectNext: false,
          requests: [],
        };
        window.__wallet = state;
        window.ethereum = {
          isMetaMask: true,
          on(event, fn) {
            (listeners[event] ??= []).push(fn);
          },
          removeListener(event, fn) {
            listeners[event] = (listeners[event] ?? []).filter((x) => x !== fn);
          },
          async request(req) {
            state.requests.push(req);
            switch (req.method) {
              case "eth_accounts":
                return state.connected ? [state.account] : [];
              case "eth_requestAccounts":
                state.connected = true;
                return [state.account];
              case "eth_chainId":
                return state.chain;
              case "wallet_requestPermissions":
                return [
                  {
                    parentCapability: "eth_accounts",
                    caveats: [
                      {
                        type: "restrictReturnedAccounts",
                        value: [state.account],
                      },
                    ],
                  },
                ];
              case "wallet_getPermissions":
                return [];
              case "wallet_switchEthereumChain":
                if (!state.added)
                  throw { code: 4902, message: "Unknown chain" };
                state.chain = req.params[0].chainId;
                for (const fn of listeners.chainChanged ?? []) fn(state.chain);
                return null;
              case "wallet_addEthereumChain":
                state.added = true;
                return null;
              case "eth_sendTransaction":
                if (state.rejectNext) {
                  state.rejectNext = false;
                  throw { code: 4001, message: "User rejected request" };
                }
                await new Promise((r) => setTimeout(r, 250));
                return window.recordTransaction(req.params[0]);
              case "wallet_getCapabilities":
                return {};
              default:
                throw Error("Unexpected wallet request " + req.method);
            }
          },
        };
        window.__changeAccount = (account) => {
          state.account = account;
          for (const fn of listeners.accountsChanged ?? []) fn([account]);
        };
      },
      { owner, chain: d.chainId },
    );
  const page = await context.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") report.errors.push(m.text());
  });
  await page.goto(url);
  await expect(page.getByText(/Synced · block/)).toBeVisible({
    timeout: 15000,
  });
  return page;
}
async function shot(page, name) {
  await page.screenshot({ path: resolve(evidence, name), fullPage: true });
  report.screenshots.push(name);
}
async function axe(page, state) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  report.accessibility.push({
    state,
    violations: result.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target),
    })),
  });
  assert.equal(
    result.violations.length,
    0,
    `${state} accessibility violations: ${result.violations.map((v) => v.id)}`,
  );
}
try {
  let page = await newPage(false);
  await page.locator(".connect").click();
  await expect(
    page.getByRole("alert").filter({ hasText: "No browser wallet found" }),
  ).toBeVisible();
  check("Missing wallet gives recovery instructions; writes remain gated");
  await context.close();
  page = await newPage();
  await shot(page, "desktop-trade.png");
  report.contrast = await page.evaluate(() => {
    const lum = (color) => {
      const parts = color
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map((n) => {
          const c = n / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
      return parts[0] * 0.2126 + parts[1] * 0.7152 + parts[2] * 0.0722;
    };
    return [
      ".hero-copy > p",
      ".primary",
      ".eyebrow",
      ".amount-row output",
      ".slippage",
      ".caption",
    ].map((selector) => {
      const el = document.querySelector(selector);
      const css = getComputedStyle(el);
      let p = el;
      let bg = "rgba(0, 0, 0, 0)";
      while (p && bg === "rgba(0, 0, 0, 0)") {
        bg = getComputedStyle(p).backgroundColor;
        p = p.parentElement;
      }
      const fg = css.color;
      const a = lum(fg),
        b = lum(bg);
      return {
        selector,
        foreground: fg,
        background: bg,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
        fontSize: css.fontSize,
      };
    });
  });
  for (const pair of report.contrast)
    assert.ok(
      pair.ratio >= 4.5,
      `Contrast failure ${pair.selector}: ${pair.ratio}`,
    );
  check("Measured rendered text and action contrast pairs exceed 4.5:1");

  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await shot(page, "keyboard-focus.png");
  check("Keyboard entry has a visible skip link");
  await axe(page, "desktop disconnected");
  await page.locator(".connect").click();
  await expect(
    page.getByRole("button", {
      name: `Switch to ${d.network.name}`,
      exact: true,
    }),
  ).toBeVisible();
  assert.equal(mock.sent.length, 0);
  check("Wrong-chain state blocks trading");
  await page
    .getByRole("button", { name: `Switch to ${d.network.name}`, exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Get quote", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  const walletCalls = await page.evaluate(() => window.__wallet.requests);
  assert.deepEqual(
    walletCalls.find((x) => x.method === "wallet_addEthereumChain").params,
    [d.walletAddChain],
  );
  check(
    "Unknown chain invokes add-chain with the exact network table, then switches",
  );
  await page.getByLabel("You pay", { exact: true }).focus();
  await page.keyboard.insertText("-1");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Slippage tolerance")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "Get quote", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  check(
    "Keyboard traverses amount, slippage and quote controls and submits validation",
  );
  await expect(page.locator("#swap-error")).toContainText("valid amount");
  check("Invalid swap amount is rejected before a wallet request");
  await page.getByLabel("You pay", { exact: true }).fill("0.01");
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Swap 0.01 ETH", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/Minimum received/)).toBeVisible();
  await page.getByLabel("Slippage tolerance").fill("1");
  await expect(
    page.getByRole("button", { name: "Swap 0.01 ETH", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Swap 0.01 ETH", exact: true }),
  ).toBeVisible();
  check("Editing slippage invalidates the previous quote before a new review");

  mock.simRevert = true;
  await page
    .getByRole("button", { name: "Swap 0.01 ETH", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: /PRICE_LIMIT/ }),
  ).toBeVisible({ timeout: 10000 });
  assert.equal(mock.sent.length, 0);
  check(
    "Router simulation failure is shown and never reaches wallet submission",
  );
  mock.simRevert = false;
  await page.evaluate(() => (window.__wallet.rejectNext = true));
  await page
    .getByRole("button", { name: "Swap 0.01 ETH", exact: true })
    .click();
  await expect(page.getByText(/Request declined in your wallet/)).toBeVisible();
  assert.equal(mock.sent.length, 0);
  check("Wallet rejection clears pending state and allows retry");
  mock.delayReceipt = true;
  await page
    .getByRole("button", { name: "Swap 0.01 ETH", exact: true })
    .dblclick();
  await expect(
    page.getByText("Swap: submitted. Waiting for confirmation…"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Swapping…", exact: true }),
  ).toBeDisabled();
  assert.equal(mock.sent.length, 1);
  check("Double submission is blocked until receipt confirmation");
  mock.delayReceipt = false;
  await expect(
    page.getByText(
      "Confirmed on chain. Refreshing balances and contract state.",
    ),
  ).toBeVisible({ timeout: 15000 });
  assert.equal(
    mock.sent[0].to.toLowerCase(),
    d.network.uniswapV4.universalRouter,
  );
  assert.equal(BigInt(mock.sent[0].value), 10n ** 16n);
  check("Native buy uses attested router and sends exact input value");
  await page.getByRole("button", { name: "Sell Moss", exact: true }).click();
  await page.getByLabel("You pay", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Get quote", exact: true }).click();
  await page
    .getByRole("button", { name: "Approve Moss for Permit2", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Approve router in Permit2",
      exact: true,
    }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .getByRole("button", { name: "Approve router in Permit2", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Swap 1 Moss", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "Swap 1 Moss", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Get quote", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  assert.equal(mock.sent[1].args[0].toLowerCase(), d.network.uniswapV4.permit2);
  assert.equal(
    mock.sent[2].args[1].toLowerCase(),
    d.network.uniswapV4.universalRouter,
  );
  assert.equal(BigInt(mock.sent[3].value ?? 0), 0n);
  check(
    "ERC20 sell confirms exact token and Permit2 approvals as separate steps before swap",
  );
  await page.getByRole("link", { name: "Experiments", exact: true }).click();
  await expect(page.getByText("The first idea starts with you.")).toBeVisible();
  check("Empty registry has a useful next action");
  await page
    .getByRole("button", { name: "Propose experiment", exact: true })
    .click();
  await page
    .getByLabel("Experiment identifier", { exact: true })
    .fill("growth-study");
  await page.getByLabel("Deployed experiment address").fill(implementation);
  await page
    .getByLabel("Exact journal document")
    .fill("A reproducible experiment.\n");
  await page
    .getByRole("button", { name: "Propose experiment", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Experiment #1", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  assert.equal(
    mock.proposals[0].contentHash,
    keccak256(toBytes("A reproducible experiment.\n")),
  );
  check(
    "Public proposal stores the exact journal hash and refreshes the catalog",
  );
  await page
    .getByRole("button", { name: "Inspect proposal", exact: true })
    .click();
  await page
    .getByLabel("Exact decision document")
    .fill("Reviewed by the owner.");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Approve experiment", exact: true })
    .click();
  await expect(page.getByText("#1 · Endorsed", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  check("Owner can approve a pending proposal with its observed active ID");
  await page.getByLabel("Decision", { exact: true }).selectOption("retire");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Retire experiment", exact: true })
    .click();
  await expect(page.getByText("#1 · Retired", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  check("Owner can retire an active endorsement");
  await page
    .getByRole("button", { name: "Propose experiment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Propose experiment", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("heading", { name: "Experiment #2", exact: true }),
  ).toBeVisible({ timeout: 15000 });
  await page
    .locator(".proposal")
    .filter({ hasText: "Experiment #2" })
    .getByRole("button", { name: "Inspect proposal" })
    .click();
  await page.getByLabel("Decision", { exact: true }).selectOption("reject");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Reject experiment", exact: true })
    .click();
  await expect(page.getByText("#2 · Rejected", { exact: true })).toBeVisible({
    timeout: 15000,
  });
  check("Owner can reject a pending proposal");
  await page.evaluate((outsider) => window.__changeAccount(outsider), outsider);
  await expect(
    page.getByText("Only the registry owner can submit decisions."),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Reject experiment", exact: true }),
  ).toBeDisabled();
  check("Non-owner decisions are visibly gated");
  await page
    .getByRole("button", { name: "Decision history", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Load decision history", exact: true })
    .click();
  await expect(
    page.getByText(/No registry events in this range/),
  ).toBeVisible();
  check("Bounded event history reports an honest empty range");
  await page.getByRole("link", { name: "Token tools", exact: true }).click();
  await page.getByLabel("Recipient address", { exact: true }).fill(owner);
  await page.getByLabel("Amount (Moss)", { exact: true }).fill("2");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Send Moss", exact: true }).click();
  await expect(page.getByLabel("Amount (Moss)", { exact: true })).toHaveValue(
    "",
    { timeout: 15000 },
  );
  check(
    "Token transfer requires review and submits the exact recipient/amount",
  );
  await page.getByLabel("Token action").selectOption("approve");
  await page.getByLabel("Spender address").fill(owner);
  await page.getByLabel("Amount (Moss)").fill("0");
  await page.getByRole("button", { name: "Read current allowance" }).click();
  await expect(page.getByText(/Current allowance:/)).toBeVisible();
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Set allowance", exact: true })
    .click();
  await expect(page.getByLabel("Amount (Moss)")).toHaveValue("", {
    timeout: 15000,
  });
  assert.equal(mock.sent.at(-1).args[1], 0n);
  check("Allowance read and explicit zero revocation work");
  await page.getByLabel("Token action").selectOption("transferFrom");
  await page.getByLabel("Token owner address").fill(owner);
  await page.getByLabel("Recipient address").fill(implementation);
  await page.getByLabel("Amount (Moss)").fill("1");
  await page.getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Transfer delegated Moss", exact: true })
    .click();
  await expect(page.getByLabel("Amount (Moss)")).toHaveValue("", {
    timeout: 15000,
  });
  assert.equal(mock.sent.at(-1).functionName, "transferFrom");
  check("Delegated transfer exposes owner, recipient and amount controls");
  await axe(page, "token tools");
  await page.getByRole("link", { name: "Experiments", exact: true }).click();
  await axe(page, "populated registry");
  await shot(page, "desktop-registry.png");
  for (const width of [800, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("link", { name: "Trade", exact: true }).click();
    await page.waitForTimeout(150);
    const size = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(size.scroll <= size.width, `overflow at ${width}`);
    report.viewports.push(size);
    await axe(page, `trade ${width}px`);
    if (width === 390) await shot(page, "mobile-trade.png");
    await page.getByRole("link", { name: "Experiments", exact: true }).click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      `registry overflow at ${width}`,
    );
    if (width === 320) await shot(page, "mobile-registry-320.png");
  }
  check(
    "Desktop, 800px, 390px and 320px layouts fit without horizontal overflow",
  );

  await page.getByRole("link", { name: "Token tools", exact: true }).click();
  await page
    .getByLabel("Recipient address", { exact: true })
    .fill(implementation);
  await page
    .getByLabel("Amount (Moss)", { exact: true })
    .fill("123456789.123456789123456789");
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "Token form overflow at 320px",
  );
  await axe(page, "token form 320px");
  await shot(page, "mobile-tools-320.png");
  check("Full addresses and 18-decimal amounts fit the 320px token form");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("link", { name: "Trade", exact: true }).click();
  assert.equal(await page.locator(".connect").count(), 0);
  const transition = await page
    .locator("button")
    .first()
    .evaluate((e) => getComputedStyle(e).transitionDuration);
  assert.equal(transition, "0s");
  check("Reduced-motion preference removes button transitions");
  mock.missingCode = true;
  await page.reload();
  await expect(
    page.getByText(/configured contract has no deployed code/),
  ).toBeVisible({ timeout: 15000 });
  await expect(
    page.getByRole("button", { name: "Get quote", exact: true }),
  ).toHaveCount(0);
  check("Missing deployed code disables transaction controls");
  mock.missingCode = false;
  await context.close();
  context = await browser.newContext();
  await context.route("**/abi/LaunchToken.json", (r) =>
    r.fulfill({ json: [] }),
  );
  page = await context.newPage();
  await page.goto(url);
  await expect(
    page.getByRole("heading", { name: "Deployment unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText("LaunchToken ABI verification failed"),
  ).toBeVisible();
  check("ABI tampering fails closed before the application loads");
  assert.deepEqual(report.errors, []);
  check("No browser JavaScript errors during the tested interaction flows");

  await context.close();
  context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
  });
  const livePage = await context.newPage();
  const liveErrors = [];
  livePage.on("console", (msg) => {
    if (msg.type() === "error") liveErrors.push(msg.text());
  });
  await livePage.goto(url);
  try {
    await expect(livePage.getByText(/Synced · block/)).toBeVisible({
      timeout: 25000,
    });
    report.liveBrowser = {
      status: "PASS",
      networkLine: await livePage.locator(".network-line").innerText(),
      consoleErrors: liveErrors,
    };
    await shot(livePage, "live-home.png");
  } catch {
    report.liveBrowser = {
      status: "UNAVAILABLE",
      detail: await livePage.locator("main").innerText(),
      consoleErrors: liveErrors,
    };
  }
  report.result = "PASS";
  report.transactionCount = mock.sent.length;
  report.transactions = mock.sent;
  await writeFile(
    resolve(evidence, "browser-results.json"),
    JSON.stringify(
      report,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ) + "\n",
  );
} catch (e) {
  report.result = "FAIL";
  report.failure = e.stack;
  await writeFile(
    resolve(evidence, "browser-results.json"),
    JSON.stringify(
      report,
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ) + "\n",
  );
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
