# Breaker frontend

A single-page Vite / React / TypeScript interface for the deployed Sepolia native-ETH / CBRK pool. The static production export is `../dist/`; no server, external fonts, private keys or RPC credentials are required. Source contracts and root build configuration are unchanged.

## Current delivery limitation

**Live swaps are blocked by contradictory routing inputs.** The approved workflow requires PoolSwapTest. The supplied immutable `network.uniswapV4` lists Universal Router, Quoter, StateView and other infrastructure but **does not list PoolSwapTest**. The task also requires preserving that network object and using only its addresses. The delivered app therefore provides live reads, wallet connection and real quoter simulations, and visibly disables approvals and swaps. It neither substitutes Universal Router nor inserts an unapproved address.

The PoolSwapTest adapter and transaction UI are implemented and tested using isolated browser fixtures. An updated approved network handoff containing `uniswapV4.poolSwapTest`, or explicit authorization to implement the listed Universal Router instead, is required to finish live routing. Mocked router transactions are not evidence of a live PoolSwapTest deployment or successful swap.

The root `DESIGN.md` request conflicts with the stronger write scope. The implemented design is documented in `../docs/DESIGN.md`.

## Install, build, preview

Use Node 24 and npm 11 (the worker used Node 24.21.0 and npm 11.19.0). From `web/`:

```sh
npm ci
npm run typecheck
npm run build
npm run preview
```

On this restricted worker, keep package caches in disposable scratch:

```sh
npm ci --cache ../test/scratch/npm
```

Vite uses `base: './'` and exports one `index.html`. Serve `dist/` over HTTP, including under a gateway subpath; opening it directly via `file://` is not supported by browser module/fetch rules. `npm run dev` supports source UI development, but the deployment manifest/ABIs are generated into `dist/`: use the production preview for full integration checks.

Build performs TypeScript checking, Vite bundling, pinned ABI export, deployment-manifest generation and final-byte verification. It removes the old export first. Do not edit export files manually; rebuild after source changes. There is a nonfatal Vite warning for the ~515 KB main JavaScript chunk; the entire export is below 0.6 MB uncompressed.

## Configuration and provenance

- `config/deployment.json` and `config/network.json` preserve the supplied handoffs as build inputs. Their contents are checked against `.imd/reads/` when those inputs exist.
- `scripts/export.mjs` uses `git show <sourceCommit>:docs/abi/<Contract>.json`, verifies each raw ABI array with canonical Keccak-256, checks the working ABI export is byte-identical to the pinned commit, and exports it. Canonicalization recursively sorts object keys and preserves array order. Hashes omit `0x`.
- **`dist/imd-deployment.json` is the sole runtime deployment configuration.** `src/config.ts` fetches it and its referenced ABI files, verifies ABI hashes, and derives contract addresses and chain details from it. There is no parallel runtime address map.
- `vite.config.ts` injects only pool parameters, role names and deployment block derived from the deployment handoff. It does not embed token/hook/Uniswap addresses or RPC URLs. The runtime pool ID is derived from the sorted currencies and pool key.
- All Uniswap integration ABI fragments live together in `src/config.ts`. StateView and Quoter addresses come from the manifest's unchanged network object; any future PoolSwapTest address must come from the same object. The optional adapter never reads an address from query parameters or local storage.
- The final manifest contains exactly the accepted top-level keys, unchanged network and wallet-add-chain parameters, the exact deployed contract set and an SHA-256 inventory of **every** other exported file. `verify:export` checks the inventory, relative paths, hashes, ABI bindings, chain consistency and size limits.

The pinned source commit must be present in Git to rebuild ABIs. After the assignment's transient reads disappear, the preserved build inputs still allow rebuilding. No contract compilation or redeployment is performed.

## Reads and pre-check

Public RPCs are tried in configured order, with the injected wallet as a final read fallback on the correct chain. A failed read endpoint is deprioritized on refresh. The client verifies chain ID, nonempty deployed token/hook/StateView/Quoter/PoolManager code and the hook's PoolManager binding. When an approved PoolSwapTest is present, its code and `manager()` binding are checked too.

The monitor polls every 12 seconds and reads StateView slot0/liquidity, `currentBand`, `refBlock`, token metadata/supply, balances and allowance at one block number. It requests the latest 200 blocks of `ReferenceSet` logs, showing at most five. If no swap has succeeded in the sampled block, the hook's `currentBand` supplies the current pool price as reference. Event RPC failure is disclosed independently of successful view reads. No reverted-swap history is invented.

Prices are shown as **CBRK per ETH**, matching `sqrtPriceX96²`; the reciprocal ETH-per-CBRK band is not incorrectly labelled ±10%. Token decimals come from the deployed token. Display numbers use seven significant digits; transaction amounts stay exact BigInts. Bounds come directly from the hook's inward-rounded view. Display rounding can make the outer values look exactly ±10%.

`Run pre-check` refreshes a snapshot, then uses `simulateContract` / `eth_call` against the configured Quoter's `quoteExactInputSingle`. It runs the actual hook callbacks and recursively decodes `UnexpectedRevertBytes` / `WrappedError` to distinguish `Tripped`, `PhantomSwap`, and unknown/provider failures. This checks the full typed input without a router price limit or wallet funding requirements. **It is not a simulation of the final wallet settlement.** If routing becomes available, the exact router call is additionally simulated before requesting a signature.

A successful check expires after 20 seconds or a block/hash/account/network/form change; state older than 30 seconds disables checks. Inclusion in a later block or competition for the same block can change results. The UI refreshes before a check to avoid needlessly simulating an old displayed block.

## Wallet and transaction behavior

The interface uses a standard injected EIP-1193 browser wallet (`window.ethereum`), handles rejection, account/network changes and disconnect, and shows the connected address in deployment details. No WalletConnect project ID was supplied; WalletConnect/QR connectors are not included. To add one later, provide a public project ID through a reviewed centralized configuration change.

Wrong-chain wallets get one switch control. Error 4902 / unknown chain triggers `wallet_addEthereumChain` with the unchanged handoff parameters, followed by another switch.

The optional PoolSwapTest path uses negative `amountSpecified` for exact input; buy sets `zeroForOne=true` with native input as transaction value; sell uses `false` with zero native value. Both test settings are false and hook data is empty. Sell approval grants **only the entered CBRK amount to that approved router**; there is no Permit2 approval for this adapter. Native buys require no token approval.

Price tolerance (0.01–5%, default 0.5%) becomes an inward-rounded `sqrtPriceLimitX96` from the sampled spot price. PoolSwapTest has no `amountOutMinimum` or deadline argument: the UI does not claim otherwise. It may spend less than the input and return less than the uncapped quoter estimate. Before a signature, the app rechecks code/bindings, chain, account, balances, allowances, block freshness and the exact transaction with `eth_call`. A real wallet still controls signing and gas settings. No live transaction was broadcast during validation.

The hook has no admin actions. Its per-block band does not guarantee fair price: moving to an edge can block same-direction trades for that block, and dust liquidity can move references across blocks despite PhantomSwap protection. This inherited behavior is documented by the deployed source; this frontend does not change it.

## Validation

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
npm run check:live
npm run verify:export
node scripts/check-submission.mjs
```

If Chromium is already installed, set `BROWSER_EXECUTABLE=/absolute/path/to/chrome` for `test:browser`. Browser installation caches can be directed into scratch with `PLAYWRIGHT_BROWSERS_PATH=../test/scratch/playwright`. The browser test owns an ephemeral HTTP server at `/preview/` and closes it and the browser before returning. It uses real exported JS and JSON, mocked RPC/wallet responses for transactions, and a separate live read-only page. It writes evidence and screenshots to `docs/frontend/`.

`check:live` contacts the configured RPC endpoints, verifies chain/code/views, and makes real read-only buy/sell quote calls. It is deliberately separate from mocked tests. Evidence is in `../docs/VALIDATION.md`, `../docs/frontend/browser-check.json`, and `../docs/frontend/live-check.json`.

`check-submission.mjs` creates a temporary candidate Git commit and complete-tree bundle in `test/scratch/`, enforces allowed paths, rejects generated caches/archives/gitlinks and checks the actual bundle against 8 MiB. It includes the deployed source commit as a shallow history boundary because earlier ancestry is incomplete in the worker mirror. It never mutates the worker's read-only repository `.git`. The surrounding publisher must collect and commit the delivered working-tree files. Scratch, node_modules, caches and browser installations are not deliverables.

Integration references: [Uniswap IV4Quoter](https://raw.githubusercontent.com/Uniswap/v4-periphery/main/src/interfaces/IV4Quoter.sol), [QuoterRevert](https://raw.githubusercontent.com/Uniswap/v4-periphery/main/src/libraries/QuoterRevert.sol), and the repository's pinned `lib/v4-core/src/test/PoolSwapTest.sol` / `CustomRevert.sol`. Published addresses were not substituted for the supplied network handoff.
