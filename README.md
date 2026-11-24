# OVI

OVI is a private journal and companion interface built with Next.js, React, TipTap, and Firebase. Talk to OVI streams Groq replies, accepts editable voice transcripts, and synchronizes encrypted conversations across unlocked devices. The [AI architecture and reading guide](docs/ai/OVI_AI_ARCHITECTURE.md) maps the implementation.

## Setup

Use Node.js 22 or newer. Install dependencies with `npm install` and run `npm run dev`. The application reads the existing `NEXT_PUBLIC_FIREBASE_*` values listed in `.env.example`. Netlify's already-configured values are used at build time. For local development, copy `.env.example` to `.env.local` and populate it with the existing Firebase web app configuration. `.env.local` is ignored by Git. Configure the server-only Groq key, verified organization budgets and Firebase Admin identity as described in [Netlify setup](docs/ai/OVI_GROQ_INTEGRATION.md). Keep credentials out of Git.

Verify that the configured project ID and Storage bucket belong to the intended existing Firebase project. In Firebase Console, enable the Google sign-in provider, authorize the application's domains for Auth, and enable Cloud Storage if it is not already enabled. Cloud Storage availability and billing depend on the project's configuration. Google sign-in uses a popup; browsers that block popups need to allow it for OVI. The unlocked vault key remains in memory and is not transferred across page loads or tabs.

For local emulators, set `NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true` in `.env.local` and use a demo project ID such as `demo-ovi` with nonempty placeholder values for the other Firebase settings. Start the Auth, Firestore, and Storage emulators with `npx firebase emulators:start --project demo-ovi`; ports are listed in `firebase.json`. Never enable the emulator flag in a production build. Firebase CLI and a compatible Java runtime are needed for emulator tests.

## Authentication and vault

Firebase Auth persists the signed-in Google identity on this browser so returning users see the vault unlock screen after a refresh, a new tab, or reopening OVI. This retains Firebase authentication state on the device; use “Use another Google account” to sign out, especially on shared devices. The vault password and unwrapped key are never persisted: every page load and new tab requires the vault password before private content is shown. The Lock control also clears the in-memory vault key while keeping the Google identity signed in. A newly created vault uses a minimum 12-character password and displays a separately generated recovery key before writing the vault. Save that key securely: if both the password and recovery key are lost, the encrypted data may be unrecoverable. Recovery unwraps the same master key locally and transactionally rewraps it with a new password; it does not replace journals. A server read and create-only transaction prevent a failed unlock or absent cached document from silently replacing an existing vault.

The versioned envelope uses Argon2id (64 MiB, three iterations, one lane) for the password-derived key, random salts, and AES-256-GCM with fresh random nonces. A random master key is wrapped separately for password and recovery access. Journal and media records use random per-record keys wrapped by the master key; authenticated data binds records to their owner and identifiers. Passwords, recovery secrets, and unwrapped keys are not intentionally persisted or sent to Firebase. The unlocked key is held in application memory. JavaScript applications remain vulnerable to malicious scripts or a compromised browser/device; this implementation has not received an independent security audit. Google Fonts is an existing third-party stylesheet request and should be considered in a privacy review.

## Journals and media

Journal edits are encrypted before a local IndexedDB checkpoint, normally after a 250 ms debounce. The editor reports local persistence only after IndexedDB commits. Cloud writes are delayed approximately one second and use Firestore revision-checking transactions. Pending encrypted branches are retried while the app is open and after reconnecting. If another device changed the same journal, both versions remain available in My Journal; the local version can be opened or saved as a separate journal. The original conflict branch is retained. Removing a referenced photo queues authorized cleanup after the cloud journal revision commits.

Photos are encrypted and committed to an account-scoped local queue before insertion. Their encrypted bytes are uploaded to owner-scoped immutable Storage paths before a journal referencing them is synchronized. Failed uploads leave the encrypted local photo and journal branch in place for retry. The existing editor preserves its supported image position, size, and tape notes. JPEG, PNG, WebP, and GIF files up to 12 MiB are supported. New photos are decoded and resized locally, with a metadata-free encoding or a verified small PNG. Encrypted uploads require a matching quota reservation. See [media accounting](docs/ai/OVI_FIREBASE_MEDIA_QUOTAS.md).

Journal content, titles, dates, formatting, and image references are encrypted. Firestore retains operational metadata including revision and timestamps. The current rules limit a journal's encrypted payload to 800,000 base64 characters; an oversized entry remains saved locally and is marked unable to sync until shortened. Browser storage may be cleared or evicted, and asynchronous writes cannot be guaranteed during sudden shutdown; wait for the local-save indicator before closing. Vault metadata is read from the server during session restoration, so an offline user who refreshes may need internet access before unlocking again.

Older versions stored journal drafts and photos unencrypted in the `ovi-journal` IndexedDB database. My Journal offers an explicit import into the currently signed-in account. Import encrypts copies, uses stable IDs to avoid duplicate imports, checks the server copy when available, and retains the original local records even after a successful import. Keep those originals until cloud verification is complete. The originals remain plaintext until the user independently removes browser data; do not clear site data while unsynced work remains.

## Firebase data and rules

- `users/{uid}/account/profile` and `users/{uid}/account/vault` hold minimal profile metadata and wrapped keys.
- `users/{uid}/journals/{journalId}` holds encrypted journal records and revision/timestamp metadata.
- `users/{uid}/journal-media/{journalId}/{mediaId}` holds encrypted Storage objects.
- `users/{uid}/conversations/{conversationId}/messages/{messageId}` holds encrypted user and assistant turns. Firestore stores the role and text inside the existing Vault envelope. Server-owned operational collections hold usage counts and reservations.

The included Firestore and Storage rules deny access by default, restrict reads and writes to the authenticated UID, validate the implemented record shapes, enforce journal revision increments, and deny deletion. Storage permits immutable writes matching an unexpired server-issued reservation. The trusted deletion route reconciles the actual object and its quota. Server rules cannot prove that a client actually encrypted a byte stream. The rules also deliberately deny currently unimplemented document types.

**Do not deploy without first comparing these rules with the existing project's deployed rules and confirming that they will not disrupt other clients.** Deployment was not performed automatically. After review and successful tests, a maintainer can deploy to the existing project with `npx firebase deploy --project <existing-project-id> --only firestore:rules,firestore:indexes,storage` and then redeploy the Netlify site. Verify the project and bucket before running the command.

## Verification

- `npm run typecheck`
- `npm run build`
- `npm run test:ai`
- `npm run test:browser` (local Chrome and Firebase emulators)
- `npm run test:dates`
- `npm run test:vault`
- `npm run test:checkpoints`
- `npm run test:emulators` (starts disposable Auth, Firestore, and Storage emulators using the `demo-ovi` project; needs Java and emulator binaries)

The emulator suite checks owner isolation, shape/revision/deletion restrictions, encrypted storage, vault creation, local restoration, an offline queue, photo ciphertext, legacy import, and conflicting journal branches. Its accounts are emulator-only. Before production use, also test real Google popup sign-in, account recovery, refresh/new-tab behavior, browser quota and shutdown failures, image upload interruptions, and concurrent editing on the target devices. Arrange an independent review of the cryptographic design, rules, application security, and deployment configuration.
