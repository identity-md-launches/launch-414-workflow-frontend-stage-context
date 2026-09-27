import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { keccak256, stringToHex } from "viem";
import { fileURLToPath } from "node:url";
export const root = fileURLToPath(new URL("../../", import.meta.url));
export const canonical = (value) =>
  Array.isArray(value)
    ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
export const abiHash = (abi) =>
  keccak256(stringToHex(JSON.stringify(canonical(abi)))).slice(2);
export const json = async (path) =>
  JSON.parse(await readFile(root + path, "utf8"));
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");
export async function files(dir, prefix = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink())
      throw Error("Symlinks are not allowed in the export");
    if (entry.isDirectory())
      result.push(
        ...(await files(dir + "/" + entry.name, prefix + entry.name + "/")),
      );
    else result.push(prefix + entry.name);
  }
  return result.sort();
}
