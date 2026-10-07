# Moss frontend

React, TypeScript, Vite, wagmi and viem frontend for the already deployed Moss token, experiment registry and Uniswap v4 pool. The delivered `../dist/` is the complete static site; it needs no backend or rewrite rules. This assignment does not deploy contracts or publish the website.

## Install, build and preview

Run from the repository root with Node 22:

```sh
npm --prefix web ci
npm --prefix web run typecheck
npm --prefix web run test
npm --prefix web run build
npm --prefix web run check:export
npm --prefix web run preview
```

`npm ci` uses `web/package-lock.json`; initial installation may need registry access. Once dependencies are installed, typecheck/build/tests do not access the network. No vendored registry or dependency archive is required. `node_modules` and caches are not delivered. Vite writes only `dist/` and uses `base: './'`; routing uses URL fragments. Serve through HTTP(S), not `file://`, because the application fetches JSON at runtime. In a fresh checkout run the build before tests if the delivered export has been removed.

## One runtime configuration

The app fetches `dist/imd-deployment.json`, then fetches each referenced ABI and checks its canonical Keccak-256 hash before mounting. All application addresses, chain metadata, RPC URLs, pool-key fields and Uniswap addresses come from that file. There is no environment variable, secret or independent runtime address map.

`web/handoff/deployment.json` and `web/handoff/network.json` retain the exact supplied handoff for repeatable builds after `.imd/reads/` is removed. They are build inputs only. `web/scripts/export.mjs` compares them with the original pinned inputs when available. It obtains each ABI with `git show <sourceCommit>:docs/abi/<Contract>.json`, checks the current export against it and verifies canonical Keccak. The specified Git commit must remain available in the repository. Canonicalization sorts object keys recursively and preserves array order.

The build copies raw JSON ABI arrays into `dist/abi/` and writes `imd-deployment.json` **after** Vite finishes. It copies exactly the attested contract set, identifiers, pool key, network and wallet-add-chain parameters, then enumerates every other exported file and calculates lowercase SHA-256. `check:export` independently regenerates that expected inventory without mutating files. Never edit the export manually; rebuild after a source/export change.

The factory handoff's pool fee is authoritative. The older embedded launch manifest's fee is an admission field and is not used for trading. The pool's initialization guard is preserved exactly. Generic protocol interface fragments in `src/protocol.ts` contain no addresses; deployed application ABIs are loaded from the manifest.

## Wallets and actions

Supported wallets expose an injected EIP-1193 provider, including EIP-6963 discovery. No WalletConnect project ID was supplied, so QR/mobile bridge connectors are not configured. The first discovered injected connector is selected. The site displays the connected address and supports disconnect, chain switch, rejection recovery, and `wallet_addEthereumChain` with the exact supplied parameters after an unknown-chain failure.

Configured public RPCs are tried in order. Before enabling transactions, the app checks chain ID, nonempty code for all handoff and configured Uniswap contracts plus the guard, registry-token binding, and live state. Reads are pinned to a fetched block. Visible tabs refresh every 5 seconds while connected, every 30 seconds disconnected; reads pause when the document is hidden. Transaction preflight repeats chain/code checks, verifies wallet account/chain, simulates the call, estimates gas and then requests the wallet signature. A global lock prevents concurrent submissions, with action-specific labels. Pending transactions remain locked through a receipt or explicit receipt recovery. A repriced transaction is followed; a replacement with different intent is not reported as completion of the original action.

Trade supports both directions, token decimals, exact-input quotes, 0.1–5% slippage, rounded-down minimum output, a 60-second quote lifetime and a 10-minute swap deadline. Current-tick liquidity is informational: v4 can cross liquidity ranges. Quote failure and execute simulation determine whether a trade is feasible. Native input carries the exact value and requires no approval. ERC-20 input checks allowances, then separately requests an exact-amount token approval to Permit2 and a 30-minute Permit2 approval to the router only when needed. Router command `0x10`, actions `0x060c0f`, and the network's extended six-field tuple are tested. Existing generic five-field handling is also unit-tested. No unlimited approval is requested.

Token tools expose `transfer`, `approve` including zero revocation, and `transferFrom`. Registry controls expose `propose`, owner `approve`/replacement, `reject` and `retire`. Approval/retirement uses the active ID observed at review time; the contract rejects stale decisions. Catalog reads include proposal fields, active-pointer state and direct-code validity. Event history is an explicit range query limited to 10,000 blocks, defaulting to the latest 2,000. It is not a full automatic indexer.

Journal and decision text is hashed as exact UTF-8; the experiment identifier is trimmed before hashing. Text is not uploaded or stored by the site. Operators must publish and retain documents independently. Endorsement is not a safety guarantee and does not execute an experiment, transfer funds, modify Moss or control the pool. Proxy/dependency changes cannot be detected by a direct runtime hash.

No USD price feed was supplied; the UI displays token units and explicitly marks USD context unavailable. No ENS resolution is claimed on this chain. Explorer links and copyable checksummed addresses are available. Absolute social-image URLs remain pending until the publisher supplies a domain.

## Validation

```sh
npm --prefix web run test
# Browser binaries are worker tooling, outside the submitted paths:
PLAYWRIGHT_BROWSERS_PATH=./test/scratch/browsers npm --prefix web exec -- playwright install chromium
npm --prefix web run test:browser
node web/scripts/check-live.mjs
```

The browser script serves the actual production export under `/preview/`, owns its server and browser within one foreground process, and tears them down. It uses a mocked EIP-1193 wallet and intercepted public RPC responses; it never broadcasts. It writes screenshots and machine-readable results under `docs/frontend/`. The protocol tests exercise canonical ABI binding, precision/slippage bounds, standard/extended swap encoding, both currency orders, and chain-add/rejection behavior.

`check-live.mjs` is read-only. It reads the two configured RPC chain IDs, code, pinned-block token/registry/pool state and a simulated quoter call, then writes `docs/frontend/live-read.json`. No accounts, keys or funds are used. Transaction success, gas expenditure, inclusion, replacement and wallet UX on real hardware remain untested on the live chain. Network availability and quotes can change after the recorded block.

See `docs/frontend/VALIDATION.md` for final commands, evidence, six-domain review, corrected findings and limitations. See `docs/DESIGN.md` for actual implemented tokens/components. The task requests a root `DESIGN.md` but explicitly forbids creating it; the scoped copy is the only design document delivered.

## Worker handoff constraint

The workspace exposes `.git` as read-only: `git add` failed while creating `.git/index.lock`. Source, lockfile, export and evidence remain saved in the permitted working-tree paths for collection; no worker commit is claimed. `docs/frontend/submission-check.json` records the path check and conservative full-submission size bound.
