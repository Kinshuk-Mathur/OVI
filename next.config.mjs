import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// A local dev server can stay open while CI-style builds run. Separate their manifests so
// Fast Refresh cannot replace production entries mid-build. Netlify keeps the standard .next output.
export default (phase) => ({
  distDir:
    phase === PHASE_DEVELOPMENT_SERVER
      ? process.env.OVI_BROWSER_TEST === "true"
        ? ".next-browser-test"
        : ".next-dev"
      : ".next",
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
});
