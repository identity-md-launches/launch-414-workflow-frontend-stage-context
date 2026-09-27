import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodeErrorResult, decodeFunctionData } from "viem";
import h from "../config/deployment.json" with { type: "json" };
(globalThis as any).__POOL__ = {
  ...h.manifest.pool,
  tokenContract: h.manifest.token.contract,
  hookContract: h.manifest.hook.contract,
  deploymentBlock: h.contracts[0].blockNumber,
};
const cfg = await import("../src/config");
const f = await import("../src/chain");
(globalThis as any).window = { location: { href: "http://test/preview/" } };
globalThis.fetch = (async (url: any) =>
  new Response(
    await readFile(
      new URL(
        "../../dist/" + String(url).split("/preview/")[1],
        import.meta.url,
      ),
    ),
  )) as typeof fetch;
const d = await cfg.loadDeployment();
test("runtime manifest binds the exact pinned ABI and pool identity", () => {
  assert.equal(d.token.address, h.contracts[0].address);
  assert.equal(d.hook.address, h.contracts[1].address);
  assert.equal(cfg.hashAbi(d.token.abi), h.contracts[0].abiHash);
  assert.equal(d.poolKey.currency0, h.manifest.pool.pairedCurrency);
  assert.equal(d.poolKey.fee, 3000);
  assert.equal(d.poolKey.tickSpacing, 60);
});
test("rejects asset traversal and non-relative paths", () => {
  for (const p of [
    "../a",
    "/abi/a.json",
    "https://evil.test/a",
    "abi//a",
    "abi/./a",
    "abi/%2e%2e/a",
  ])
    assert.equal(cfg.safePath(p), false);
  assert.equal(cfg.safePath("abi/CBRK.json"), true);
});
test("decimal parsing never silently rounds excess precision or accepts exponent/negative/zero", () => {
  assert.equal(f.amountIn("0.000000000000000001", 18), 1n);
  for (const v of ["1e4", "-1", "0", "0.0000000000000000001", "Infinity", "1."])
    assert.throws(() => f.amountIn(v, 18));
  assert.throws(() => f.amountIn((2n ** 128n).toString(), 0));
  assert.equal(f.slippageBps("0.5"), 50n);
  for (const v of ["0", "5.01", "-2", "1e2"])
    assert.throws(() => f.slippageBps(v));
});
test("price bounds stay inward; BigInt math works at large sqrt values", () => {
  const s = 2n ** 159n;
  const low = f.priceLimit(s, "buy", 50n),
    high = f.priceLimit(s, "sell", 50n);
  assert(low < s && high > s);
  assert(low * low * 10000n >= s * s * 9950n);
  assert(high * high * 10000n <= s * s * 10050n);
  assert.equal(f.price(2n ** 96n, 18), 1);
});
test("unwraps Quoter/PoolManager Tripped and PhantomSwap while preserving unknown errors", () => {
  for (const [name, kind] of [
    ["Tripped", "trip"],
    ["PhantomSwap", "phantom"],
  ] as const) {
    const reason = encodeErrorResult({
      abi: d.hook.abi,
      errorName: name,
      args: [100n, 120n],
    });
    const wrapped = encodeErrorResult({
      abi: cfg.integrationAbi,
      errorName: "WrappedError",
      args: [d.hook.address, "0x00000000", reason, "0x"],
    });
    const data = encodeErrorResult({
      abi: cfg.integrationAbi,
      errorName: "UnexpectedRevertBytes",
      args: [wrapped],
    });
    assert.equal(f.describeError({ cause: { cause: { data } } }, d).kind, kind);
  }
  assert.equal(f.describeError({ data: "0xdeadbeef" }, d).kind, "error");
  assert.match(f.describeError({ code: 4001 }, d).message, /declined/);
});
test("missing-chain switch adds exact handoff parameters and switches again", async () => {
  const calls: any[] = [];
  const provider = {
    request: async (args: any) => {
      calls.push(args);
      if (calls.length === 1) throw { code: 4902 };
    },
  };
  await cfg.switchNetwork(provider as any, d);
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(calls[1].params, [d.manifest.walletAddChain]);
  await assert.rejects(() =>
    cfg.switchNetwork(
      {
        request: async () => {
          throw { code: 4001 };
        },
      } as any,
      d,
    ),
  );
});
test("wallet mismatch, stale block, reorg and expired quote prevent submission", async () => {
  const account = d.token.address;
  await assert.rejects(() =>
    f.assertWallet(
      {
        request: async ({ method }: any) =>
          method === "eth_chainId" ? "0x1" : [account],
      } as any,
      d,
      account,
    ),
  );
  const q = { block: 10n, blockHash: "0x1234", createdAt: Date.now() } as any;
  await assert.rejects(() =>
    f.checkFresh(
      { getBlock: async () => ({ number: 11n, hash: q.blockHash }) } as any,
      q,
    ),
  );
  await assert.rejects(() =>
    f.checkFresh(
      { getBlock: async () => ({ number: 10n, hash: "0x5678" }) } as any,
      q,
    ),
  );
  await assert.rejects(() =>
    f.checkFresh(
      { getBlock: async () => ({ number: 10n, hash: q.blockHash }) } as any,
      { ...q, createdAt: 0 },
    ),
  );
});
test("PoolSwapTest adapter fails closed without approved router; request uses configured address", () => {
  const q = { side: "buy", input: 10n, limit: 20n } as any;
  assert.throws(() => f.swapRequest(d, q, d.token.address), /absent/);
  const fixture = { ...d, manifest: structuredClone(d.manifest) };
  fixture.manifest.network.uniswapV4.poolSwapTest =
    d.manifest.network.uniswapV4.universalRouter;
  const request = f.swapRequest(fixture, q, d.token.address);
  const decoded = decodeFunctionData({
    abi: cfg.integrationAbi,
    data: request.data,
  });
  assert.equal(request.to, fixture.manifest.network.uniswapV4.poolSwapTest);
  assert.equal(request.value, 10n);
  assert.equal(decoded.functionName, "swap");
  if (decoded.functionName === "swap") {
    assert.equal(decoded.args[1].amountSpecified, -10n);
    assert.equal(decoded.args[1].zeroForOne, true);
    assert.equal(decoded.args[2].takeClaims, false);
  }
});
