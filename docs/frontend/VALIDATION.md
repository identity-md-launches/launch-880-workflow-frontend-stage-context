# Moss frontend validation

Worker report, 2026-10-07. This is local validation evidence, not an independent network certification.

## Scope and assumptions

Implemented the deployed Moss token, public experiment registry and attested ETH/Moss pool. The runtime loads `dist/imd-deployment.json` and its referenced implementation-derived ABIs. The handoff source commit is `171fbcdaca959d6b9ec7d719579e2e1a157841ff`; the build verifies the ABI arrays from that exact Git commit. Neither deployed source nor root build configuration was changed.

The social-reference URL in the workflow returned HTTP 403 when accessed. Functionality and claims therefore follow the actual contracts and handoff. This release is an experiment catalog, not an interchangeable swap-hook system. The copy explains that distinction. No prices, yields, endorsements or historic journal documents are invented.

The task's explicit path budget forbids root `DESIGN.md`, despite requesting it in the general acceptance criteria. The implemented design documentation is delivered at `docs/DESIGN.md`. No other root configuration or dotfile was added. Only the explicitly allowed `web/.gitignore` was created.

## Commands and results

All commands below ran from the repository root and completed successfully unless explicitly marked unavailable.

| Check | Result | Evidence |
| --- | --- | --- |
| `npm --prefix web ci --offline --cache test/scratch/npm-cache --no-audit --no-fund` | Pass; exact lockfile installed from the worker's populated cache | `install.log` |
| `npm --prefix web run typecheck` | Pass | `typecheck.log` |
| `npm --prefix web run build` | Pass; Vite relative base, then ABI/config/inventory generation | `build.log` |
| `npm --prefix web run test` | 26 protocol tests passed | `unit-tests.log` |
| `npm --prefix web run check:export` | Pass; both ABI hashes, exact contract set, identifiers, network, wallet-add-chain block, pool key and all asset hashes match | `export-check.log` |
| Compare rebuilt manifest with the browser-tested export | Byte-identical, including all asset hashes | `cmp dist/imd-deployment.json test/scratch/before-offline.json`, exit 0 |
| `npm --prefix web run test:browser` | 29 recorded checks passed; 12 mocked transaction submissions; seven axe states have zero violations | `browser-results.json` |
| `node web/scripts/check-live.mjs` | Read-only RPC/code/state and quoter checks passed | `live-read.json` |
| Supplied browser MCP | Unavailable: `Transport closed` | Replaced by local Playwright Chromium in one bounded foreground command |

The exported inventory has seven assets totaling **649,288 bytes**, excluding the small manifest. Each file is below 8 MiB and the asset count is below 128. There are no external runtime fonts/images, source maps, dependency archives, package caches or node_modules in the export. Bundle-size warning: the main JavaScript chunk is approximately 614 kB uncompressed (188 kB gzip); the whole export is comfortably within the delivery budget. Build warnings about third-party PURE annotations did not affect generation. npm reports deprecated transitive wallet SDK packages; the app enables injected connectors only. No package audit/security certification is claimed.

## Interaction and browser coverage

The production files were served under `/preview/`, including relative config, ABI, JavaScript, CSS and favicon requests. Playwright Chromium `153.0.8010.12` was used; the script owns and closes its server and browser. Mocked browser flows intercept only the configured public RPCs and provide an EIP-1193 wallet. Nothing is broadcast to a network.

Tested:

- Missing browser wallet with recovery instructions; disconnected transaction gates.
- Wrong-chain state; exact `wallet_addEthereumChain` parameters after error 4902, followed by a successful switch.
- Invalid amount, keyboard traversal from amount to slippage to quote, quote invalidation after changing slippage, and displayed minimum output.
- Router simulation failure preventing signing; wallet rejection with retry; pending receipt lock preventing duplicate submissions.
- Native buy with exact ETH value; ERC-20 sell with separate exact-amount token-to-Permit2 and Permit2-to-router approvals, confirmed before execution; no ETH value on the sell.
- Empty and populated registry; exact journal hashing; public proposal; owner approval, retirement and rejection; non-owner restriction; bounded empty event history.
- Token transfer, live allowance read, zero revocation and delegated transfer, with explicit review checkboxes.
- Missing deployed code and tampered ABI fail closed.
- No JavaScript console errors in the mocked flows. All production static files loaded successfully, and the manifest check independently verifies their inventory and bytes.

Unit tests additionally cover precision rejection, uint128 bounds, slippage rounding/bounds, object-key canonicalization, exact ABI bindings, standard five-field and extended six-field v4 encoding, reversed currency directions, ERC-20 pair ordering, and rejected/unknown-chain wallet negotiation.

Desktop screenshots use 1440×1050. Reflow checks cover 800×900, 390×900 and 320×900. Trade and registry document widths equal the viewport; the token form also fits at 320px with full addresses and an 18-decimal amount. Long input values scroll inside native fields and the full confirmation text wraps below them. Reduced-motion emulation removes button transitions. The screenshot files were opened and visually inspected, including the keyboard skip-link focus ring and phone form focus ring.

| Screenshot | Observed state |
| --- | --- |
| `desktop-trade.png` | Disconnected, mocked valid deployment; trade layout and overview |
| `keyboard-focus.png` | Visible keyboard skip link |
| `desktop-registry.png` | Mocked rejected/retired proposal cards |
| `mobile-trade.png` | 390px connected trade view |
| `mobile-registry-320.png` | 320px proposal catalog |
| `mobile-tools-320.png` | 320px token form with long values and visible focus |
| `live-home.png` | Unmocked browser RPC reads, disconnected, real empty registry |

A separate unmocked browser context successfully loaded the live homepage, synchronized to block **82,244,929**, and recorded no console errors. That establishes public-RPC browser access for this worker run; it does not establish real-wallet transaction success.

## Read-only chain evidence

`live-read.json` records the exact checked block **82,241,832**, endpoints and outputs. Both configured public endpoints returned chain ID 4663. Code was nonempty for both application contracts, all six configured Uniswap contracts and the initialization guard. Symbol/decimals, fixed supply, registry owner and token link, proposal count, pool slot and current-tick liquidity were read at that block. No bytecode equivalence beyond the recorded code hashes is asserted.

A read-only quoter simulation for `1,000,000,000,000,000` input wei returned `98,581,161,212,609,396,633,789` output minor units and gas estimate 87,452. Current-tick liquidity was zero. This observation prompted removal of an incorrect zero-liquidity trading gate: a v4 swap can cross into a range with liquidity. Quote output is historical evidence, not a current price promise.

The recipe is `web/scripts/check-live.mjs`: `eth_chainId` on both URLs, then `eth_getCode`, `eth_call` and quoter simulation pinned to the captured `eth_blockNumber`. It never requests accounts, signatures or `eth_sendTransaction`.

Protocol interface source references consulted: [Uniswap IV4Quoter](https://raw.githubusercontent.com/Uniswap/v4-periphery/main/src/interfaces/IV4Quoter.sol) and [Uniswap IStateView](https://raw.githubusercontent.com/Uniswap/v4-periphery/main/src/interfaces/IStateView.sol). The pinned network handoff, not those sources, supplies all protocol addresses and the Robinhood-specific extended swap tuple requirement.

## Better Interface: six-domain review

Applied the pinned Better Interface guide during construction and reviewed all six domains after corrections. Design values and reuse instructions are extracted from the final source in `docs/DESIGN.md`.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native controls/landmarks, connected labels and separate hints, persistent alerts/status, keyboard skip and quote sequence, disabled prerequisites, visible focus, reduced motion. Seven axe scans have zero violations. No screen-reader session, real-device accessibility test or full compliance claim. |
| Layout | Checked | Desktop two-column trade and forms, stacked phone layouts, full addresses and long amounts, 800/390/320px width checks and inspected screenshots. Native 200% browser zoom, translated strings and RTL not performed. |
| Writing | Checked | Verb-first consequential controls, approval amounts and expiry, minimum output, wallet rejection recovery, owner-only explanation, permanent proposal/decision semantics, honest empty states and unavailable USD context. No fabricated social-post interpretation or safety endorsement. |
| Typography | Checked | Serif/sans hierarchy, actual rendered sizes, selectable/wrapping hashes, 16px form inputs, tabular numbers, native field scrolling for long values. System font fallbacks intentionally vary; cross-platform font rendering not tested. |
| Colors | Checked | Semantic tokens, textual status cues, six computed foreground/background pairs and axe contrast checks. Focus inspected visually. Gradient artwork is decorative/aria-hidden; its ornamental marks do not carry product information. No dark theme is implemented. |
| UI details | Checked | Native disclosures and form controls, selected/hover/focus/disabled/pending/error/empty states, neutral secondary actions, one next swap step, 120ms optional button transitions and static feedback. No dialogs, autoplay, theme toggle or overlays to audit. |

Measured browser pairs (from computed styles over opaque rendered backgrounds):

| Foreground / background | Usage | Contrast |
| --- | --- | --- |
| `#606958` / `#f6f5ee` | Hero body and eyebrow | 5.25:1 |
| `#f7f7ed` / `#354e31` | Primary button | 8.52:1 |
| `#606958` / `#f3f3eb` | Estimated amount | 5.15:1 |
| `#27382b` / `#fffef8` | Slippage text | 12.32:1 |
| `#606958` / `#fffef8` | Card caption | 5.68:1 |

These values were computed by the browser test; they are not estimates or a claim about every possible overlay/background state.

## Findings corrected

| Severity / source | Reproduction and impact | Correction and recheck |
| --- | --- | --- |
| High — `web/src/Swap.tsx:105` | Real state returned zero current-tick liquidity while a quoter call succeeded. The initial gate would have blocked usable pool trading. | Require initialization, then use actual quote and execute simulation. Browser buy/sell passes with mocked current-tick liquidity of zero; read-only live quote recorded. |
| Medium — `web/src/ui.tsx:52` | The original wrapping label included helper text in its accessible name; an exact-name browser query for “Experiment identifier” failed. | Separate real label and hint, connect the hint with `aria-describedby`. Exact-name proposal and all token form interactions now pass. |
| High — `web/src/context.tsx:282` | Review of pending receipt handling found that a second receipt lookup could keep a confirmed replacement locked, or lose a later successful receipt after a polling error. | Track resolved receipts separately from the submitted hash, follow repricing, distinguish replacement intent, keep unknown receipts locked with recovery. Pending lock and successful receipt paths pass in the browser; actual replacement and timeout scenarios remain source-reviewed only. |
| Medium — `web/src/ui.tsx:84` | Connection/refresh controls can appear inside forms. Default button types could trigger form validation/submission while connecting. | Explicit non-submit types for connection, refresh and copy controls. Disconnected connection and subsequent proposal flow pass. |

Test-harness defects (browser binary search path and missing mocked transaction-by-hash/block progression) were repaired before the final passing run. They are not product findings. No reproduced blocker remains in the permitted deliverable.

## Limitations and completion

Implementation and worker validation are complete within the allowed write scope, with the root-DESIGN path conflict handled by the scoped document. A Git commit could not be created: `git add` failed because `.git/index.lock` is on a read-only filesystem. The files are saved in the permitted working-tree paths for collection; they are not staged or committed. No real transaction, approval, signature, contract deployment, site publication, IPFS pin or naming operation was performed. Real funded swaps and owner decisions, real wallet extension UI, transaction replacements/timeouts, historical populated live registry logs, native zoom, screen readers, physical devices, Safari/Firefox and post-publication CID/name checks remain untested. The first injected wallet is selected; WalletConnect is not configured without a project ID. The catalog does not retrieve document contents from their hashes.

The publisher must perform the separately defined hosting/configuration/RPC acceptance checks. This report does not substitute for those checks or claim their success.

## Submission integrity

`git diff --check` passed. All 50 deliverable files present before the size record were inside `web/`, `dist/` or `docs/`; the only new dotfile is the explicitly allowed `web/.gitignore`. Protected source/configuration paths remain unchanged, and there are no submitted symlinks, submodules, dependency archives or generated dependency/cache trees. `submission-check.json` records 2,534,624 bytes of deliverables before that record, a 117,469-byte full bundle of the existing Git history, and a conservative 3,700,669-byte bound after reserving 1 MiB for Git metadata and final documentation changes. This is below 8,388,608 bytes; it is a conservative bound, not a claim that a final committed bundle could be produced in the read-only Git workspace.
