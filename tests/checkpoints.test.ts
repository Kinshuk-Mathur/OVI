import "fake-indexeddb/auto";
import test from "node:test";
import assert from "node:assert/strict";
import { acknowledgeCheckpoint, decryptCheckpoint, listCheckpoints, saveCheckpoint, StaleCheckpointError } from "../lib/journal/checkpoints";
import { decodeText, encodeText } from "../lib/security/vault";

test("encrypted checkpoints retain newer edits and independent branches", async () => {
  const uid = crypto.randomUUID();
  const masterKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const base = { uid, journalId: "journal", branchId: "first", baseCloudRevision: 0, masterKey };
  await saveCheckpoint({ ...base, localRevision: 1, plaintext: encodeText("private sentence") });
  await saveCheckpoint({ ...base, localRevision: 2, plaintext: encodeText("newer private sentence") });
  await assert.rejects(saveCheckpoint({ ...base, localRevision: 1, plaintext: encodeText("old") }), StaleCheckpointError);
  await saveCheckpoint({ ...base, branchId: "second", localRevision: 1, plaintext: encodeText("other device branch") });
  let branches = await listCheckpoints(uid);
  assert.equal(branches.length, 2);
  assert.equal(JSON.stringify(branches).includes("private sentence"), false);
  assert.equal(decodeText(await decryptCheckpoint(branches.find((branch) => branch.branchId === "first")!, masterKey)), "newer private sentence");
  assert.equal((await listCheckpoints("different-account")).length, 0);
  await acknowledgeCheckpoint(uid, "journal", "first", 0, 1, 1);
  branches = await listCheckpoints(uid);
  const first = branches.find((branch) => branch.branchId === "first")!;
  assert.equal(first.localRevision, 2);
  assert.equal(first.syncedLocalRevision, 1);
  assert.equal(first.baseCloudRevision, 1);
  assert.equal(decodeText(await decryptCheckpoint(first, masterKey)), "newer private sentence");
  await assert.rejects(acknowledgeCheckpoint(uid, "journal", "first", 0, 2, 1), StaleCheckpointError);
  await assert.rejects(saveCheckpoint({ ...base, localRevision: 3, plaintext: encodeText("stale base") }), StaleCheckpointError);
});
