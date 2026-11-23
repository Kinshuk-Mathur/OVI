import test from 'node:test';
import assert from 'node:assert/strict';
import { createVault, unlockVault, recoverVault, encryptRecord, decryptRecord, encodeText, decodeText } from '../lib/security/vault.ts';

test('vault wraps keys, rejects incorrect credentials and recovers existing data', async () => {
  const uid = 'user-a';
  const { metadata, recoveryKey, masterKey } = await createVault(uid, 'a long password for testing');
  const message = 'A private journal';
  const record = await encryptRecord(masterKey, uid, 'journal:one', encodeText(message));
  assert.equal(decodeText(await decryptRecord(await unlockVault(uid, 'a long password for testing', metadata), uid, 'journal:one', record)), message);
  await assert.rejects(unlockVault(uid, 'a wrong password', metadata));
  await assert.rejects(unlockVault('user-b', 'a long password for testing', metadata));
  await assert.rejects(recoverVault(uid, 'invalid', 'a replacement password', metadata));
  const recovered = await recoverVault(uid, recoveryKey, 'a replacement password', metadata);
  assert.equal(recovered.metadata.revision, 2);
  assert.deepEqual(recovered.metadata.recoveryWrappedKey, metadata.recoveryWrappedKey);
  assert.equal(decodeText(await decryptRecord(await unlockVault(uid, 'a replacement password', recovered.metadata), uid, 'journal:one', record)), message);
  await assert.rejects(unlockVault(uid, 'a long password for testing', recovered.metadata));
});

test('records are bound to their account and identifier and reject tampering', async () => {
  const { masterKey } = await createVault('user-a', 'a long password for testing');
  const one = await encryptRecord(masterKey, 'user-a', 'one', encodeText('secret'));
  const two = await encryptRecord(masterKey, 'user-a', 'one', encodeText('secret'));
  assert.notEqual(one.payload.iv, two.payload.iv);
  assert.notEqual(one.wrappedKey.iv, two.wrappedKey.iv);
  assert.notEqual(one.payload.ciphertext, two.payload.ciphertext);
  await assert.rejects(decryptRecord(masterKey, 'user-b', 'one', one));
  await assert.rejects(decryptRecord(masterKey, 'user-a', 'two', one));
  const altered = { ...one, payload: { ...one.payload, ciphertext: (one.payload.ciphertext[0] === 'A' ? 'B' : 'A') + one.payload.ciphertext.slice(1) } };
  await assert.rejects(decryptRecord(masterKey, 'user-a', 'one', altered));
  const bytes = crypto.getRandomValues(new Uint8Array(32768));
  const binaryRecord = await encryptRecord(masterKey, 'user-a', 'media:one', bytes);
  assert.deepEqual(await decryptRecord(masterKey, 'user-a', 'media:one', binaryRecord), bytes);
});
