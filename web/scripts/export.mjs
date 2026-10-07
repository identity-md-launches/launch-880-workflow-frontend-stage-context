import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { keccak256, toBytes } from "viem";
const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = resolve(root, "dist");
const check = process.argv.includes("--check");
const json = async (p) => JSON.parse(await readFile(p, "utf8"));
const handoff = await json(resolve(root, "web/handoff/deployment.json"));
const net = await json(resolve(root, "web/handoff/network.json"));
function canonical(v) {
  return Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
}
const equal = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
for (const [name, saved] of [
  ["deployment", handoff],
  ["network", net],
]) {
  try {
    const pinned = await json(resolve(root, `.imd/reads/${name}.json`));
    if (!equal(saved, pinned)) throw Error(`${name} differs from pinned input`);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
const manifest = {
  version: 1,
  launchId: handoff.launchId,
  chainId: handoff.chainId,
  sourceCommit: handoff.sourceCommit,
  attestationHash: handoff.attestationHash,
  contracts: [],
  assets: [],
  ...(handoff.poolKey ? { poolKey: handoff.poolKey } : {}),
  network: net.network,
  ...(net.walletAddChain ? { walletAddChain: net.walletAddChain } : {}),
};
if (net.network.chainId !== handoff.chainId)
  throw Error("Network chain mismatch");
for (const { name, address, abiHash } of handoff.contracts) {
  const path = `docs/abi/${name}.json`;
  const pinned = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:${path}`],
    { cwd: root, encoding: "utf8" },
  );
  const current = await readFile(resolve(root, path), "utf8");
  if (!equal(JSON.parse(pinned), JSON.parse(current)))
    throw Error(`${name} ABI differs from deployed source`);
  const abi = JSON.parse(pinned);
  if (
    !Array.isArray(abi) ||
    keccak256(toBytes(JSON.stringify(canonical(abi)))).slice(2) !== abiHash
  )
    throw Error(`${name} ABI hash mismatch`);
  const abiPath = `abi/${name}.json`;
  if (!check) {
    await mkdir(resolve(dist, "abi"), { recursive: true });
    await writeFile(
      resolve(dist, abiPath),
      JSON.stringify(abi, null, 2) + "\n",
    );
  } else if (!equal(abi, await json(resolve(dist, abiPath))))
    throw Error(`${name} export ABI mismatch`);
  manifest.contracts.push({ name, address, abiHash, abiPath });
}
async function walk(dir) {
  for (const ent of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = resolve(dir, ent.name);
    const path = relative(dist, full).split("\\").join("/");
    if (ent.isSymbolicLink()) throw Error("Symlinks forbidden");
    if (ent.isDirectory()) await walk(full);
    else if (path !== "imd-deployment.json") {
      const bytes = await readFile(full);
      if (bytes.length > 8388608) throw Error("Asset exceeds 8 MiB");
      manifest.assets.push({
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
await walk(dist);
if (
  !manifest.assets.some((a) => a.path === "index.html") ||
  manifest.assets.length > 128
)
  throw Error("Invalid inventory");
const total = (
  await Promise.all(
    manifest.assets.map(async (a) => (await stat(resolve(dist, a.path))).size),
  )
).reduce((a, b) => a + b, 0);
if (total > 7 * 1024 * 1024)
  throw Error("Export too large for submission budget");
const dest = resolve(dist, "imd-deployment.json");
if (check) {
  if (!equal(manifest, await json(dest)))
    throw Error("Manifest/configuration or asset hashes differ");
} else await writeFile(dest, JSON.stringify(manifest, null, 2) + "\n");
console.log(
  `${check ? "Verified" : "Exported"} ${manifest.contracts.length} pinned ABIs; ${manifest.assets.length} assets; ${total} bytes. Exact handoff, network and SHA-256 inventory match.`,
);
