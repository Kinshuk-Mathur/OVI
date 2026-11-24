// Run against a local Next dev server configured for demo-ovi and the three emulators.
// Provider fixtures isolate layout and vault testing from Groq availability and model wording.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const origin = "http://127.0.0.1:3016";
const email = `chat-${crypto.randomUUID()}@example.test`,
  password = "Synthetic vault for browser testing";
const texts = [
  "Yaar aaj ka din thoda heavy tha.",
  "Hmm... heavy kaise? Kuch hua aaj, ya bas poore din ek ajeeb si feeling thi?",
  "College gaya tha but pata nahi, mann hi nahi lag raha tha.",
  "Kya tumhe college se zyada us feeling ne drain kiya, ya kuch specific hua jisse tum aur off feel karne lage?",
];
const output = process.env.OVI_SCREENSHOT_DIR ?? "docs/ai/screenshots";
const browser = await chromium.launch({
  channel: process.env.OVI_BROWSER_CHANNEL ?? "chrome",
  args: ["--use-fake-device-for-media-stream"],
});
await mkdir(output, { recursive: true });
async function signIn(page, first) {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const opened = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Continue with Google" }).click();
  const popup = await opened;
  await popup.waitForURL("http://127.0.0.1:9099/**");
  if (first) {
    await popup.getByText("Add new account").click();
    await popup.locator("#email-input").fill(email);
    await popup.locator("#display-name-input").fill("Kiran");
    await popup.locator('#main-form button[type="submit"]').click();
  } else await popup.getByText(email, { exact: true }).click();
}
try {
  const desk = await browser.newContext({ viewport: { width: 1672, height: 941 } }),
    page = await desk.newPage();
  await signIn(page, true);
  await page.getByLabel("Create your OVI password").fill(password);
  await page.getByLabel("Confirm your password").fill(password);
  await page.getByRole("button", { name: "Create my Vault" }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue to OVI" }).click();
  await page.locator(".greeting").waitFor();
  await page.addStyleTag({ content: "nextjs-portal{display:none}" });
  await page.screenshot({ animations: "disabled", path: output + "/welcome-desktop.png" });
  let turn = 0;
  await page.route("**/api/ai/chat", async (route) => {
    const input = route.request().postDataJSON();
    assert.equal(input.message, texts[turn * 2]);
    if (turn) assert.equal(input.history[1].content, texts[1]);
    await route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ content: texts[turn++ * 2 + 1] }) + '\n{"done":true}\n',
    });
  });
  for (const i of [0, 2]) {
    await page.getByLabel("Talk to OVI", { exact: true }).fill(texts[i]);
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText(texts[i + 1], { exact: true }).waitFor();
    await page.getByRole("button", { name: "Stop reply" }).waitFor({ state: "hidden" });
  }
  assert.equal(await page.locator(".greeting").count(), 0);
  // Denial keeps keyboard entry available. With a virtual microphone, cancel must release
  // capture without posting audio; a successful transcript must wait for the user to press Send.
  await page.getByRole("button", { name: "Record a voice message" }).click();
  await page.getByText(/Microphone access was denied|microphone is unavailable/).waitFor();
  await desk.grantPermissions(["microphone"], { origin });
  let uploads = 0;
  await page.route("**/api/voice/transcribe", async (route) => {
    uploads++;
    const bytes = route.request().postDataBuffer();
    assert.ok(bytes?.length > 44);
    assert.equal(bytes.subarray(0, 4).toString(), "RIFF");
    await route.fulfill({ json: { text: "Editable transcript" } });
  });
  await page.getByRole("button", { name: "Record a voice message" }).click();
  await page.getByRole("button", { name: "Stop and transcribe" }).waitFor();
  await page.getByRole("button", { name: "Cancel voice message" }).click();
  assert.equal(uploads, 0);
  await page.getByRole("button", { name: "Record a voice message" }).click();
  await page.getByRole("button", { name: "Stop and transcribe" }).waitFor();
  await page.waitForTimeout(450);
  await page.getByRole("button", { name: "Stop and transcribe" }).click();
  await page.waitForFunction(() => document.querySelector("#message").value === "Editable transcript");
  assert.equal(uploads, 1);
  assert.equal(turn, 2);
  await page.locator("#message").fill("");
  const bounds = await page.locator(".chat-row,.composer").evaluateAll((els) =>
    els.map((el) => {
      const b = el.getBoundingClientRect();
      return [el.className, b.x, b.y, b.width, b.height];
    }),
  );
  console.log("Desktop layout", JSON.stringify(bounds));
  await page.screenshot({ animations: "disabled", path: output + "/chat-desktop.png" });
  await page.getByRole("button", { name: "Account and usage" }).filter({ visible: true }).click();
  await page.getByText("Messages remaining").waitFor();
  await page.getByRole("button", { name: "Lock Vault" }).click();
  await page.getByRole("button", { name: "Unlock OVI" }).waitFor();
  const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      deviceScaleFactor: 1,
      hasTouch: true,
    }),
    mobile = await phone.newPage();
  await signIn(mobile, false);
  await mobile.getByLabel("Your OVI password", { exact: true }).fill(password);
  await mobile.getByRole("button", { name: "Unlock OVI" }).click();
  await mobile.getByText(texts[3], { exact: true }).waitFor();
  await mobile.addStyleTag({ content: "nextjs-portal{display:none}" });
  assert.ok(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.screenshot({ animations: "disabled", path: output + "/chat-mobile.png" });
  await mobile.setViewportSize({ width: 390, height: 480 });
  await mobile.waitForFunction(
    () =>
      document.querySelector(".composer").getBoundingClientRect().bottom <= window.visualViewport.height + 1,
  );
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.getByRole("link", { name: "Journal", exact: true }).click();
  await mobile.getByRole("button", { name: "New Journal", exact: true }).first().click();
  await mobile.locator("#journal-title").fill("Synthetic selected entry");
  await mobile.getByRole("textbox", { name: "Journal entry" }).fill("The lake was quiet.");
  await mobile.getByRole("button", { name: "Talk to OVI", exact: true }).click();
  await mobile.getByRole("button", { name: "Remove journal context" }).waitFor();
  let selectedRequests = 0;
  await mobile.route("**/api/ai/chat", async (route) => {
    const input = route.request().postDataJSON();
    if (selectedRequests++ === 0) {
      assert.match(input.journal, /The lake was quiet/);
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: '{"content":"A quiet lake."}\n{"done":true}\n',
      });
    } else {
      assert.equal(input.journal, undefined);
      await route.fulfill({ status: 503, json: { error: "Synthetic service interruption." } });
    }
  });
  await mobile.locator("#message").fill("Talk about this entry.");
  await mobile.getByRole("button", { name: "Send message" }).click();
  await mobile.getByText("A quiet lake.", { exact: true }).waitFor();
  await mobile.getByRole("button", { name: "Remove journal context" }).waitFor({ state: "hidden" });
  await mobile.locator("#message").fill("Keep this turn after a failure.");
  await mobile.getByRole("button", { name: "Send message" }).click();
  await mobile.getByText("Synthetic service interruption.", { exact: false }).waitFor();
  await mobile.getByText("Keep this turn after a failure.", { exact: true }).waitFor();
  console.log(
    "Verified emulator Google sign-in, Vault setup/lock/unlock, encrypted history on a fresh browser, four bubbles and viewport fit.",
  );
} finally {
  await browser.close();
}
