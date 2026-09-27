import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createPublicClient, http, keccak256 } from "viem";
import handoff from "../config/deployment.json" with { type: "json" };
(globalThis as any).__POOL__ = {
  ...handoff.manifest.pool,
  tokenContract: handoff.manifest.token.contract,
  hookContract: handoff.manifest.hook.contract,
  deploymentBlock: Math.min(...handoff.contracts.map((c) => c.blockNumber)),
};
const { loadDeployment } = await import("../src/config");
const { readSnapshot, precheck, describeError } = await import("../src/chain");
const originalFetch = globalThis.fetch;
(globalThis as any).window = {
  location: { href: "http://validation.local/preview/" },
};
globalThis.fetch = (async (url: any, options: any) =>
  String(url).startsWith("http://validation.local/preview/")
    ? new Response(
        await readFile(
          new URL(
            "../../dist/" + String(url).split("/preview/")[1],
            import.meta.url,
          ),
        ),
      )
    : originalFetch(url, options)) as typeof fetch;
const d = await loadDeployment();
const evidence: any = {
  timestamp: new Date().toISOString(),
  sourceCommit: d.manifest.sourceCommit,
  rpcs: [],
  routingLimitation:
    "The supplied network has no PoolSwapTest. No router outside that network was used; no transactions were broadcast.",
};
for (const url of d.manifest.network.rpcUrls) {
  const c = createPublicClient({
    chain: d.chain,
    transport: http(url, { timeout: 10000, retryCount: 0 }),
  });
  try {
    const chainId = await c.getChainId();
    if (chainId !== d.manifest.chainId) throw Error("Chain mismatch");
    const s = await readSnapshot(d, c);
    const code = [];
    for (const contract of [
      ...d.manifest.contracts,
      { name: "StateView", address: d.manifest.network.uniswapV4.stateView },
      { name: "Quoter", address: d.manifest.network.uniswapV4.quoter },
      {
        name: "UniversalRouter (listed, not used)",
        address: d.manifest.network.uniswapV4.universalRouter,
      },
    ]) {
      const bytes = await c.getCode({
        address: contract.address,
        blockNumber: s.block,
      });
      if (!bytes || bytes === "0x") throw Error("Missing code");
      code.push({
        name: contract.name,
        address: contract.address,
        bytes: (bytes.length - 2) / 2,
        keccak256: keccak256(bytes),
      });
    }
    const checks = [];
    for (const [side, input] of [
      ["buy", 1000000000n],
      ["buy", 10n ** 18n],
      ["sell", 10n ** 18n],
    ] as const) {
      try {
        const q = await precheck(d, c, s, side, input, 50n);
        checks.push({
          side,
          input,
          result: "pass",
          output: q.output,
          block: q.block,
        });
      } catch (e) {
        checks.push({ side, input, ...describeError(e, d) });
      }
    }
    evidence.rpcs.push({ url, chainId, snapshot: s, code, checks });
  } catch (e) {
    evidence.rpcs.push({ url, error: describeError(e, d) });
  }
}
await mkdir(new URL("../../docs/frontend", import.meta.url), {
  recursive: true,
});
await writeFile(
  new URL("../../docs/frontend/live-check.json", import.meta.url),
  JSON.stringify(
    evidence,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ) + "\n",
);
console.log(
  JSON.stringify(
    evidence,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2,
  ),
);
if (!evidence.rpcs.some((r: any) => r.snapshot)) process.exitCode = 1;
