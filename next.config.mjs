import { fileURLToPath } from "node:url";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// A local dev server can stay open while CI-style builds run. Separate their manifests so
// Fast Refresh cannot replace production entries mid-build. Netlify keeps the standard .next output.
export default (phase) => ({
  // Firebase Auth loads an ES module through CommonJS. Bundle that boundary so the
  // function also starts on Node runtimes which disable require(ESM).
  transpilePackages: ["firebase-admin", "jwks-rsa", "jose"],
  serverExternalPackages: ["@google-cloud/firestore", "@google-cloud/storage"],
  distDir:
    phase === PHASE_DEVELOPMENT_SERVER
      ? process.env.OVI_BROWSER_TEST === "true"
        ? ".next-browser-test"
        : ".next-dev"
      : ".next",
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
});
