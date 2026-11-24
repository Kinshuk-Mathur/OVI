# Plaintext and encryption boundaries

| Location | Data present |
| --- | --- |
| Unlocked browser memory | Vault key, opened journal, visible conversation, draft and optional voice samples |
| Browser IndexedDB | Vault-encrypted chat outbox, journal checkpoints and encrypted media |
| Owner's Firestore and Storage paths | Wrapped keys, encrypted records, opaque IDs, timestamps and revision metadata |
| Next.js inference function | Verified identity, authorized request plaintext or transient audio |
| Groq | Static instructions, submitted text context or the submitted recording |
| Operational Firestore documents | UID-scoped quotas, reservations, byte counts, model usage and timing |

The browser uses the established per-record encryption and authenticated associated data in `lib/security/vault.ts`. For chat, the associated data binds the UID, conversation and immutable message ID. Message timestamp, role and content are encrypted together. Server timestamps support ordering and pagination. A locally committed outbox record represents pending synchronization. Confirmed server writes clear it.

Firebase verifies identity independently of Vault unlock. The server cannot recover a Vault password or decrypt the library. A signed-in client can deliberately submit its own plaintext, so verified server quotas remain essential. Each API response carrying personal content is private and non-cacheable. Application code does not log message bodies, audio, transcripts or journal text.

Enable and verify Groq Zero Data Retention in the relevant organization where appropriate. Review Netlify's logging, tracing and any external instrumentation before production. A provider processes submitted plaintext during inference. Browser extensions, device compromise and legacy unencrypted IndexedDB data have separate boundaries. The root README describes the existing legacy import. [Groq data controls](https://console.groq.com/docs/your-data)
