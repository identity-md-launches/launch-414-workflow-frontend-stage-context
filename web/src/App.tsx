import { useCallback, useEffect, useRef, useState } from "react";
import { encodeFunctionData, numberToHex, type Address, type Hex } from "viem";
import {
  connectRpc,
  loadDeployment,
  switchNetwork,
  type Deployment,
  type Rpc,
} from "./config";
import {
  amount,
  amountIn,
  assertWallet,
  checkFresh,
  describeError,
  number,
  precheck,
  price,
  readSnapshot,
  slippageBps,
  swapRequest,
  type Quote,
  type Side,
  type Snapshot,
} from "./chain";
const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
export default function App() {
  const [d, setD] = useState<Deployment>();
  const [fatal, setFatal] = useState("");
  const [rpc, setRpc] = useState<Rpc>();
  const [rpcName, setRpcName] = useState("");
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [loading, setLoading] = useState(true);
  const [readError, setReadError] = useState("");
  const [account, setAccount] = useState<Address>();
  const [walletChain, setWalletChain] = useState<number>();
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletMessage, setWalletMessage] = useState("");
  const [side, setSide] = useState<Side>("buy");
  const [input, setInput] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [quote, setQuote] = useState<Quote>();
  const [checkMessage, setCheckMessage] = useState(
    "Enter an amount to test the circuit.",
  );
  const [checkKind, setCheckKind] = useState("idle");
  const [busy, setBusy] = useState(false);
  const [tx, setTx] = useState<Hex>();
  const [txMessage, setTxMessage] = useState("");
  const [invalid, setInvalid] = useState("");
  const [invalidField, setInvalidField] = useState<"amount" | "slippage">(
    "amount",
  );
  const [now, setNow] = useState(Date.now());
  const generation = useRef(0);
  const formVersion = useRef(0);
  const readBusy = useRef(false);
  const refreshQueued = useRef(false);
  const activeRpc = useRef<Rpc | undefined>(undefined);
  const accountRef = useRef<Address | undefined>(undefined);
  const activeEndpoint = useRef("");
  const failedEndpoint = useRef<string | undefined>(undefined);
  const wrongChain = !!account && walletChain !== d?.manifest.chainId;
  const clean = !!snapshot && !readError && now - snapshot.loadedAt < 30000;
  const validQuote =
    !!quote &&
    clean &&
    quote.block === snapshot?.block &&
    quote.blockHash === snapshot?.blockHash &&
    now - quote.createdAt < 20000;
  const routerReady = clean && snapshot.routerReady;
  const inputSymbol = side === "buy" ? "ETH" : snapshot?.symbol || "CBRK";
  const outputSymbol = side === "buy" ? snapshot?.symbol || "CBRK" : "ETH";
  const currentInput = () =>
    amountIn(
      input,
      side === "buy"
        ? d!.manifest.network.nativeCurrency.decimals
        : snapshot!.decimals,
    );
  let inputValue = 0n;
  try {
    if (snapshot && d) inputValue = currentInput();
  } catch {
    /* Field errors are presented on submission. */
  }
  const balance = side === "buy" ? snapshot?.eth : snapshot?.tokens;
  const sufficient =
    balance !== undefined &&
    inputValue > 0n &&
    (side === "buy" ? balance > inputValue : balance >= inputValue);
  const needsApproval =
    side === "sell" &&
    inputValue > 0n &&
    !!snapshot &&
    snapshot.allowance < inputValue;
  const invalidate = useCallback(
    (message = "Swap changed. Run the pre-check again.") => {
      formVersion.current++;
      setQuote(undefined);
      setCheckKind("idle");
      setCheckMessage(message);
      setInvalid("");
    },
    [],
  );
  useEffect(() => {
    loadDeployment()
      .then(setD)
      .catch((e) => setFatal(describeError(e).message));
  }, []);
  const refresh = useCallback(
    async (force = false): Promise<void> => {
      if (!d) return;
      if (readBusy.current) {
        refreshQueued.current = true;
        return;
      }
      readBusy.current = true;
      const version = generation.current;
      setLoading(true);
      try {
        let client = activeRpc.current;
        if (!client || force) {
          const connection = await connectRpc(
            d,
            window.ethereum,
            failedEndpoint.current,
          );
          client = connection.client;
          if (version !== generation.current) return;
          activeRpc.current = client;
          setRpc(client);
          setRpcName(connection.label);
          activeEndpoint.current = connection.label;
        }
        const next = await readSnapshot(d, client, accountRef.current);
        if (version !== generation.current) return;
        setSnapshot(next);
        setReadError("");
        failedEndpoint.current = undefined;
        setQuote((q) =>
          q?.block === next.block && q?.blockHash === next.blockHash
            ? q
            : undefined,
        );
      } catch (e) {
        if (version === generation.current) {
          setReadError(describeError(e, d).message);
          setQuote(undefined);
          activeRpc.current = undefined;
          failedEndpoint.current = activeEndpoint.current;
        }
      } finally {
        readBusy.current = false;
        setLoading(false);
        if (refreshQueued.current) {
          refreshQueued.current = false;
          queueMicrotask(() => void refresh());
        }
      }
    },
    [d],
  );
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 12000);
    return () => clearInterval(id);
  }, [refresh, account, walletChain]);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const provider = window.ethereum;
    if (!provider) return;
    const reset = (accounts?: Address[]) => {
      generation.current++;
      accountRef.current = accounts?.[0];
      setAccount(accounts?.[0]);
      setSnapshot(undefined);
      invalidate("Wallet changed. Run the pre-check again.");
      setTx(undefined);
      setTxMessage("");
    };
    const accountsChanged = (accounts: Address[]) => reset(accounts);
    const chainChanged = (chain: Hex) => {
      generation.current++;
      setWalletChain(Number(chain));
      setSnapshot(undefined);
      invalidate("Network changed. Run the pre-check again.");
    };
    const disconnect = () => {
      reset();
      setWalletChain(undefined);
      setWalletMessage("Wallet disconnected. Connect to continue.");
    };
    provider.on?.("accountsChanged", accountsChanged);
    provider.on?.("chainChanged", chainChanged);
    provider.on?.("disconnect", disconnect);
    return () => {
      provider.removeListener?.("accountsChanged", accountsChanged);
      provider.removeListener?.("chainChanged", chainChanged);
      provider.removeListener?.("disconnect", disconnect);
    };
  }, [invalidate]);
  async function connect() {
    const provider = window.ethereum;
    if (!provider) {
      setWalletMessage(
        "No browser wallet found. Open this page in an Ethereum wallet browser, or install a browser wallet and reload.",
      );
      return;
    }
    setWalletBusy(true);
    setWalletMessage("");
    try {
      const accounts = await provider.request({
        method: "eth_requestAccounts",
      });
      const chain = await provider.request({ method: "eth_chainId" });
      generation.current++;
      accountRef.current = accounts[0];
      setAccount(accounts[0]);
      setWalletChain(Number(chain));
      setSnapshot(undefined);
      invalidate("Wallet connected. Enter an amount and run the pre-check.");
      void refresh();
    } catch (e) {
      setWalletMessage(describeError(e, d).message);
    } finally {
      setWalletBusy(false);
    }
  }
  async function switchChain() {
    if (!d || !window.ethereum) return;
    setWalletBusy(true);
    setWalletMessage("");
    try {
      await switchNetwork(window.ethereum, d);
      const chain = await window.ethereum.request({ method: "eth_chainId" });
      generation.current++;
      setWalletChain(Number(chain));
      setSnapshot(undefined);
      invalidate();
      void refresh();
    } catch (e) {
      setWalletMessage(describeError(e, d).message);
    } finally {
      setWalletBusy(false);
    }
  }
  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (!d || !rpc || !snapshot || !clean || busy) return;
    let value: bigint, bps: bigint;
    try {
      value = currentInput();
    } catch (e) {
      setInvalidField("amount");
      setInvalid((e as Error).message);
      document.getElementById("swap-amount")?.focus();
      return;
    }
    try {
      bps = slippageBps(slippage);
    } catch (e) {
      setInvalidField("slippage");
      setInvalid((e as Error).message);
      document.getElementById("slippage")?.focus();
      return;
    }
    setInvalid("");
    setBusy(true);
    setQuote(undefined);
    setCheckKind("loading");
    setCheckMessage("Simulating the swap against this block…");
    const version = formVersion.current;
    const session = generation.current;
    try {
      const latest = await readSnapshot(d, rpc, accountRef.current);
      if (version !== formVersion.current || session !== generation.current)
        return;
      setSnapshot(latest);
      const result = await precheck(d, rpc, latest, side, value, bps);
      await checkFresh(rpc, result);
      if (version !== formVersion.current || session !== generation.current)
        return;
      setQuote(result);
      setCheckKind("pass");
      setCheckMessage("Would pass the circuit check at the sampled block.");
    } catch (e) {
      if (version !== formVersion.current || session !== generation.current)
        return;
      const err = describeError(e, d);
      setCheckKind(err.kind);
      setCheckMessage(err.message);
    } finally {
      setBusy(false);
    }
  }
  async function send(action: "approve" | "swap") {
    if (
      !d ||
      !rpc ||
      !snapshot ||
      !account ||
      !window.ethereum ||
      busy ||
      wrongChain ||
      !routerReady ||
      !sufficient
    )
      return;
    if (action === "swap" && (!validQuote || needsApproval)) return;
    setBusy(true);
    setTxMessage("Preparing wallet request…");
    setTx(undefined);
    const provider = window.ethereum,
      session = generation.current,
      version = formVersion.current;
    try {
      await assertWallet(provider, d, account);
      // Refresh code, manager bindings, balances and allowance before any wallet signature.
      const current = await readSnapshot(d, rpc, account);
      if (!current.routerReady) throw Error("Router verification failed.");
      const value = currentInput();
      if (side === "buy" ? current.eth <= value : current.tokens < value)
        throw Error("Insufficient balance. Leave ETH for network fees.");
      let request: { to: Address; data: Hex; value: bigint };
      if (action === "approve") {
        request = {
          to: d.token.address,
          value: 0n,
          data: encodeFunctionData({
            abi: d.token.abi,
            functionName: "approve",
            args: [d.manifest.network.uniswapV4.poolSwapTest!, value],
          }),
        };
      } else {
        if (!quote || current.blockHash !== quote.blockHash)
          throw Error("The block changed. Run the pre-check again.");
        await checkFresh(rpc, quote);
        if (side === "sell" && current.allowance < value)
          throw Error("Approve the token amount first.");
        request = swapRequest(d, quote, account);
      }
      await rpc.call({ ...request, account, blockTag: "latest" });
      if (session !== generation.current || version !== formVersion.current)
        throw Error("Wallet or form changed. Check the swap again.");
      await assertWallet(provider, d, account);
      if (action === "swap") await checkFresh(rpc, quote!);
      setTxMessage(
        action === "approve"
          ? "Confirm the exact token approval in your wallet."
          : "Confirm the swap in your wallet.",
      );
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: account,
            to: request.to,
            data: request.data,
            value: numberToHex(request.value),
            chainId: numberToHex(d.manifest.chainId),
          },
        ],
      });
      setTx(hash);
      setTxMessage("Transaction submitted. Waiting for confirmation…");
      invalidate(
        "Transaction submitted. Run a fresh check after confirmation.",
      );
      const receipt = await rpc.waitForTransactionReceipt({
        hash,
        timeout: 120000,
      });
      if (receipt.status !== "success")
        throw Error(
          "Transaction reverted on chain. Review the amount and run a fresh check.",
        );
      setTxMessage(
        action === "approve"
          ? "Token approval confirmed. Run a fresh pre-check to continue."
          : "Swap confirmed. Balances are updating.",
      );
      await refresh();
    } catch (e) {
      setTxMessage(describeError(e, d).message);
    } finally {
      setBusy(false);
    }
  }
  const p = (sqrt: bigint) =>
    number(
      price(
        sqrt,
        snapshot!.decimals,
        d!.manifest.network.nativeCurrency.decimals,
      ),
    );
  const deviation = snapshot
    ? (price(snapshot.sqrt, snapshot.decimals) /
        price(snapshot.reference, snapshot.decimals) -
        1) *
      100
    : 0;
  const sourceEvent = snapshot?.events.find((e) => e.block === snapshot.block);
  return (
    <>
      <a className="skip" href="#main">
        Skip to main content
      </a>
      <header className="site-header">
        <a className="wordmark" href="./" aria-label="Breaker home">
          <span className="logo" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          breaker<span className="wordmark-dot">.</span>
        </a>
        <div className="header-right">
          <span className="network-tag">
            <span aria-hidden="true" />
            Sepolia testnet
          </span>
          <button
            onClick={connect}
            disabled={walletBusy || busy}
            className="wallet-button"
          >
            {walletBusy
              ? "Connecting…"
              : account
                ? short(account)
                : "Connect wallet"}
            <span aria-hidden="true"> ↗</span>
          </button>
        </div>
      </header>
      <main id="main">
        <section className="intro">
          <div>
            <p className="eyebrow">Circuit breaker / Uniswap v4</p>
            <h1>
              A little room to move.
              <br />
              <span>A hard line at 10%.</span>
            </h1>
            <p className="intro-copy">
              Watch the band. Check your trade. Breaker keeps each swap within
              ±10% of the block’s reference price.
            </p>
          </div>
          <div className="intro-note">
            <span className="note-number">01</span>
            <p>
              A new block.
              <br />A new reference.
            </p>
            <span className="small muted">Native ETH / CBRK</span>
          </div>
        </section>
        {fatal && (
          <div role="alert" className="notice error">
            <strong>Deployment unavailable</strong>
            <p>{fatal}</p>
            <button onClick={() => window.location.reload()}>
              Reload page
            </button>
          </div>
        )}
        {walletMessage && (
          <div role="alert" className="notice">
            {walletMessage}
          </div>
        )}
        {wrongChain && (
          <div className="notice warning" role="status">
            <div>
              <strong>Wallet is on a different network</strong>
              <p>Switch to {d?.manifest.network.name} to approve or swap.</p>
            </div>
            <button onClick={switchChain} disabled={walletBusy || busy}>
              {walletBusy
                ? "Switching…"
                : `Switch to ${d?.manifest.network.name}`}
            </button>
          </div>
        )}
        <div className="workspace">
          <section className="monitor panel" aria-labelledby="monitor-heading">
            <div className="section-heading">
              <h2 id="monitor-heading">The circuit</h2>
              <span className={`status ${clean ? "good" : ""}`}>
                <span aria-hidden="true" />
                {clean ? "Live state" : loading ? "Connecting" : "Unavailable"}
              </span>
            </div>
            <div className="price-heading">
              <p className="label">
                Pool price <span>CBRK per ETH</span>
              </p>
              <p className="spot-price">
                {snapshot ? p(snapshot.sqrt) : "—"}
                <span className="price-unit">CBRK</span>
              </p>
              <p className="muted small">
                {snapshot
                  ? `${deviation >= 0 ? "+" : ""}${number(deviation)}% from this block’s reference`
                  : "Reading price from Uniswap StateView…"}
              </p>
            </div>
            <div
              className="band-visual"
              aria-label="Allowed price band: minus 10% to plus 10% of the reference"
            >
              <div className="band-captions">
                <span>Lower limit</span>
                <span>Reference</span>
                <span>Upper limit</span>
              </div>
              <div className="band-track">
                <div className="band-range" />
                <span className="center-line" />
                {snapshot && (
                  <span
                    className="price-marker"
                    style={{
                      left: `${Math.min(94, Math.max(6, 50 + deviation * 4))}%`,
                    }}
                  >
                    <span>Price</span>
                  </span>
                )}
              </div>
              <div className="band-percent">
                <span>−10%</span>
                <span>0%</span>
                <span>+10%</span>
              </div>
            </div>
            <dl className="band-values">
              <div>
                <dt>Lower bound</dt>
                <dd>{snapshot ? p(snapshot.lower) : "—"}</dd>
              </div>
              <div>
                <dt>Block reference</dt>
                <dd>{snapshot ? p(snapshot.reference) : "—"}</dd>
              </div>
              <div>
                <dt>Upper bound</dt>
                <dd>{snapshot ? p(snapshot.upper) : "—"}</dd>
              </div>
            </dl>
            <div className="reference-note">
              <span aria-hidden="true">↳</span>
              <p>
                {snapshot?.setThisBlock
                  ? sourceEvent
                    ? "ReferenceSet captured the price before this block’s first swap."
                    : "The hook has a stored reference for this block."
                  : snapshot
                    ? "No successful swap yet in this block. The current pool price is the reference."
                    : "Each block’s first swap sets the reference before its price moves."}
              </p>
            </div>
            <div className="monitor-footer">
              <span className="mono small">
                {snapshot
                  ? `Block ${snapshot.block.toLocaleString()}`
                  : "Waiting for block"}
              </span>
              <span className="small muted">
                {snapshot
                  ? `${Math.max(0, Math.floor((now - snapshot.loadedAt) / 1000))}s since refresh`
                  : "Public RPC"}
              </span>
              <button
                className="text-button"
                onClick={() => void refresh(true)}
                disabled={loading || busy || !d}
              >
                {loading ? "Refreshing…" : "Refresh ↻"}
              </button>
            </div>
            {readError && (
              <div role="alert" className="inline-error">
                {readError}
              </div>
            )}
            {snapshot && !clean && !readError && (
              <p className="inline-error">
                Data is stale. Refresh to enable checks.
              </p>
            )}
          </section>
          <section className="trade panel" aria-labelledby="trade-heading">
            <div className="section-heading">
              <h2 id="trade-heading">Check & trade</h2>
              <span className="small muted">0.30% pool fee</span>
            </div>
            <form onSubmit={check} noValidate>
              <fieldset disabled={busy}>
                <legend className="sr-only">Swap direction and amount</legend>
                <div
                  className="direction"
                  role="group"
                  aria-label="Swap direction"
                >
                  <button
                    type="button"
                    aria-pressed={side === "buy"}
                    onClick={() => {
                      setSide("buy");
                      setInput("");
                      invalidate("Enter ETH to check a buy.");
                    }}
                  >
                    Buy CBRK
                  </button>
                  <button
                    type="button"
                    aria-pressed={side === "sell"}
                    onClick={() => {
                      setSide("sell");
                      setInput("");
                      invalidate("Enter CBRK to check a sell.");
                    }}
                  >
                    Sell CBRK
                  </button>
                </div>
                <div className="amount-field">
                  <div className="field-top">
                    <label htmlFor="swap-amount">You pay</label>
                    <span className="small muted">
                      {account && snapshot
                        ? `Balance: ${amount(balance!, side === "buy" ? d!.manifest.network.nativeCurrency.decimals : snapshot.decimals)}`
                        : "Connect for balance"}
                    </span>
                  </div>
                  <div className="amount-row">
                    <input
                      id="swap-amount"
                      name="amount"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      value={input}
                      onChange={(e) => {
                        setInput(e.target.value);
                        invalidate();
                      }}
                      aria-invalid={invalidField === "amount" && !!invalid}
                      aria-describedby="amount-help amount-error"
                    />
                    <span className="currency">
                      <span
                        className={`coin ${side === "sell" ? "token" : ""}`}
                        aria-hidden="true"
                      >
                        {side === "buy" ? "Ξ" : "B"}
                      </span>
                      {inputSymbol}
                    </span>
                  </div>
                </div>
                <p id="amount-help" className="small muted">
                  Enter an exact input amount. Checking costs no gas.
                </p>
                <p id="amount-error" className="inline-error" role="alert">
                  {invalidField === "amount" ? invalid : ""}
                </p>
                <div className="tolerance">
                  <label htmlFor="slippage">Price tolerance</label>
                  <div>
                    <input
                      id="slippage"
                      inputMode="decimal"
                      name="slippage"
                      value={slippage}
                      onChange={(e) => {
                        setSlippage(e.target.value);
                        invalidate();
                      }}
                      aria-invalid={invalidField === "slippage" && !!invalid}
                      aria-describedby="tolerance-help tolerance-error"
                    />
                    <span>%</span>
                  </div>
                </div>
                <p id="tolerance-help" className="small muted">
                  Limits spot-price movement from the displayed price. A trade
                  may fill only part of your input. The pre-check tests the full
                  input without this limit.
                </p>
                <p id="tolerance-error" className="inline-error" role="alert">
                  {invalidField === "slippage" ? invalid : ""}
                </p>
              </fieldset>
              <button
                className="primary full"
                type="submit"
                disabled={!clean || busy || !rpc}
              >
                {busy && checkKind === "loading"
                  ? "Checking…"
                  : "Run pre-check"}{" "}
                <span aria-hidden="true">→</span>
              </button>
            </form>
            <div
              className={`check-result ${checkKind === "pass" && !validQuote ? "idle" : checkKind}`}
              role="status"
              aria-live="polite"
            >
              <div className="result-label">
                <span aria-hidden="true">
                  {validQuote ? "✓" : checkKind === "trip" ? "!" : "○"}
                </span>
                <strong>
                  {validQuote
                    ? "Inside the band"
                    : quote || checkKind === "pass"
                      ? "Check expired"
                      : checkKind === "trip"
                        ? "Would trip"
                        : checkKind === "phantom"
                          ? "Empty liquidity"
                          : checkKind === "error"
                            ? "Check unavailable"
                            : "Swap pre-check"}
                </strong>
              </div>
              <p>
                {!validQuote && checkKind === "pass"
                  ? "The block changed or the check expired. Run the pre-check again."
                  : checkMessage}
              </p>
              {validQuote && quote && snapshot && (
                <>
                  <div className="quote-output">
                    <span>Estimated output</span>
                    <strong>
                      {amount(
                        quote.output,
                        side === "buy"
                          ? snapshot.decimals
                          : d!.manifest.network.nativeCurrency.decimals,
                      )}{" "}
                      {outputSymbol}
                    </strong>
                  </div>
                  <p className="small">
                    Simulated at block {quote.block.toString()} through the
                    approved quoter. Price tolerance may reduce actual output.
                    Execution can change before inclusion.
                  </p>
                </>
              )}
            </div>
            {!d?.manifest.network.uniswapV4.poolSwapTest && (
              <p className="route-notice">
                <strong>Swap routing unavailable.</strong> The approved network
                configuration does not include PoolSwapTest. You can read the
                pool and run pre-checks; approvals and swaps stay disabled.
              </p>
            )}
            {!account ? (
              <button
                className="secondary full"
                onClick={connect}
                disabled={walletBusy || busy}
              >
                Connect wallet to trade
              </button>
            ) : (
              <>
                <p className="small muted">
                  {sufficient
                    ? "Keep ETH available for network fees."
                    : inputValue > 0n
                      ? "Insufficient balance. Add funds and leave ETH for network fees."
                      : "Enter an amount to prepare a transaction."}
                </p>
                {side === "sell" && (
                  <button
                    className="secondary full"
                    disabled={
                      !routerReady ||
                      wrongChain ||
                      busy ||
                      !needsApproval ||
                      !sufficient
                    }
                    onClick={() => void send("approve")}
                  >
                    {needsApproval
                      ? `1. Approve ${input || "0"} CBRK`
                      : "1. Token approval ready"}
                  </button>
                )}
                <button
                  className="secondary full"
                  disabled={
                    !routerReady ||
                    wrongChain ||
                    busy ||
                    !validQuote ||
                    needsApproval ||
                    !sufficient
                  }
                  onClick={() => void send("swap")}
                >
                  {side === "sell" ? "2. " : ""}
                  {side === "buy" ? "Buy CBRK" : "Sell CBRK"} in wallet
                </button>
                <p className="small muted">
                  {side === "sell"
                    ? "Approval grants PoolSwapTest permission for exactly the entered CBRK amount. "
                    : ""}
                  The swap is simulated again before signing.
                </p>
              </>
            )}
            <div role="status" className="transaction-status">
              {txMessage}
              {tx && d && (
                <a
                  href={`${d.manifest.network.explorer}/tx/${tx}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              )}
            </div>
          </section>
        </div>
        <section className="activity" aria-labelledby="activity-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">On-chain observations</p>
              <h2 id="activity-heading">Reference activity</h2>
            </div>
            <span className="small muted">
              Latest 200 blocks · up to 5 events
            </span>
          </div>
          <p className="muted small">
            Successful swaps can set a reference. Reverted swaps leave no event;
            use the pre-check to test them.
          </p>
          {snapshot?.eventError ? (
            <p className="notice">{snapshot.eventError}</p>
          ) : snapshot?.events.length ? (
            <div className="events">
              <div className="event-row event-head">
                <span>Block</span>
                <span>Reference · CBRK / ETH</span>
                <span>Transaction</span>
              </div>
              {snapshot.events.map((e) => (
                <div className="event-row" key={`${e.hash}-${e.block}`}>
                  <span className="mono">{e.block.toLocaleString()}</span>
                  <strong>{p(e.sqrt)}</strong>
                  <a
                    href={`${d?.manifest.network.explorer}/tx/${e.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(e.hash)} ↗
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-activity">
              <span className="empty-symbol" aria-hidden="true">
                ↳
              </span>
              <div>
                <strong>
                  {snapshot
                    ? "No references in this window"
                    : "Waiting for reference events"}
                </strong>
                <p className="small muted">
                  {snapshot
                    ? "The next successful swap in a new block records a reference. Refresh to check again."
                    : "Events will appear after the public RPC responds."}
                </p>
              </div>
            </div>
          )}
        </section>
        <section className="explain-grid">
          <article>
            <span className="eyebrow">01 / Anchor</span>
            <h3>The first swap sets the line</h3>
            <p>
              The price before the first swap becomes the block’s reference.
              That first swap is checked, too.
            </p>
          </article>
          <article>
            <span className="eyebrow">02 / Check</span>
            <h3>Beyond the band, it reverts</h3>
            <p>
              Every swap must end inside the band. Large trades may need to be
              split across blocks.
            </p>
          </article>
          <article>
            <span className="eyebrow">03 / Reset</span>
            <h3>The next block starts fresh</h3>
            <p>
              Trading toward a band edge can block the same direction for the
              rest of a block. Moving back inside still works.
            </p>
          </article>
        </section>
        <details className="deployment">
          <summary>
            Deployment & pool details{" "}
            <span className="small muted">
              Verified configuration, contract links and limits
            </span>
          </summary>
          {d && (
            <div className="detail-grid">
              <div>
                <h3>Deployed contracts</h3>
                {d.manifest.contracts.map((c) => (
                  <p key={c.name}>
                    <a
                      href={`${d.manifest.network.explorer}/address/${c.address}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.name} ↗
                    </a>
                    <code>{c.address}</code>
                  </p>
                ))}
                <p>
                  <a
                    href={`${d.manifest.network.explorer}/address/${d.manifest.network.uniswapV4.stateView}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Uniswap StateView ↗
                  </a>
                  <code>{d.manifest.network.uniswapV4.stateView}</code>
                </p>
                <a href="./imd-deployment.json">View deployment manifest</a>
              </div>
              <div>
                <h3>Pool & verification</h3>
                <dl className="detail-list">
                  <dt>Chain</dt>
                  <dd>
                    {d.manifest.network.name} · {d.manifest.chainId}
                  </dd>
                  <dt>Fee / tick spacing</dt>
                  <dd>
                    {d.poolKey.fee / 10000}% / {d.poolKey.tickSpacing}
                  </dd>
                  <dt>Current tick</dt>
                  <dd>{snapshot?.tick ?? "—"}</dd>
                  <dt>Active liquidity</dt>
                  <dd>{snapshot?.liquidity.toString() ?? "—"}</dd>
                  <dt>Token supply</dt>
                  <dd>
                    {snapshot
                      ? `${amount(snapshot.supply, snapshot.decimals)} ${snapshot.symbol}`
                      : "—"}
                  </dd>
                  <dt>RPC</dt>
                  <dd>{rpcName || "Connecting"}</dd>
                  <dt>ABI integrity</dt>
                  <dd>Canonical Keccak verified</dd>
                  <dt>Contract code</dt>
                  <dd>
                    {clean
                      ? "Present; PoolManager matches"
                      : "Awaiting fresh verification"}
                  </dd>
                </dl>
                <p className="small">
                  Pool ID<code>{d.poolId}</code>
                </p>
                <p className="small">
                  Deployed source<code>{d.manifest.sourceCommit}</code>
                </p>
                {account && (
                  <p className="small">
                    Connected account<code>{account}</code>
                  </p>
                )}
              </div>
            </div>
          )}
          <p className="risk-copy">
            Sepolia test assets only. The hook has no owner, pause or admin
            controls. It takes no fee; the pool fee still applies. A successful
            simulation is a snapshot, not an execution guarantee.
            Empty-liquidity swaps are blocked, but dust liquidity can still move
            the reference across blocks. This is a per-block circuit breaker,
            not an oracle or a guarantee of fair price.
          </p>
        </details>
      </main>
      <footer className="site-footer">
        <span className="wordmark">breaker.</span>
        <span>Bounded by the block.</span>
        <span className="small">Sepolia · Experimental interface</span>
      </footer>
    </>
  );
}
