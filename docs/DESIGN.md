# Breaker interface design

## Overview

Breaker is a Sepolia circuit monitor for people checking an ETH/CBRK trade. The implemented page pairs a readable pool monitor with a compact trade form. An off-white canvas, dark olive action and restrained rules keep attention on price, its reference band and the result of a simulation.

The source of truth is `web/src/style.css`; page patterns live in `web/src/App.tsx`. This is a new visual direction inferred from the assignment, not a pre-existing or separately approved brand system. The requested root `DESIGN.md` is delivered here because only `web/**`, `dist/**` and `docs/**` are writable.

## Colors

All values are CSS hex tokens at `web/src/style.css:1`. There is one light theme; no dark theme or remote theme dependency exists.

| Token | Value | Role |
| --- | --- | --- |
| `--page` | `#f5f4ef` | Page background and quiet nested surfaces |
| `--surface` | `#fffefa` | Panels, fields and unfilled buttons |
| `--text` | `#232b27` | Main text and price marker |
| `--muted` | `#61695f` | Descriptions and secondary labels |
| `--line` | `#dadfd3` | Structural separators and inactive boundaries |
| `--control-line` | `#7d877a` | Interactive field/button edges and chart guides |
| `--accent` | `#344d23` | Primary action background and links |
| `--accent-hover` | `#24391a` | Primary action hover |
| `--accent-text` | `#fffefa` | Text over the primary action |
| `--selected` | `#e7eddf` | Band surface and neutral hover |
| `--good` / `--good-bg` | `#315d36` / `#eff4e7` | Confirmed live/passing status |
| `--error` / `--error-bg` | `#943b2e` / `#fff1ec` | Errors and a simulated circuit trip |
| `--focus` | `#3158b4` | Keyboard outline |

Rendered measurements from `docs/frontend/browser-check.json`: muted/page 5.16:1; text/surface 14.39:1; primary action 9.32:1; success label/success background 6.82:1; muted/surface 5.63:1. These are measured pairs, not a claim covering every state. Status text and symbols supplement color. Expired checks return to a neutral surface.

## Typography

The font stack is `Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`. No Inter font is downloaded or bundled; browser/system fallback is intentional. Requested intermediate weights may map to the installed system faces. Monospaced values use `ui-monospace, SFMono-Regular, Consolas, monospace`. No font weights or successful font downloads are inferred from the family declaration.

- Main headline: `clamp(2.3rem, 4.2vw, 3.5rem)`, weight 530, line-height 1.08, tracking −0.06em; 2.15rem at ≤400 px.
- Section headings: 1.2rem, weight 650, line-height 1.15. Supporting headings: 1rem / 1.4.
- Body UI: `--body: .9375rem`; descriptions generally use 1.55 line-height, with a 52ch introduction measure.
- Small text: `--small: .8125rem`; chart annotations and short eyebrow labels use smaller supplemental sizes.
- Prices: `clamp(2rem, 3.3vw, 3rem)`, weight 550 and tracking −0.045em. Root tabular numerals stabilize changing values.
- Amount input: 2rem. Price tolerance input: 1rem, including mobile.

Headings use balanced wrapping; prose uses `text-wrap: pretty`. Addresses/hashes are selectable, displayed in full inside disclosure and break anywhere when needed. Shortened transaction/account labels have a full-value destination or disclosure. Monetary input stays an exact decimal string; rounding is for display only.

## Layout

The shared shell is at most 1180 px wide with 40 px outer margins on desktop. Main spacing steps are 8, 12, 16, 24, 28, 32 and 44 px. Introductory copy and the two main panels share alignment edges. The monitor precedes the form in DOM and reading order.

The desktop `.workspace` uses `minmax(0, 1.4fr) minmax(0, 1fr)` with a 24 px gap; panels use 28 px padding. The reference band contains a CSS range, center line and spot-price marker, with actual numerical bounds below it. This is a current snapshot, not a fabricated price history.

| Breakpoint | Implemented behavior |
| --- | --- |
| ≤960 px | 24 px margins, 22 px panel padding, 16 px workspace gap and 1.15:1 columns; decorative intro note hidden |
| ≤760 px | Single-column monitor/form; 24 px panel padding; header network badge hidden; explanations and deployment details stack |
| ≤400 px | 16 px margins, 18 px panels, tighter heading and numeric labels; transaction link moves to its own event-row line |

The page stays in normal flow; there are no sticky controls, fixed-height content panes or overlays. Long hashes wrap within grid cells. Rendered tests covered 1440, 820, 390 and 320 CSS px with no document overflow; an 820 px viewport also passed 200% text enlargement. This does not establish browser-native zoom, physical-device behavior or every possible intermediate width.

## Elevation & Depth

The interface is mostly flat. One-pixel rules separate functional sections. Main panels have a light structural boundary; they do not float over a background. Only the selected buy/sell button uses a small `0 1px 4px #00000012` shadow. The band uses a quiet repeating grid, a filled permitted range and a contrasting price marker. There are no images, blurs, drop-shadow illustrations or decorative animations.

## Shapes

`--radius: 18px` defines the main panel. Nested surfaces/fields use 8–10 px; the segmented direction buttons use 6 px inside their padded track. Status pills use 20 px radii. The small three-bar brand mark is CSS; `web/public/favicon.svg` is a local vector asset. Meaning does not depend on these decorative marks.

## Components

These are page/CSS patterns, not a separately exported component library.

| Pattern | Source and use | States / behavior |
| --- | --- | --- |
| Shared header | `App.tsx`, `.site-header`, `.wordmark` | Native home link, network label, connection/account button; wallet errors below intro |
| Panel and heading | `.panel`, `.section-heading` | Monitor/form structure with wrapping headings and status |
| Price band | `.band-visual`, `.band-track`, `.band-values` | Exact hook view bounds; current-price marker clamped to graphic; loading placeholders and textual context |
| Action button | `.primary`, `.secondary`, `.text-button`, `.full` | One filled primary action; explicit disabled, hover, keyboard focus and pressed states |
| Direction switch | `.direction` | Two native buttons with `aria-pressed`; switching invalidates an earlier check |
| Amount / tolerance | `.amount-field`, `.amount-row`, `.tolerance` | Persistent labels, decimal keyboards, field-specific errors, correct error focus, paste supported |
| Check result | `.check-result` | Stable polite live region; idle, loading, pass, expired, trip, empty liquidity and unknown failure |
| Transaction feedback | `.transaction-status` | Wallet confirmation, submission, receipt/revert, rejection and explorer link |
| References | `.events`, `.event-row`, `.empty-activity` | Up to five actual successful-reference events, empty and log-RPC-error states |
| Technical disclosure | `.deployment`, `.detail-grid`, `.detail-list` | Native keyboard-operable `details/summary`; full addresses, source commit, pool ID, code/ABI status and behavioral limitations |

Native controls have at least 40–44 px height; the primary action is 48 px. `:focus-visible` draws a 3 px outline with 4 px offset. The first focusable element is a skip link. In forced-colors mode the focus indicator uses `Highlight`, selected direction gains an explicit border and chart structures retain outlines.

Only button background/scale transitions are animated: 120 ms, `cubic-bezier(.2,0,0,1)`, pressed scale `.96`, inside `prefers-reduced-motion: no-preference`. Reduced-motion mode has no button transition. No modals or custom composite keyboard widgets are used.

## Do's and Don'ts

- Start another section from the shared width, panel and heading patterns. Keep numerical state separate from the action it informs.
- Use the filled olive button for the section's primary action; keep peers neutral. Use textual status alongside status colors.
- Keep input values exact, show units and maintain tabular numerals on changing output.
- Preserve full addresses and IDs in accessible disclosure; do not rely on a short address as the only inspectable value.
- Keep transaction prerequisites enforced in handlers as well as button states. An attractive success banner is not permission to bypass fresh simulation.
- Never turn unavailable observations into fabricated charts or successful placeholders. Empty and failed reads must remain distinguishable.
- For an additional page, reuse these tokens, margins, typography and native interaction patterns; retain relative asset loading and explicitly export the page or use hash routing. Do not introduce a second address configuration or a remote-font dependency.

Design review followed the pinned Better Interface guide adapted from [Jakub Krehel's Better Interface](https://github.com/jakubkrehel/skills/tree/267330e1adfc66a718fb65fa6918c1f06d0a689e/skills/better-interface) (MIT). This documentation method follows [Paul Bakaus's Impeccable reference](https://github.com/pbakaus/impeccable/blob/9d715cc4f5564a990ca8345abfdd5df6dc9b41c8/skill/reference/document.md) (Apache-2.0). The guidance was used as design knowledge; no upstream guide or component source was copied into the application.
