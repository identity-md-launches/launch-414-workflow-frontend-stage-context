import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { root, json, files, sha256, abiHash, canonical } from "./common.mjs";
const m = await json("dist/imd-deployment.json");
const h = await json("web/config/deployment.json");
const n = await json("web/config/network.json");
if (existsSync(root + ".imd/reads/deployment.json"))
  assert.deepEqual(h, await json(".imd/reads/deployment.json"));
if (existsSync(root + ".imd/reads/network.json"))
  assert.deepEqual(n, await json(".imd/reads/network.json"));
assert.deepEqual(
  Object.keys(m).sort(),
  [
    "version",
    "launchId",
    "chainId",
    "sourceCommit",
    "attestationHash",
    "contracts",
    "assets",
    "network",
    "walletAddChain",
  ].sort(),
);
for (const key of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
])
  assert.equal(m[key], h[key]);
assert.deepEqual(m.network, n.network);
assert.deepEqual(m.walletAddChain, n.walletAddChain);
assert.equal(m.network.chainId, m.chainId);
assert.equal(BigInt(m.walletAddChain.chainId), BigInt(m.chainId));
assert.deepEqual(
  m.contracts.map(({ abiPath, ...c }) => c),
  h.contracts.map(({ name, address, abiHash }) => ({ name, address, abiHash })),
);
const safe = (p) =>
  typeof p === "string" &&
  /^[A-Za-z0-9_./-]+$/.test(p) &&
  !p.startsWith("/") &&
  !p.split("/").some((v) => v === ".." || v === "." || v === "");
assert(m.assets.length <= 128);
assert.deepEqual(
  m.assets.map((a) => a.path).sort(),
  (await files(root + "dist")).filter((p) => p !== "imd-deployment.json"),
);
let total = (await readFile(root + "dist/imd-deployment.json")).length;
for (const a of m.assets) {
  assert(safe(a.path));
  assert(/^[a-f0-9]{64}$/.test(a.sha256));
  const bytes = await readFile(root + "dist/" + a.path);
  assert(bytes.length <= 8388608);
  total += bytes.length;
  assert.equal(sha256(bytes), a.sha256);
}
for (const c of m.contracts) {
  assert(safe(c.abiPath));
  assert(m.assets.some((a) => a.path === c.abiPath));
  const abi = await json("dist/" + c.abiPath);
  assert(Array.isArray(abi));
  assert.equal(abiHash(abi), c.abiHash);
}
assert(total < 24 * 1024 * 1024);
assert(!(await readFile(root + "dist/index.html", "utf8")).includes('src="/'));
console.log(
  JSON.stringify(
    {
      passed: true,
      assets: m.assets.length,
      exportBytes: total,
      canonicalNetwork: canonical(m.network),
    },
    null,
    2,
  ),
);
