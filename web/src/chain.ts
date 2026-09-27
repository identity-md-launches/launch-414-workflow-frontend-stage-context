import {
  decodeErrorResult,
  encodeFunctionData,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  integrationAbi,
  poolSpec,
  type Deployment,
  type Rpc,
  type WalletProvider,
} from "./config";
export type Side = "buy" | "sell";
export type ReferenceEvent = { block: bigint; sqrt: bigint; hash: Hex };
export type Snapshot = {
  block: bigint;
  blockHash: Hex;
  timestamp: bigint;
  loadedAt: number;
  sqrt: bigint;
  tick: number;
  liquidity: bigint;
  reference: bigint;
  lower: bigint;
  upper: bigint;
  setThisBlock: boolean;
  refBlock: bigint;
  decimals: number;
  symbol: string;
  supply: bigint;
  eth: bigint;
  tokens: bigint;
  allowance: bigint;
  events: ReferenceEvent[];
  eventError: string;
  verified: boolean;
  routerReady: boolean;
};
export async function readSnapshot(
  d: Deployment,
  client: Rpc,
  account?: Address,
): Promise<Snapshot> {
  if ((await client.getChainId()) !== d.manifest.chainId)
    throw Error("RPC network changed. Refresh to reconnect.");
  const block = await client.getBlock({ blockTag: "latest" });
  const blockNumber = block.number;
  const readHook = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
      address: d.hook.address,
      abi: d.hook.abi,
      functionName,
      args,
      blockNumber,
    }) as Promise<any>;
  const readToken = (functionName: string, args: readonly unknown[] = []) =>
    client.readContract({
      address: d.token.address,
      abi: d.token.abi,
      functionName,
      args,
      blockNumber,
    }) as Promise<any>;
  const u = d.manifest.network.uniswapV4;
  const addresses = [
    ...d.manifest.contracts.map((c) => c.address),
    u.poolManager,
    u.stateView,
    u.quoter,
    ...(u.poolSwapTest ? [u.poolSwapTest] : []),
  ];
  const code = await Promise.all(
    addresses.map((address) => client.getCode({ address, blockNumber })),
  );
  if (code.some((c) => !c || c === "0x"))
    throw Error("Contract code is missing. Trading and checks are disabled.");
  const [
    slot,
    liquidity,
    band,
    refBlock,
    manager,
    decimals,
    symbol,
    supply,
    eth,
    tokens,
    allowance,
  ] = await Promise.all([
    client.readContract({
      address: u.stateView,
      abi: integrationAbi,
      functionName: "getSlot0",
      args: [d.poolId],
      blockNumber,
    }),
    client.readContract({
      address: u.stateView,
      abi: integrationAbi,
      functionName: "getLiquidity",
      args: [d.poolId],
      blockNumber,
    }),
    readHook("currentBand", [d.poolId]),
    readHook("refBlock", [d.poolId]),
    readHook("POOL_MANAGER"),
    readToken("decimals"),
    readToken("symbol"),
    readToken("totalSupply"),
    account ? client.getBalance({ address: account, blockNumber }) : 0n,
    account ? readToken("balanceOf", [account]) : 0n,
    account && u.poolSwapTest
      ? readToken("allowance", [account, u.poolSwapTest])
      : 0n,
  ]);
  if (manager.toLowerCase() !== u.poolManager.toLowerCase())
    throw Error("Hook PoolManager does not match the network handoff.");
  if (slot[0] === 0n)
    throw Error(
      "The pool is not initialized. Checks and trading are disabled.",
    );
  if (u.poolSwapTest) {
    const routerManager = await client.readContract({
      address: u.poolSwapTest,
      abi: integrationAbi,
      functionName: "manager",
      blockNumber,
    });
    if (routerManager.toLowerCase() !== u.poolManager.toLowerCase())
      throw Error("Router PoolManager does not match.");
  }
  let events: ReferenceEvent[] = [];
  let eventError = "";
  try {
    const floor = BigInt(poolSpec.deploymentBlock);
    const fromBlock = blockNumber - 199n > floor ? blockNumber - 199n : floor;
    const logs = await client.getContractEvents({
      address: d.hook.address,
      abi: d.hook.abi,
      eventName: "ReferenceSet",
      args: { poolId: d.poolId },
      fromBlock,
      toBlock: blockNumber,
      strict: true,
    });
    events = logs
      .map((log) => {
        const args = (
          log as unknown as {
            args: { blockNumber: bigint; sqrtPriceX96: bigint };
          }
        ).args;
        return {
          block: args.blockNumber,
          sqrt: args.sqrtPriceX96,
          hash: log.transactionHash,
        };
      })
      .reverse()
      .slice(0, 5);
  } catch {
    eventError =
      "Reference events are unavailable from this RPC. The reference below is read directly from the hook.";
  }
  return {
    block: blockNumber,
    blockHash: block.hash,
    timestamp: block.timestamp,
    loadedAt: Date.now(),
    sqrt: slot[0],
    tick: slot[1],
    liquidity,
    reference: band[0],
    lower: band[1],
    upper: band[2],
    setThisBlock: band[3],
    refBlock,
    decimals: Number(decimals),
    symbol,
    supply,
    eth,
    tokens,
    allowance,
    events,
    eventError,
    verified: true,
    routerReady: !!u.poolSwapTest,
  };
}
export function amountIn(text: string, decimals: number) {
  if (
    !/^\d+(\.\d+)?$/.test(text) ||
    (text.split(".")[1]?.length || 0) > decimals
  )
    throw Error(
      `Enter a positive amount with at most ${decimals} decimal places.`,
    );
  const value = parseUnits(text, decimals);
  if (value <= 0n || value > 2n ** 128n - 1n)
    throw Error("Enter an amount greater than zero and below the swap limit.");
  return value;
}
export function slippageBps(text: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw Error("Use a price tolerance between 0.01% and 5%.");
  const bps = parseUnits(text, 2);
  if (bps < 1n || bps > 500n)
    throw Error("Use a price tolerance between 0.01% and 5%.");
  return bps;
}
export function integerSqrt(n: bigint): bigint {
  if (n < 0n) throw Error("Negative square root");
  if (n < 2n) return n;
  let x = n,
    y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}
export function priceLimit(sqrt: bigint, side: Side, bps: bigint) {
  const n =
    (sqrt * sqrt * (side === "buy" ? 10000n - bps : 10000n + bps)) / 10000n;
  const root = integerSqrt(n);
  // Buying moves token-per-ETH down; round that lower limit inward.
  return side === "buy" && root * root < n ? root + 1n : root;
}
export const price = (sqrt: bigint, decimals: number, nativeDecimals = 18) =>
  (Number(sqrt) / 2 ** 96) ** 2 * 10 ** (nativeDecimals - decimals);
export const number = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumSignificantDigits: 7 }).format(n);
export const amount = (n: bigint, decimals: number) =>
  number(Number(formatUnits(n, decimals)));
export function describeError(
  error: unknown,
  d?: Deployment,
): { kind: "trip" | "phantom" | "error"; message: string } {
  const visited = new Set<unknown>();
  const decode = (
    data: Hex,
    depth = 0,
  ): { kind: "trip" | "phantom" | "error"; message: string } | undefined => {
    if (depth > 8) return;
    try {
      const result = decodeErrorResult({
        abi: [...(d?.hook.abi || []), ...integrationAbi],
        data,
      });
      const args = result.args as readonly any[] | undefined;
      if (result.errorName === "Tripped")
        return {
          kind: "trip",
          message:
            "Would trip the circuit breaker. This swap leaves the block’s ±10% price band. Reduce the amount and check again.",
        };
      if (result.errorName === "PhantomSwap")
        return {
          kind: "phantom",
          message:
            "No tokens would be exchanged. The hook blocks this move through empty liquidity. Try the other direction or check pool liquidity.",
        };
      if (result.errorName === "WrappedError" && args) {
        if (d && String(args[0]).toLowerCase() !== d.hook.address.toLowerCase())
          return;
        return decode(args[2], depth + 1);
      }
      if (
        (result.errorName === "UnexpectedRevertBytes" ||
          result.errorName === "ExecutionFailed") &&
        args
      )
        return decode(
          args[result.errorName === "ExecutionFailed" ? 1 : 0],
          depth + 1,
        );
    } catch {
      /* Unknown reverts must not be reported as a circuit trip. */
    }
  };
  const walk = (e: unknown, depth = 0): ReturnType<typeof decode> => {
    if (!e || visited.has(e) || depth > 10) return;
    visited.add(e);
    if (typeof e === "string" && /^0x[0-9a-f]+$/i.test(e))
      return decode(e as Hex);
    if (typeof e === "object")
      for (const key of ["data", "cause", "error", "originalError"]) {
        const r = walk((e as Record<string, unknown>)[key], depth + 1);
        if (r) return r;
      }
  };
  const found = walk(error);
  if (found) return found;
  const e = error as {
    code?: number;
    shortMessage?: string;
    message?: string;
    cause?: { code?: number };
  };
  if (
    e.code === 4001 ||
    e.cause?.code === 4001 ||
    /user rejected|user denied/i.test(e.message || "")
  )
    return {
      kind: "error",
      message:
        "Request declined in your wallet. Nothing was submitted. You can try again.",
    };
  const message = (e.shortMessage || e.message || "Request failed.")
    .split("\n")[0]
    .slice(0, 240);
  return {
    kind: "error",
    message: `${message} Check your connection, balance and approval, then retry. This does not confirm a circuit trip.`,
  };
}
export type Quote = {
  output: bigint;
  gas: bigint;
  block: bigint;
  blockHash: Hex;
  input: bigint;
  side: Side;
  bps: bigint;
  limit: bigint;
  createdAt: number;
};
export async function precheck(
  d: Deployment,
  c: Rpc,
  s: Snapshot,
  side: Side,
  input: bigint,
  bps: bigint,
): Promise<Quote> {
  const result = await c.simulateContract({
    address: d.manifest.network.uniswapV4.quoter,
    abi: integrationAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey: d.poolKey,
        zeroForOne: side === "buy",
        exactAmount: input,
        hookData: "0x",
      },
    ],
    blockNumber: s.block,
  });
  if (result.result[0] === 0n)
    throw Error(
      "The quote returns no output. Reduce the amount or try the other direction.",
    );
  return {
    output: result.result[0],
    gas: result.result[1],
    block: s.block,
    blockHash: s.blockHash,
    input,
    side,
    bps,
    limit: priceLimit(s.sqrt, side, bps),
    createdAt: Date.now(),
  };
}
export function swapRequest(d: Deployment, q: Quote, account: Address) {
  const router = d.manifest.network.uniswapV4.poolSwapTest;
  if (!router)
    throw Error(
      "PoolSwapTest is absent from the approved network configuration. Swaps are unavailable.",
    );
  return {
    to: router,
    from: account,
    value: q.side === "buy" ? q.input : 0n,
    data: encodeFunctionData({
      abi: integrationAbi,
      functionName: "swap",
      args: [
        d.poolKey,
        {
          zeroForOne: q.side === "buy",
          amountSpecified: -q.input,
          sqrtPriceLimitX96: q.limit,
        },
        { takeClaims: false, settleUsingBurn: false },
        "0x",
      ],
    }),
  };
}
export async function assertWallet(
  provider: WalletProvider,
  d: Deployment,
  account: Address,
) {
  const [chain, accounts] = await Promise.all([
    provider.request({ method: "eth_chainId" }),
    provider.request({ method: "eth_accounts" }),
  ]);
  if (Number(chain) !== d.manifest.chainId)
    throw Error(`Switch to ${d.manifest.network.name} before continuing.`);
  if (!accounts[0] || accounts[0].toLowerCase() !== account.toLowerCase())
    throw Error("Wallet account changed. Reconnect and check the swap again.");
}
export async function checkFresh(c: Rpc, q: Quote) {
  const block = await c.getBlock({ blockTag: "latest" });
  if (
    block.number !== q.block ||
    block.hash !== q.blockHash ||
    Date.now() - q.createdAt > 20000
  )
    throw Error(
      "The block changed or the check expired. Run the pre-check again.",
    );
}
