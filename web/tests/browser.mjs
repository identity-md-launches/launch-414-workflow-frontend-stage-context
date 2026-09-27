import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import {
  parseAbi,
  encodeFunctionResult,
  decodeFunctionData,
  encodeErrorResult,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  keccak256,
  toHex,
} from "viem";
const root = fileURLToPath(new URL("../../", import.meta.url));
const manifest = JSON.parse(
  await readFile(root + "dist/imd-deployment.json", "utf8"),
);
const hook = manifest.contracts.find((c) => c.name === "CircuitBreakerHook");
const token = manifest.contracts.find((c) => c.name === "CBRK");
const hookAbi = JSON.parse(
  await readFile(root + "dist/" + hook.abiPath, "utf8"),
);
const tokenAbi = JSON.parse(
  await readFile(root + "dist/" + token.abiPath, "utf8"),
);
const tuple =
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
const integration = parseAbi([
  "function getSlot0(bytes32) view returns (uint160,int24,uint24,uint24)",
  "function getLiquidity(bytes32) view returns(uint128)",
  `function quoteExactInputSingle((${tuple} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns(uint256,uint256)`,
  `function swap(${tuple},(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96),(bool takeClaims,bool settleUsingBurn),bytes) payable returns(int256)`,
  "function manager() view returns(address)",
  "error WrappedError(address target,bytes4 selector,bytes reason,bytes details)",
  "error UnexpectedRevertBytes(bytes revertData)",
]);
const abi = [...hookAbi, ...tokenAbi, ...integration];
const account = "0x2222222222222222222222222222222222222222",
  router = "0x1111111111111111111111111111111111111111";
const hash = "0x" + "ab".repeat(32),
  txHash = "0x" + "cd".repeat(32),
  sqrt = 158570052814919122920977766972888n;
const mime = {
  html: "text/html",
  js: "text/javascript",
  css: "text/css",
  json: "application/json",
  svg: "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith("/preview/") || path.includes(".."))
      throw Error("Path");
    const file = path.slice(9) || "index.html";
    const bytes = await readFile(root + "dist/" + file);
    res.writeHead(200, {
      "Content-Type":
        mime[file.split(".").at(-1)] || "application/octet-stream",
    });
    res.end(bytes);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.BROWSER_EXECUTABLE,
  args: ["--no-sandbox"],
});
const evidence = {
  timestamp: new Date().toISOString(),
  url,
  checks: [],
  screenshots: [],
  consoleErrors: [],
  failedResources: [],
  axe: [],
  contrast: [],
};
await mkdir(root + "docs/frontend", { recursive: true });
async function run(name, fn) {
  await fn();
  evidence.checks.push({ name, result: "passed" });
  console.log("PASS", name);
}
async function pageWithMocks(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  const state = {
    block: 11795000n,
    quote: "pass",
    swapFails: false,
    allowance: 0n,
    code: "0x60006000",
    events: true,
    fail: false,
    router: !!options.router,
    references: false,
  };
  page.on("pageerror", (e) => evidence.consoleErrors.push(e.message));
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400) evidence.failedResources.push(response.url());
  });
  page.on("requestfailed", (r) => evidence.failedResources.push(r.url()));
  if (options.wallet)
    await context.addInitScript(
      ({ account, chain }) => {
        const callbacks = {};
        window.walletTest = {
          chain,
          accounts: [account],
          calls: [],
          reject: false,
          missingChain: true,
          emit: (event, value) => {
            for (const fn of callbacks[event] || []) fn(value);
          },
        };
        window.ethereum = {
          on: (event, fn) => (callbacks[event] ??= []).push(fn),
          removeListener: (event, fn) => {
            callbacks[event] = (callbacks[event] || []).filter((f) => f !== fn);
          },
          request: async (req) => {
            const s = window.walletTest;
            s.calls.push(req);
            if (
              s.reject &&
              ["eth_requestAccounts", "eth_sendTransaction"].includes(
                req.method,
              )
            )
              throw { code: 4001, message: "User rejected request" };
            switch (req.method) {
              case "eth_requestAccounts":
              case "eth_accounts":
                return s.accounts;
              case "eth_chainId":
                return s.chain;
              case "wallet_switchEthereumChain":
                if (s.missingChain) throw { code: 4902 };
                s.chain = req.params[0].chainId;
                s.emit("chainChanged", s.chain);
                return null;
              case "wallet_addEthereumChain":
                s.missingChain = false;
                return null;
              case "eth_sendTransaction":
                return "0x" + "cd".repeat(32);
              default:
                throw Error(req.method);
            }
          },
        };
      },
      { account, chain: options.chain || "0xaa36a7" },
    );
  if (options.router)
    await page.route("**/imd-deployment.json", (route) =>
      route.fulfill({
        json: {
          ...manifest,
          network: {
            ...manifest.network,
            uniswapV4: { ...manifest.network.uniswapV4, poolSwapTest: router },
          },
        },
      }),
    );
  for (const endpoint of manifest.network.rpcUrls)
    await page.route(endpoint, async (route) => {
      const request = route.request().postDataJSON();
      const handle = async (req) => {
        let result;
        const method = req.method;
        const params = req.params;
        if (state.fail)
          return {
            id: req.id,
            jsonrpc: "2.0",
            error: { code: -32000, message: "Mock RPC offline" },
          };
        const block = {
          number: toHex(state.block),
          hash,
          parentHash: hash,
          nonce: "0x0000000000000000",
          sha3Uncles: hash,
          logsBloom: "0x" + "00".repeat(256),
          transactionsRoot: hash,
          stateRoot: hash,
          receiptsRoot: hash,
          miner: account,
          difficulty: "0x0",
          totalDifficulty: "0x0",
          extraData: "0x",
          size: "0x100",
          gasLimit: "0x1c9c380",
          gasUsed: "0x100",
          timestamp: toHex(Math.floor(Date.now() / 1000)),
          transactions: [],
          uncles: [],
          baseFeePerGas: "0x1",
        };
        switch (method) {
          case "eth_chainId":
            result = toHex(manifest.chainId);
            break;
          case "eth_blockNumber":
            result = toHex(state.block);
            break;
          case "eth_getBlockByNumber":
          case "eth_getBlockByHash":
            result = block;
            break;
          case "eth_getCode":
            result = state.code;
            break;
          case "eth_getBalance":
            result = toHex(10n ** 19n);
            break;
          case "eth_getTransactionReceipt":
            result = {
              transactionHash: txHash,
              transactionIndex: "0x0",
              blockHash: hash,
              blockNumber: toHex(state.block),
              from: account,
              to: router,
              cumulativeGasUsed: "0x100",
              gasUsed: "0x100",
              contractAddress: null,
              logs: [],
              logsBloom: "0x" + "00".repeat(256),
              status: "0x1",
              effectiveGasPrice: "0x1",
              type: "0x2",
            };
            break;
          case "eth_getLogs": {
            if (!state.events)
              return {
                id: req.id,
                jsonrpc: "2.0",
                error: { code: -32005, message: "Log limit" },
              };
            result = state.references
              ? [
                  {
                    address: hook.address,
                    blockNumber: toHex(state.block),
                    blockHash: hash,
                    transactionHash: txHash,
                    transactionIndex: "0x0",
                    logIndex: "0x0",
                    removed: false,
                    topics: [
                      encodeEventTopics({
                        abi: hookAbi,
                        eventName: "ReferenceSet",
                      })[0],
                      params[0].topics[1],
                    ],
                    data: encodeAbiParameters(
                      parseAbiParameters("uint256,uint160"),
                      [state.block, sqrt],
                    ),
                  },
                ]
              : [];
            break;
          }
          case "eth_call": {
            const decoded = decodeFunctionData({ abi, data: params[0].data });
            const fn = decoded.functionName;
            let output;
            if (fn === "swap" && state.swapFails)
              return {
                id: req.id,
                jsonrpc: "2.0",
                error: {
                  code: 3,
                  message: "execution reverted",
                  data: encodeErrorResult({
                    abi: hookAbi,
                    errorName: "Tripped",
                    args: [sqrt, (sqrt * 12n) / 10n],
                  }),
                },
              };
            if (fn === "quoteExactInputSingle" && state.quote !== "pass") {
              if (state.quote === "rpc")
                return {
                  id: req.id,
                  jsonrpc: "2.0",
                  error: { code: -32000, message: "Provider unavailable" },
                };
              const reason = encodeErrorResult({
                abi: hookAbi,
                errorName: state.quote === "trip" ? "Tripped" : "PhantomSwap",
                args: [sqrt, (sqrt * 12n) / 10n],
              });
              const wrapped = encodeErrorResult({
                abi: integration,
                errorName: "WrappedError",
                args: [hook.address, "0x00000000", reason, "0x"],
              });
              return {
                id: req.id,
                jsonrpc: "2.0",
                error: {
                  code: 3,
                  message: "execution reverted",
                  data: encodeErrorResult({
                    abi: integration,
                    errorName: "UnexpectedRevertBytes",
                    args: [wrapped],
                  }),
                },
              };
            }
            switch (fn) {
              case "getSlot0":
                output = [sqrt, 152040, 0, 3000];
                break;
              case "getLiquidity":
                output = 10n ** 20n;
                break;
              case "currentBand":
                output = [
                  sqrt,
                  (sqrt * 948683298n) / 1000000000n,
                  (sqrt * 1048808848n) / 1000000000n,
                  state.references,
                ];
                break;
              case "refBlock":
                output = state.references ? state.block : state.block - 1n;
                break;
              case "POOL_MANAGER":
              case "manager":
                output = manifest.network.uniswapV4.poolManager;
                break;
              case "decimals":
                output = 18;
                break;
              case "symbol":
                output = "CBRK";
                break;
              case "totalSupply":
                output = 10n ** 27n;
                break;
              case "balanceOf":
                output = 10n ** 24n;
                break;
              case "allowance":
                output = state.allowance;
                break;
              case "quoteExactInputSingle":
                output = [
                  decoded.args[0].zeroForOne ? 10n ** 21n : 10n ** 14n,
                  100000n,
                ];
                break;
              case "approve":
                output = true;
                break;
              case "swap":
                output = 1n;
                break;
              default:
                throw Error("Unhandled call: " + fn);
            }
            result = encodeFunctionResult({
              abi,
              functionName: fn,
              result: output,
            });
            break;
          }
          default:
            throw Error("Unhandled method: " + method);
        }
        return { jsonrpc: "2.0", id: req.id, result };
      };
      const response = Array.isArray(request)
        ? await Promise.all(request.map(handle))
        : await handle(request);
      await route.fulfill({ json: response });
    });
  await page.goto(url);
  await page.getByText("Live state", { exact: true }).waitFor();
  return { page, state, context };
}
const wait = async (page, text) =>
  page.getByText(text, { exact: text === "Inside the band" || text === "Live state" }).first().waitFor({ timeout: 12000 });
try {
  const { page, state, context } = await pageWithMocks();
  await run(
    "production subpath loads all assets and verified runtime ABIs",
    async () => {
      assert.equal(await page.locator("h1").count(), 1);
      assert(await page.getByText("Swap routing unavailable.").isVisible());
    },
  );
  await run("no-wallet recovery and field validation", async () => {
    await page
      .getByRole("button", { name: "Connect wallet", exact: false })
      .first()
      .click();
    await wait(page, "No browser wallet found");
    await page.getByRole("button", { name: "Run pre-check" }).click();
    await wait(page, "Enter a positive amount");
    assert.equal(
      await page.locator("#swap-amount").getAttribute("aria-invalid"),
      "true",
    );
  });
  await run(
    "invalid price tolerance focuses and labels the correct field",
    async () => {
      await page.getByLabel("You pay").fill("0.0001");
      await page.getByLabel("Price tolerance").fill("6");
      await page.getByRole("button", { name: "Run pre-check" }).click();
      await wait(page, "Use a price tolerance between");
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        "slippage",
      );
      assert.equal(
        await page.locator("#slippage").getAttribute("aria-invalid"),
        "true",
      );
      await page.getByLabel("Price tolerance").fill("0.5");
    },
  );
  await run(
    "pre-check refreshes the latest block before simulation",
    async () => {
      state.block++;
      await page.getByRole("button", { name: "Run pre-check" }).click();
      await wait(page, "Inside the band");
      await wait(page, `Simulated at block ${state.block}`);
    },
  );
  await run(
    "typed buy simulation passes, never sends a transaction",
    async () => {
      await page.getByLabel("You pay").fill("0.0001");
      await page.getByRole("button", { name: "Run pre-check" }).click();
      await wait(page, "Inside the band");
      assert(await page.getByText("1,000 CBRK", { exact: true }).isVisible());
    },
  );
  await run("changing amount invalidates the successful check", async () => {
    await page.getByLabel("You pay").fill("1");
    await wait(page, "Swap changed. Run the pre-check again.");
  });
  await run(
    "nested Tripped and PhantomSwap errors differ from RPC failure",
    async () => {
      for (const [kind, text] of [
        ["trip", "Would trip the circuit breaker"],
        ["phantom", "No tokens would be exchanged"],
        ["rpc", "does not confirm a circuit trip"],
      ]) {
        state.quote = kind;
        await page.getByRole("button", { name: "Run pre-check" }).click();
        await wait(page, text);
      }
      state.quote = "pass";
    },
  );
  await run(
    "current-block ReferenceSet and log failure keep view reads clear",
    async () => {
      state.references = true;
      await page.getByRole("button", { name: "Refresh ↻" }).click();
      await wait(page, "ReferenceSet captured");
      assert((await page.locator(".event-row").count()) === 2);
      state.events = false;
      await page.getByRole("button", { name: "Refresh ↻" }).click();
      await wait(page, "Reference events are unavailable");
      state.events = true;
    },
  );
  await run("missing deployed code disables pre-checks", async () => {
    state.code = "0x";
    await page.getByRole("button", { name: "Refresh ↻" }).click();
    await wait(page, "Contract code is missing");
    assert(
      await page.getByRole("button", { name: "Run pre-check" }).isDisabled(),
    );
    state.code = "0x60006000";
    await page.getByRole("button", { name: "Refresh ↻" }).click();
    await wait(page, "Live state");
  });
  await run(
    "keyboard reaches input and triggers pre-check; focus ring is present",
    async () => {
      await page.getByLabel("You pay").focus();
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.type("0.0001");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      assert.match(
        await page.evaluate(() => document.activeElement.textContent),
        /Run pre-check/,
      );
      assert.equal(
        await page.evaluate(
          () => getComputedStyle(document.activeElement).outlineWidth,
        ),
        "3px",
      );
      await page.keyboard.press("Enter");
      await wait(page, "Inside the band");
    },
  );
  await page.locator(".intro").scrollIntoViewIfNeeded();
  for (const width of [1440, 820, 390, 320]) {
    await run(`responsive reflow at ${width}px`, async () => {
      await page.setViewportSize({ width, height: 1000 });
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      );
    });
    const path = `docs/frontend/mock-${width}.png`;
    await page.screenshot({ path: root + path, fullPage: true });
    evidence.screenshots.push({ path, kind: "mocked chain", width });
    const scan = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    evidence.axe.push({
      width,
      violations: scan.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    });
    assert.equal(
      scan.violations.length,
      0,
      JSON.stringify(evidence.axe.at(-1)),
    );
  }
  await run("200% text enlargement reflows at 820px", async () => {
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.evaluate(
      () => (document.documentElement.style.fontSize = "200%"),
    );
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
  });
  await run("reduced motion disables button transitions", async () => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await page
        .locator(".primary")
        .evaluate((el) => getComputedStyle(el).transitionDuration),
      "0s",
    );
  });
  evidence.contrast = await page.evaluate(() => {
    const linear = (x) => {
      x /= 255;
      return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    const l = (c) => {
      const v = c
        .match(/[\d.]+/g)
        .slice(0, 3)
        .map(Number)
        .map(linear);
      return v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
    };
    return [
      ".intro-copy",
      ".spot-price",
      ".primary",
      ".result-label",
      ".route-notice",
      ".reference-note",
    ].map((selector) => {
      const el = document.querySelector(selector);
      const fg = getComputedStyle(el).color;
      let cur = el,
        bg;
      while (cur) {
        bg = getComputedStyle(cur).backgroundColor;
        if (bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") break;
        cur = cur.parentElement;
      }
      return {
        selector,
        foreground: fg,
        background: bg,
        ratio:
          (Math.max(l(fg), l(bg)) + 0.05) / (Math.min(l(fg), l(bg)) + 0.05),
      };
    });
  });
  await context.close();
  const wallet = await pageWithMocks({ wallet: true, chain: "0x1" });
  const w = wallet.page;
  await run("wallet connection, unknown-chain add and switch", async () => {
    await w
      .getByRole("button", { name: "Connect wallet", exact: false })
      .first()
      .click();
    await wait(w, "Wallet is on a different network");
    await w.getByRole("button", { name: "Switch to Sepolia" }).click();
    await wait(w, "Live state");
    assert.equal(
      await w.getByRole("button", { name: "Switch to Sepolia" }).count(),
      0,
    );
    const methods = await w.evaluate(() =>
      window.walletTest.calls.map((c) => c.method),
    );
    assert(methods.includes("wallet_addEthereumChain"));
  });
  await run(
    "supplied manifest blocks signing even after passing check",
    async () => {
      await w.getByLabel("You pay").fill("0.0001");
      await w.getByRole("button", { name: "Run pre-check" }).click();
      await wait(w, "Inside the band");
      assert(
        await w
          .getByRole("button", { name: "Buy CBRK in wallet" })
          .isDisabled(),
      );
      assert.equal(
        await w.evaluate(
          () =>
            window.walletTest.calls.filter(
              (c) => c.method === "eth_sendTransaction",
            ).length,
        ),
        0,
      );
    },
  );
  await run("account change clears quote and refreshes balances", async () => {
    await w.evaluate(() => {
      window.walletTest.accounts = [
        "0x3333333333333333333333333333333333333333",
      ];
      window.walletTest.emit("accountsChanged", window.walletTest.accounts);
    });
    await wait(w, "Wallet changed. Run the pre-check again.");
    await wait(w, "Live state");
  });
  await wallet.context.close();
  const trading = await pageWithMocks({ wallet: true, router: true });
  const t = trading.page;
  await t
    .getByRole("button", { name: "Connect wallet", exact: false })
    .first()
    .click();
  await wait(t, "Live state");
  await run(
    "mock-only approved-router buy simulates and confirms transaction",
    async () => {
      await t.getByLabel("You pay").fill("0.0001");
      await t.getByRole("button", { name: "Run pre-check" }).click();
      await wait(t, "Inside the band");
      await t.getByRole("button", { name: "Buy CBRK in wallet" }).click();
      await wait(t, "Swap confirmed.");
      const tx = await t.evaluate(
        () =>
          window.walletTest.calls.find(
            (c) => c.method === "eth_sendTransaction",
          ).params[0],
      );
      assert.equal(tx.to, router);
      assert.equal(BigInt(tx.value), 100000000000000n);
      assert.equal(
        decodeFunctionData({ abi: integration, data: tx.data }).functionName,
        "swap",
      );
    },
  );
  await run(
    "mock sell approval grants only input amount to approved router",
    async () => {
      await t.getByRole("button", { name: "Sell CBRK", exact: true }).click();
      await t.getByLabel("You pay").fill("100");
      await t.getByRole("button", { name: "1. Approve 100 CBRK" }).click();
      await wait(t, "Token approval confirmed");
      const tx = await t.evaluate(
        () =>
          window.walletTest.calls
            .filter((c) => c.method === "eth_sendTransaction")
            .at(-1).params[0],
      );
      const decoded = decodeFunctionData({ abi: tokenAbi, data: tx.data });
      assert.equal(tx.to, token.address);
      assert.equal(decoded.functionName, "approve");
      assert.equal(decoded.args[0].toLowerCase(), router);
      assert.equal(decoded.args[1], 100n * 10n ** 18n);
      trading.state.allowance = 100n * 10n ** 18n;
      await t.getByRole("button", { name: "Refresh ↻" }).click();
      await wait(t, "1. Token approval ready");
    },
  );
  await run("mock sell and wallet rejection remain recoverable", async () => {
    await t.getByRole("button", { name: "Run pre-check" }).click();
    await wait(t, "Inside the band");
    await t.evaluate(() => (window.walletTest.reject = true));
    await t.getByRole("button", { name: "2. Sell CBRK in wallet" }).click();
    await wait(t, "Request declined");
    await t.evaluate(() => (window.walletTest.reject = false));
    await t.getByRole("button", { name: "Run pre-check" }).click();
    await wait(t, "Inside the band");
    await t.getByRole("button", { name: "2. Sell CBRK in wallet" }).click();
    await wait(t, "Swap confirmed.");
    const tx = await t.evaluate(
      () =>
        window.walletTest.calls
          .filter((c) => c.method === "eth_sendTransaction")
          .at(-1).params[0],
    );
    assert.equal(tx.value, "0x0");
    assert.equal(
      decodeFunctionData({ abi: integration, data: tx.data }).args[1]
        .zeroForOne,
      false,
    );
  });
  await run(
    "execution simulation failure prevents wallet broadcast",
    async () => {
      await t.getByRole("button", { name: "Run pre-check" }).click();
      await wait(t, "Inside the band");
      const before = await t.evaluate(
        () =>
          window.walletTest.calls.filter(
            (c) => c.method === "eth_sendTransaction",
          ).length,
      );
      trading.state.swapFails = true;
      await t.getByRole("button", { name: "2. Sell CBRK in wallet" }).click();
      await wait(t, "Would trip the circuit breaker");
      assert.equal(
        await t.evaluate(
          () =>
            window.walletTest.calls.filter(
              (c) => c.method === "eth_sendTransaction",
            ).length,
        ),
        before,
      );
      trading.state.swapFails = false;
    },
  );
  await run("a new block invalidates a previous quote", async () => {
    await t.getByRole("button", { name: "Run pre-check" }).click();
    await wait(t, "Inside the band");
    trading.state.block++;
    await t.getByRole("button", { name: "Refresh ↻" }).click();
    await wait(t, "Check expired");
    assert(
      await t
        .getByRole("button", { name: "2. Sell CBRK in wallet" })
        .isDisabled(),
    );
  });
  await trading.context.close();
  // Actual RPC, no wallet injection: reads only, no signed or broadcast transactions.
  const live = await browser.newPage({
    viewport: { width: 1440, height: 1100 },
  });
  live.on("pageerror", (e) => evidence.consoleErrors.push(e.message));
  live.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  live.on("requestfailed", (request) =>
    evidence.failedResources.push(request.url()),
  );
  await live.goto(url);
  await live
    .getByText("Live state", { exact: true })
    .waitFor({ timeout: 45000 });
  await run("live production export reads Sepolia without wallet", async () => {
    assert(
      await live.getByRole("button", { name: "Run pre-check" }).isEnabled(),
    );
  });
  for (const width of [1440, 390]) {
    await live.setViewportSize({ width, height: 1000 });
    assert(
      await live.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    const path = `docs/frontend/live-${width}.png`;
    await live.screenshot({ path: root + path, fullPage: true });
    evidence.screenshots.push({ path, kind: "live Sepolia", width });
  }
  await live.close();
  assert.equal(evidence.consoleErrors.length, 0);
  assert.equal(evidence.failedResources.length, 0);
  evidence.result = "passed";
} catch (e) {
  evidence.result = "failed";
  evidence.failure = e.stack;
  evidence.failurePages = await Promise.all(
    browser
      .contexts()
      .flatMap((c) => c.pages())
      .map((p) =>
        p
          .locator("body")
          .innerText()
          .catch(() => ""),
      ),
  );
  throw e;
} finally {
  await writeFile(
    root + "docs/frontend/browser-check.json",
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
