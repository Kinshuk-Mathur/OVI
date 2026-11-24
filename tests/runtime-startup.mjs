// Load the actual production route with Lambda's CommonJS restrictions. A healthy
// signed-out request stops at authentication, before Firestore or Groq is contacted.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const route = await require("../.next/server/app/api/ai/chat/route.js");
const response = await route.routeModule.userland.POST(new Request("http://localhost/api/ai/chat", { method: "POST" }));
assert.equal(response.status, 401);
assert.equal((await response.json()).code, "auth");
console.log("Production chat starts and returns a signed-out JSON response.");
