import { defineConfig } from "vite";
import handoff from "./config/deployment.json" with { type: "json" };
export default defineConfig({
  base: "./",
  build: { outDir: "../dist", emptyOutDir: true, sourcemap: false },
  define: {
    __POOL__: JSON.stringify({
      ...handoff.manifest.pool,
      tokenContract: handoff.manifest.token.contract,
      hookContract: handoff.manifest.hook.contract,
      deploymentBlock: Math.min(...handoff.contracts.map((c) => c.blockNumber)),
    }),
  },
});
