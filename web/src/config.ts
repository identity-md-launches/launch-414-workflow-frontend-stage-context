import {
  createPublicClient,
  custom,
  defineChain,
  encodeAbiParameters,
  http,
  isAddress,
  keccak256,
  parseAbi,
  parseAbiParameters,
  stringToHex,
  type Abi,
  type Address,
  type EIP1193Provider,
  type Hex,
  type Transport,
} from "viem";

declare const __POOL__: {
  fee: number;
  tickSpacing: number;
  pairedCurrency: Address;
  tokenContract: string;
  hookContract: string;
  deploymentBlock: number;
};
export const poolSpec = __POOL__;
export type WalletProvider = EIP1193Provider & {
  on?: (event: string, fn: (...args: any[]) => void) => void;
  removeListener?: (event: string, fn: (...args: any[]) => void) => void;
};
declare global {
  interface Window {
    ethereum?: WalletProvider;
  }
}
export type Manifest = {
  version: number;
  launchId: string;
  chainId: number;
  sourceCommit: string;
  attestationHash: string;
  contracts: {
    name: string;
    address: Address;
    abiHash: string;
    abiPath: string;
  }[];
  assets: { path: string; sha256: string }[];
  network: {
    chainId: number;
    name: string;
    testnet: boolean;
    rpcUrls: string[];
    explorer: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    faucets: string[];
    uniswapV4: {
      poolManager: Address;
      stateView: Address;
      quoter: Address;
      universalRouter: Address;
      permit2: Address;
      positionManager: Address;
      poolSwapTest?: Address;
    };
  };
  walletAddChain: {
    chainId: Hex;
    chainName: string;
    rpcUrls: string[];
    nativeCurrency: { name: string; symbol: string; decimals: number };
    blockExplorerUrls: string[];
  };
};
export const poolTuple =
  "(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
export const integrationAbi = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96,int24 tick,uint24 protocolFee,uint24 lpFee)",
  "function getLiquidity(bytes32 poolId) view returns (uint128 liquidity)",
  `function quoteExactInputSingle((${poolTuple} poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)`,
  `function swap(${poolTuple} key,(bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96) params,(bool takeClaims,bool settleUsingBurn) testSettings,bytes hookData) payable returns (int256 delta)`,
  "function manager() view returns (address)",
  "error WrappedError(address target,bytes4 selector,bytes reason,bytes details)",
  "error UnexpectedRevertBytes(bytes revertData)",
  "error ExecutionFailed(uint256 commandIndex,bytes message)",
]);
export const canonical = (v: any): any =>
  Array.isArray(v)
    ? v.map(canonical)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, canonical(v[k])]),
        )
      : v;
export const hashAbi = (abi: Abi) =>
  keccak256(stringToHex(JSON.stringify(canonical(abi)))).slice(2);
export function safePath(p: string) {
  return (
    /^[A-Za-z0-9_./-]+$/.test(p) &&
    !p.startsWith("/") &&
    !p.split("/").some((v) => v === ".." || v === "." || v === "")
  );
}
export async function loadDeployment() {
  const base = new URL("./", window.location.href);
  const get = async (path: string) => {
    const r = await fetch(new URL(path, base), { cache: "no-cache" });
    if (!r.ok) throw Error(`Unable to load ${path}. Reload the page.`);
    return r.json();
  };
  const manifest: Manifest = await get("imd-deployment.json");
  if (
    manifest.version !== 1 ||
    manifest.chainId !== manifest.network?.chainId ||
    BigInt(manifest.walletAddChain.chainId) !== BigInt(manifest.chainId)
  )
    throw Error("Deployment network verification failed.");
  const contracts = await Promise.all(
    manifest.contracts.map(async (c) => {
      if (!isAddress(c.address) || !safePath(c.abiPath))
        throw Error("Invalid contract configuration.");
      const abi: Abi = await get(c.abiPath);
      if (!Array.isArray(abi) || hashAbi(abi) !== c.abiHash)
        throw Error(`ABI verification failed for ${c.name}.`);
      return { ...c, abi };
    }),
  );
  const token = contracts.find((c) => c.name === poolSpec.tokenContract);
  const hook = contracts.find((c) => c.name === poolSpec.hookContract);
  if (!token || !hook) throw Error("The attested token or hook is missing.");
  const currencies = [poolSpec.pairedCurrency, token.address].sort((a, b) =>
    BigInt(a) < BigInt(b) ? -1 : 1,
  );
  const poolKey = {
    currency0: currencies[0],
    currency1: currencies[1],
    fee: poolSpec.fee,
    tickSpacing: poolSpec.tickSpacing,
    hooks: hook.address,
  };
  const poolId = keccak256(
    encodeAbiParameters(parseAbiParameters(poolTuple), [poolKey]),
  );
  const chain = defineChain({
    id: manifest.chainId,
    name: manifest.network.name,
    nativeCurrency: manifest.network.nativeCurrency,
    rpcUrls: { default: { http: manifest.network.rpcUrls } },
    testnet: manifest.network.testnet,
  });
  return { manifest, token, hook, poolKey, poolId, chain };
}
export type Deployment = Awaited<ReturnType<typeof loadDeployment>>;
export async function connectRpc(
  d: Deployment,
  wallet?: WalletProvider,
  failedEndpoint?: string,
) {
  const transports: { transport: Transport; label: string }[] =
    d.manifest.network.rpcUrls.map((url) => ({
      transport: http(url, { timeout: 6000, retryCount: 0 }),
      label: new URL(url).hostname,
    }));
  transports.sort(
    (a, b) =>
      Number(a.label === failedEndpoint) - Number(b.label === failedEndpoint),
  );
  if (wallet)
    transports.push({
      transport: custom(wallet, { retryCount: 0 }),
      label: "Connected wallet",
    });
  for (const entry of transports) {
    try {
      const client = createPublicClient({
        chain: d.chain,
        transport: entry.transport,
      });
      if ((await client.getChainId()) !== d.manifest.chainId) continue;
      await client.getBlockNumber({ cacheTime: 0 });
      return { client, label: entry.label };
    } catch {
      /* Try the next configured endpoint, then the connected wallet. */
    }
  }
  throw Error("Unable to reach Sepolia. Check your connection, then refresh.");
}
export type Rpc = Awaited<ReturnType<typeof connectRpc>>["client"];
export async function switchNetwork(provider: WalletProvider, d: Deployment) {
  const switchChain = () =>
    provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: d.manifest.walletAddChain.chainId }],
    });
  try {
    await switchChain();
  } catch (e) {
    const error = e as {
      code?: number;
      message?: string;
      data?: { originalError?: { code?: number } };
    };
    if (
      error.code !== 4902 &&
      error.data?.originalError?.code !== 4902 &&
      !/unknown chain|unrecognized chain|chain.*not.*added/i.test(
        error.message || "",
      )
    )
      throw e;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [d.manifest.walletAddChain],
    });
    await switchChain();
  }
}
