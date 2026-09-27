# Frontend validation

Worker report, 2026-09-27. These local results are not independent certification or the later publication checks.

## Delivery status

**Incomplete for the original live-swap requirement; useful source, static export and validation evidence are delivered.** The workflow requires PoolSwapTest, but `.imd/reads/network.json` contains no PoolSwapTest address. Its unchanged network object is mandatory, and every transaction must use an address from that object. These requirements cannot all be fulfilled with the supplied handoff. The app visibly disables approvals/swaps, while providing live StateView/hook reads, wallet handling and real Quoter `eth_call` pre-checks. A corrected approved network handoff, or explicit authorization for the listed Universal Router, is required to finish routing. No approval to substitute a router was received during this assignment.

The PoolSwapTest adapter is implemented, checks its configured code and manager binding, and passes mocked transaction tests. That is not a live router verification. Its exact transaction simulation is additional to the uncapped quoter pre-check. No signed or broadcast live transaction, redeployment, publication, IPFS pin or site naming was attempted.

The stronger write scope prevents a root `DESIGN.md`; the complete implemented design is at `docs/DESIGN.md`. The worker repository's `.git` is read-only, so delivered working-tree files cannot be committed onto its branch here. An isolated candidate commit/bundle was built in disposable scratch to verify Git packaging and size; the publisher must collect/commit the delivered files.

## Scope and assumptions

One static page, Vite + React + TypeScript, relative asset base, native ETH / CBRK exact-input buy/sell form, one light theme and injected EIP-1193 wallet. No owner/pause/mint controls exist on these contracts. No added contract functionality, liquidity management, QR wallet integration or financial price oracle was inferred.

Read inputs included the complete workflow/handoff/network definitions, deployed implementation and raw ABI exports at `41942e8d9335e3f4e35738eb008e5bb9245baf10`, the pinned Better Interface workflow and six core domains, documentation method and the protected contract checks. The contract tests were reviewed as deployment context; Foundry was not run for this frontend-only stage.

## Commands and results

Commands run from the repository root unless shown otherwise:

| Check | Result |
| --- | --- |
| `npm --prefix web run build` | Passed: TypeScript, Vite export, pinned ABI export, final manifest generation and verification |
| `npm --prefix web run typecheck` (inside build) | Passed with strict TypeScript |
| `npm --prefix web test` | 8 tests passed: ABI/pool binding, paths, exact amount parsing, inward price-limit rounding, nested hook errors, missing-chain add/switch, wallet/freshness gates, fail-closed router adapter |
| `BROWSER_EXECUTABLE=…/chrome npm --prefix web run test:browser` | 25 scenarios passed against the production export at a local `/preview/` subpath; real Chromium |
| `npm --prefix web run check:live` | All three configured public RPCs reported Sepolia, had required code, served consistent hook/StateView reads and returned real quote outcomes |
| `npm --prefix web run verify:export` | Exact handoff identifiers/contracts/network, raw ABI canonical Keccak hashes, every exported file SHA-256, safe relative paths and export budget passed |
| `node web/scripts/check-submission.mjs` | Candidate complete-tree Git bundle below 3 MiB against 8 MiB limit; only allowed changes, no gitlinks, caches, dependency trees or archives |

The final export has **7 inventoried assets plus the manifest**, totaling **565,785 bytes**. The manifest excludes itself and includes index HTML, both raw ABI JSON files, favicon and all emitted JS/CSS. The Vite main-chunk size notice (~515 KB) is nonfatal; there are no missing runtime assets, vendored dependency archives or source maps.

The Git-size script packages the complete candidate tree plus the pinned deployed source commit, stopping history at that commit because earlier ancestry in the worker mirror has a missing object. It writes only to `test/scratch/`, which is not submitted. The only new ignore file is `web/.gitignore`, explicitly budgeted to ≤1,024 bytes; its patterns exclude generated/cache directories at every depth under `web/`. Scope and size were rechecked after documentation.

## Browser and interaction evidence

Machine-readable results: `docs/frontend/browser-check.json`. Screenshots in the same directory identify mocked versus live chain data in their names. All screenshots were actually generated in Chromium; desktop and mobile images were viewed by the worker.

- Mocked chain/wallet scenarios cover disconnected/no-wallet states, input errors, correct error focus, buy/sell selection, full-input success, `Tripped`, `PhantomSwap`, generic RPC failure, current-block `ReferenceSet`, unavailable logs and missing code.
- Chain switching was tested from the wrong chain through 4902 → add the exact supplied chain parameters → switch again. Account change invalidates the check and refreshes balances.
- An unchanged real manifest disables signing even after a passing check. A separate response-only test fixture adds a fake router to exercise native-value buy, exact token approval, zero-value sell, wallet rejection, receipt success and rejection of a failed final transaction simulation. Every request in those flows is mocked; the production manifest remains unchanged.
- A new block invalidates the previous result. Freshness tests include block hash/reorg, time expiry and wallet mismatch. Pre-check now reads the latest block before simulating.
- Keyboard interaction reached the amount and tolerance fields and ran the pre-check. A 3 px focus outline was verified from computed style. This is not a complete assistive-technology session.
- No horizontal overflow at 1440, 820, 390 or 320 CSS px. At 820 px, 200% root text enlargement also had no document overflow. Native browser 200% zoom was not tested.
- axe scans at all four widths found zero WCAG A/AA violations in the tested state. This is not a claim of full accessibility conformance.
- Reduced-motion emulation produced zero-duration button transitions. The final run recorded zero browser console errors and zero failed resources.

The assigned browser tool was also used for live desktop/mobile inspection and a read-only typed buy check. A 0.000000001 ETH input returned approximately 0.04963016 CBRK at block 11,794,930. Static resources and RPC requests returned HTTP 200; the tool reported no console errors/warnings. One check encountered a block change; refreshing succeeded, and the implementation was then improved to refresh before each pre-check. The final automated browser run rechecked that fix. Tool-generated temporary screenshots/snapshots were moved into disposable scratch to keep the final submission in scope. The delivered evidence images were generated by the reproducible browser script from the final export.

## Live-chain evidence

`docs/frontend/live-check.json` records exact timestamps, blocks, block hashes, code lengths/hashes and results. At sampled block **11,794,885**, all configured RPCs agreed:

- Chain ID 11155111; CBRK and CircuitBreakerHook code present, alongside StateView/Quoter. Hook `POOL_MANAGER` matched the network handoff.
- CBRK reported 18 decimals and total supply 1,000,000,000 tokens.
- StateView price was 50,000,000 CBRK per ETH; the live price differed from the launch manifest. `currentBand` returned the current price as reference because no successful swap had set a reference for that block. No references were found in the queried 200-block window.
- Active liquidity at the exact current tick was zero. This does not prove there is no reachable liquidity: the tiny buy quote succeeded after tick traversal.
- A 1,000,000,000 wei buy passed and quoted 49,630,163,899,852,147 token base units. A 1 ETH buy and 1 CBRK sell produced decoded `Tripped` errors.
- The network's listed Universal Router had code, but it was not substituted for PoolSwapTest or used to swap. PoolSwapTest code could not be checked because no approved address was supplied.

These are historical observations, not guarantees of current liquidity or execution. Pre-check results are block-specific. No real wallet extension, funded approval, signed swap, receipt/reorg recovery on a live submitted transaction or third-party hosting gateway was tested.

## Better Interface consolidated review

The pinned guide was applied during construction and reviewed across all six domains. Source coverage supplements rendered checks; it does not establish them on its own.

| Domain | Coverage and result | Limitations |
| --- | --- | --- |
| Accessibility | **Checked:** native buttons/links/forms/disclosure, one main/h1, skip link, labels, field-specific errors, live regions, wrong-chain status, keyboard path, computed focus, hit sizes, axe and reduced motion | No screen reader, physical device or full keyboard traversal of every external link; forced-colors rendering not visually tested |
| Layout | **Checked:** shared alignment, monitor-before-form DOM order, responsive panel stacking, disclosure, long IDs, four widths and text enlargement; screenshots inspected | Browser-native zoom, RTL and pseudolocalization not tested; English-only product |
| Writing | **Checked:** action names, units/direction, recoverable errors, no fictitious tripped-event history, no guarantee of settlement, explicit routing limitation and price-limit/quote distinction | No user comprehension study |
| Typography | **Checked:** descending hierarchy, line-height/measure, tabular numbers, wrapping, selectable full hashes, mobile input ≥16 px; rendered desktop/mobile review | System fonts vary; no local custom font is supplied; no claim that Inter loaded |
| Colors | **Checked:** semantic hex tokens, distinct action/status roles, redundant text/symbols; rendered contrast measured in browser result JSON | Only one light theme exists; unmeasured combinations are not claimed |
| UI | **Checked:** selected/hover/disabled/loading/error/empty/pass/expired states, flat surfaces, 120 ms named-property motion, reduced-motion behavior | No modal or staged animation exists, so focus trapping and animation-panel slow replay are not applicable |

Measured rendered pairs: muted/page **5.16:1**, primary text/surface **14.39:1**, primary button **9.32:1**, success label **6.82:1**, muted/surface **5.63:1**. The raw RGB values are retained in `browser-check.json`.

## Findings, fixes and rechecks

| Severity / domain | Source location | Evidence, impact and correction |
| --- | --- | --- |
| High / workflow | `web/src/config.ts:65`, `web/src/App.tsx:767` | Missing PoolSwapTest conflicts with the unchanged network rule. A substituted address would misrepresent the handoff. Kept signing disabled with an explicit explanation; production-manifest browser test confirms zero wallet sends. **Unresolved input limitation.** |
| Medium / state and UI | `web/src/App.tsx:112` | Browser wrong-chain test timed out after add/switch: an in-flight read could be discarded and a later same-chain update cleared the snapshot without another fetch. Added queued refreshes and explicit post-connect/switch refresh; the scenario now passes. |
| Medium / writing and state | `web/src/App.tsx:281` | Live manual click could simulate an older displayed block then immediately expire. Fetch the latest consistent snapshot before simulation; dedicated browser scenario passes. A block can still change during any RPC call, in which case retry remains necessary. |
| Medium / accessibility | `web/src/App.tsx:659`, `web/src/App.tsx:691` | Initial shared validation would label/focus the amount when tolerance was invalid. Split field identity, associated messages and focus targets; invalid-tolerance browser scenario passes. |
| Medium / UI status | `web/src/App.tsx:718` | Expired passing checks retained the success surface. Switch the result to neutral styling when freshness fails; new-block browser test confirms expired state and disabled signing. |
| Medium / writing | `web/src/App.tsx:693` | Uncapped quoter output could be mistaken for guaranteed router output. Explain that the pre-check tests full input without the price limit and execution can partially fill. Source and rendered final copy reviewed. |
| Low / resilience | `web/src/config.ts:157` | Reconnecting could repeatedly choose a responsive endpoint whose contract reads failed. Deprioritize the failed endpoint on the next refresh while retaining chain checks and wallet fallback. Reviewed and exercised by RPC/code-error recovery. |

No rendered clipping or measured contrast failure remained in the tested states. The missing routing input remains a required-behavior blocker, so the delivery is not labelled fully complete. Publication checks, if later run, must not be treated as browser or live-swap evidence.
