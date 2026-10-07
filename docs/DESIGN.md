# Moss interface design

## Overview

Moss is a token trading interface and a public experiment catalog for Robinhood Chain. The implemented visual direction is a quiet field notebook: warm paper, forest green controls, serif editorial headings and compact monospace labels. This direction was inferred from the Moss name; the requester did not prescribe a visual system. The unavailable social reference was not used to invent product functionality.

Source: `web/src/styles.css`, `web/src/App.tsx`, `web/src/ui.tsx`. The trade view places its introductory story beside the primary swap control. The registry and token tools use shorter introductions and task-focused forms. Documentation lives at `docs/DESIGN.md` because the explicit write budget prohibits a repository-root `DESIGN.md`.

## Colors

The canonical representation is CSS hex. Reuse semantic custom properties from `:root` in `web/src/styles.css`:

| Token | Value | Role |
| --- | --- | --- |
| `--color-bg` | `#f6f5ee` | Page paper |
| `--color-surface` | `#fffef8` | Cards and inputs |
| `--color-inset` | `#efeee5` | Amount wells and segmented controls |
| `--color-text` | `#27382b` | Primary text |
| `--color-muted` | `#606958` | Supporting text |
| `--color-accent` | `#354e31` | Primary action background |
| `--color-accent-hover` | `#233c23` | Primary hover |
| `--color-on-accent` | `#f7f7ed` | Primary button text |
| `--color-border` | `#d6d9c9` | Noninteractive structure |
| `--color-input-border` | `#89927e` | Input and secondary control boundaries |
| `--color-focus` | `#436c24` | Three-pixel keyboard outline |
| `--color-error` | `#8f3123` | Error text |
| `--color-error-bg` | `#fff0e8` | Error background |
| `--color-note-bg` | `#e8ecdd` | Explanations and quote details |

Decorative garden colors are local to `.garden` and `.orb`; they do not encode transaction state. Status always includes text. The design intentionally has one light theme. Browser measurements and accessibility results belong to `docs/frontend/VALIDATION.md` and the accompanying JSON evidence.

## Typography

Body and controls use `Arial, Helvetica, sans-serif`, with a 16px root size and 1.5 line height. Serif titles use `Georgia, Times New Roman, serif`, at weight 400; the italic word in the trade heading is decorative emphasis. All fonts are system fallbacks: no font service or downloaded font files are required, and the exact face varies by platform.

The trade heading scales with `clamp(3.5rem, 6.1vw, 5.3rem)` on large screens, with explicit 4.5rem, 4.1rem and 4rem breakpoint adjustments. Registry page headings use 3.5rem, then 2.8rem and 2.6rem. Standard section headings are 1.45rem with 1.1 line height; prose generally uses 0.875–1rem and 1.5–1.75 line height. Small metadata is 0.68–0.8125rem; amount controls and all form inputs stay at least 16px.

`.eyebrow`, `.mono`, code and garden captions use Courier New with monospace fallback. Changing numbers use tabular numerals. Long addresses and hashes use `overflow-wrap: anywhere`. Headings use balanced wrapping, short prose uses pretty wrapping, and paragraphs have a 70ch measure. Reduced addresses expose the full value through their accessible name, title, explorer link and copy control.

## Layout

The shared header, main and footer have a 1280px maximum width and 48px inline padding. Spacing is primarily multiples of 8px, with 12px control gaps where useful. The trade hero uses a `1.12fr 1fr` grid with an 80px gap. `.form-layout` uses a `.8fr 1.2fr` grid; `.stack` provides a 20px vertical gap. Proposal grids have two columns and 20px gaps.

Actual CSS breakpoints:

- 1050px: reduce page padding to 32px, hide the small brand descriptor and reduce grid gaps.
- 800px: navigation wraps to its own row; the trade grid becomes one column; forms and proposals stack. The garden temporarily sits next to the title. Deployment details use two columns.
- 480px: 20px page padding, garden below the introduction, overview statistics stacked, deployment details in one column, all history fields stacked. Controls remain inside page margins.

All primary controls stay in normal document flow. There are no fixed bottom bars or overlays. Hash navigation works on static hosts without rewrite rules. Validation includes desktop, intermediate, phone and 320px reflow screenshots/checks; native zoom, physical devices and RTL/localized content are not claimed.

## Elevation & Depth

Most surfaces use a border or a tonal background. Only the swap card has a soft two-layer shadow (`0 2px 4px #2e402608`, `0 14px 45px #2e402609`) to prioritize the main action. Segmented selection has a restrained one-pixel shadow. Decorative orbs use radial gradients and an inset shadow. The only local stacking layer is the arrow between amount wells (`z-index: 1`); the keyboard skip link uses `z-index: 10`.

## Shapes

Buttons and form fields use 8px radii; notes and amount wells use 12px; panels use 16px. The swap card uses 22px (18px on phones), inset by 28px (20px on phones). The asymmetric garden clipping and circular currency markers are decorative exceptions. Structural borders are 1px. Input and action hit areas have a 44px minimum; primary actions have a 48px minimum. Copy controls are 32px high with separation from their neighboring link.

## Components

- `AddressView` (`web/src/ui.tsx`): explorer link with a checksummed address, optional descriptive label, and a copy action. Shows copy success or a manual-copy fallback. Does not claim ENS support on this chain.
- `Field`: real label connected by a stable generated ID; hints are separate accessible descriptions. Wraps an input, select or textarea without adding custom keyboard behavior.
- `Gate`: connection action, wrong-chain instruction, or verified-state prerequisite. Transaction signing remains unavailable until prerequisites pass.
- `Action`: submit button with an action-specific pending label. The shared transaction lock prevents competing submissions through receipt confirmation.
- `ErrorLine`: persistent inline alert. Connection, simulation, wallet rejection and receipt status also have visible global messages.
- `Swap` (`web/src/Swap.tsx`): buy/sell segmented buttons, input amount, output estimate, slippage, quote details and exactly one next transaction step. Quotes invalidate on account/network/input changes and expire after 60 seconds. Separate exact-amount ERC-20 and Permit2 approvals precede a token-input swap.
- `Registry` (`web/src/Registry.tsx`): navigation buttons with `aria-pressed`, an empty state, proposal cards, paginated records, proposal form, owner decision form and bounded event history. Native details disclose hashes without a modal.
- `TokenTools`: transfer, allowance/revocation and delegated-transfer forms with an explicit review checkbox.

Buttons and links have visible three-pixel focus outlines. A skip link precedes the header. Native links, buttons, inputs, selects, checkboxes, summaries and forms provide keyboard behavior. Button background/press transitions last 120ms and only run under `prefers-reduced-motion: no-preference`; there is no autoplay or entrance animation. Forced-colors mode preserves system focus colors.

## Do's and Don'ts

- Start another task page with `.section`, `.section-heading`, `.form-layout` and `.stack`. Use `Field`, `Gate` and `Action` for new contract controls.
- Derive addresses, chain metadata and deployment ABIs from the loaded deployment manifest. Do not introduce a parallel runtime map.
- Use a filled primary control for the next transaction step, neutral controls for navigation and inspection, and text explanations for unavailable prerequisites.
- Keep hashes and addresses selectable, with complete values available. Do not manufacture names, prices, yields or catalog entries.
- Keep transaction eligibility in live checks and simulation. A zero-liquidity current tick does not prove that a v4 quote cannot cross into another range.
- Preserve the distinction between an owner endorsement and experiment safety. The registry does not execute experiments or change the pool.
- Do not add network fonts, decorative motion, a new theme, or a new color representation without a concrete product need.

Guidance applied: Better Interface by Jakub Krehel, commit `267330e1adfc66a718fb65fa6918c1f06d0a689e` (MIT); documentation method adapted from Paul Bakaus's Impeccable, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8` (Apache-2.0). License texts are in `docs/frontend/BETTER-INTERFACE-LICENSE.txt`. Ethereum UX guidance by Austin Griffith at commit `06ea4efa0807` is attributed in `docs/frontend/ETH-UX-LICENSE.txt`.
