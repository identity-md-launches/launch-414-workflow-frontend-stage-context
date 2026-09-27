import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { root, json, files, sha256, abiHash } from "./common.mjs";
const handoff = await json("web/config/deployment.json");
const network = await json("web/config/network.json");
await mkdir(root + "dist/abi", { recursive: true });
const contracts = [];
for (const c of handoff.contracts) {
  const path = `docs/abi/${c.name}.json`;
  const bytes = execFileSync(
    "git",
    ["show", `${handoff.sourceCommit}:${path}`],
    { cwd: root },
  );
  const abi = JSON.parse(bytes);
  if (!Array.isArray(abi) || abiHash(abi) !== c.abiHash)
    throw Error(`Pinned ABI mismatch: ${c.name}`);
  if (!(await readFile(root + path)).equals(bytes))
    throw Error(`Working ABI differs from pinned commit: ${path}`);
  const abiPath = `abi/${c.name}.json`;
  await writeFile(root + "dist/" + abiPath, bytes);
  contracts.push({
    name: c.name,
    address: c.address,
    abiHash: c.abiHash,
    abiPath,
  });
}
const assets = [];
for (const path of await files(root + "dist")) {
  if (path === "imd-deployment.json") continue;
  assets.push({ path, sha256: sha256(await readFile(root + "dist/" + path)) });
}
const { version, launchId, chainId, sourceCommit, attestationHash } = handoff;
await writeFile(
  root + "dist/imd-deployment.json",
  JSON.stringify(
    {
      version,
      launchId,
      chainId,
      sourceCommit,
      attestationHash,
      contracts,
      assets,
      ...network,
    },
    null,
    2,
  ) + "\n",
);
console.log("Exported pinned ABIs and runtime deployment manifest.");
