// npm test:browser starts disposable emulators first. Keep both this server and all test users
// on loopback; a developer's production credentials must never be used for the fixture run.
import { spawn } from "node:child_process";
import { once } from "node:events";
if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST)
  throw new Error("Use npm run test:browser");
const env = {
  ...process.env,
  OVI_BROWSER_TEST: "true",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-ovi",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-ovi.firebaseapp.com",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-key",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "demo-ovi.appspot.com",
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "123",
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:123:web:demo",
  NEXT_PUBLIC_FIREBASE_USE_EMULATORS: "true",
  GROQ_API_KEY: "test-fixture",
  FIREBASE_ADMIN_CREDENTIALS: "",
};
const service = spawn(
  process.execPath,
  ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", "--port", "3016"],
  { env, stdio: "inherit" },
);
const closed = once(service, "exit");
try {
  let ready = false;
  for (let i = 0; i < 90 && service.exitCode === null; i++) {
    try {
      ready = (await fetch("http://127.0.0.1:3016")).ok;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  if (!ready) throw new Error("The demo Next.js server could not start.");
  await import("./talk-browser.mjs");
} finally {
  service.kill("SIGTERM");
  await closed;
}
