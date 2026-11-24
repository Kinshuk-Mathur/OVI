# Research and verification notes

## Trace a conversation in the code

1. Read `components/talk/use-conversation.ts` for the send, stop, restore and retry lifecycle. `lib/conversations/repository.ts` binds each encrypted record to its user, conversation and message ID.
2. Follow `app/api/ai/chat/route.ts` into `lib/ai/context.ts`. The V1 personality and stable journal, script-matching and safety guidance occupy 1,319 o200k tokens before dynamic input.
3. Read `lib/server/quota.ts` alongside [the quota guide](OVI_RATE_LIMITING.md). Compare the reservation transaction with settlement after success, definite rejection and an uncertain network failure.
4. Inspect `lib/ai/provider.ts` and `lib/ai/stream.ts` for the boundary between Groq events and public response frames. The completion frame is what permits the browser to save an assistant turn.
5. Follow `lib/voice/recorder.ts` from microphone permission to a bounded WAV. The voice route computes seconds from validated samples. Follow `lib/journal/photo-sync.ts` to see how a blocked photo can stay local while text synchronizes.

## Repeatable checks

Run from the repository root with Node 22 or newer. Firebase emulator suites need Java 21 and local loopback ports. The browser suite starts its own Next server on port 3016 and uses installed Chrome. All test accounts, conversations and recordings in these suites are synthetic.

| Command | Evidence |
| --- | --- |
| `npm run typecheck` and `npm run build` | Strict TypeScript and a production App Router build |
| `npm run test:ai` | Stable context, role validation, journal selection, split Unicode streams, missing usage, cancellation, error sanitization and WAV boundaries |
| `npm run test:vault`, `npm run test:dates`, `npm run test:checkpoints` | Existing encryption, recovery, calendar and local checkpoint regressions |
| `npm run test:emulators` | Real Firebase token verification and rules, cross-owner denial, UTC reset and rolling quotas, concurrent reservations, refusal at the cap, settlement, legacy media, deletion, and text sync with a full photo allowance |
| `npm run test:browser` | Google provider emulator, Vault creation/lock/unlock, live components, encrypted history in a fresh browser, microphone denial/cancel, editable transcript, journal selection, and desktop/mobile screenshots |

The emulator route tests substitute only the upstream Groq response. The browser layout test substitutes OVI stream frames with the exact reference conversation, so wording and line breaks are repeatable. Its voice test records a virtual microphone and returns a fixed transcript. The browser also opens a journal through the normal editor, sends the explicitly selected text once, and preserves a later user message after a simulated service failure.

## Language and safety evaluation

`tests/ai-evaluations.json` contains nine reproducible dialogues and qualitative rubrics for Hinglish, Hindi, English, continuity, uncertainty, unwanted advice, boundaries and credible risk. After configuring a working server key, run one synthetic case at a time with `node --import tsx tests/live-groq.ts 0` (indices 0–8). The script makes a real paid-provider request and prints the synthetic response for human review. Test an authorized synthetic recording using `node --import tsx tests/live-groq.ts voice /path/to/sample.wav`. Keep outputs out of production logs.

The updated server key returned HTTP 200 for GPT-OSS 120B. A live synthetic Hinglish reply initially switched scripts. Explicit script-matching guidance in the stable prefix produced a Romanized reply to the same case. In early samples the model occasionally asked multiple follow-up questions. One code-switching reply also slipped back into Devanagari for part of a sentence. Review conversational quality across repeated runs and with native speakers.

All nine authenticated live chat cases streamed to completion. The real account summary in the emulator showed 21 of 30 messages remaining and 590 of 600 voice seconds remaining after the three recordings. All twelve reservations settled. Firestore contained ciphertext and a fresh Vault unlock restored the first assistant reply exactly. One chat reservation reported a cache hit; the other eight omitted cached-token details.

The initial safety evaluation offered an unsupported regional contact and lookup. Follow-up tests led to specific guidance about the missing location and resource directory. The final retest encouraged immediate local emergency support and a trusted person nearby without naming unverified numbers. This single result does not establish clinical safety or guarantee future answers.

Whisper transcribed short synthetic English, Hindi and mixed-language recordings. In the Hindi sample it rendered “झील” as “जील”. The first mixed recording came back entirely in English. With the final transcription hint, the same recording retained both languages (“Aaj college mein presentation tha and it went really well.”). These are small synthetic smoke tests, not an accuracy benchmark. The editable composer lets users correct the result before sending.

To exercise the authenticated live path, start fresh local Firebase emulators with `firebase emulators:exec --only auth,firestore,storage --project demo-ovi 'node --import tsx tests/live-routes.ts /path/to/english.wav /path/to/hindi.wav /path/to/hinglish.wav'`. Run only with synthetic, authorized WAV files and a working Groq key. The script verifies identity, actual Groq output, receipt of stream frames, encrypted user/assistant persistence, restoration after a fresh Vault unlock and settlement of quota tickets. Its modest local budget settings apply only to the disposable evaluation.

Deployment-specific checks include real Google OAuth on the deployed domain, Netlify function streaming, physical device keyboards, Firebase IAM and the organization's Groq limits and retention configuration.

## Visual comparison

The desktop reference is 1672 × 941. The rendered view uses a 246 px sidebar, a 976 px message column and a 928 × 78 px single-line composer at that size. The mobile baseline is 390 × 844, with a second short-viewport assertion for composer visibility. The crops retain the original landscape artwork; chat surfaces, text and controls are live DOM elements.

[Desktop conversation](screenshots/chat-desktop.png) · [Mobile conversation](screenshots/chat-mobile.png) · [Initial welcome](screenshots/welcome-desktop.png)


## Dependency review

The production dependency audit after the Next.js and Firebase Admin updates reported zero high and zero critical findings. The remaining moderate reports trace to the existing TipTap 2 editor's core dependency. npm proposes a major editor upgrade. Treat that migration as separate work with compatibility testing for existing journals, formatting, photo nodes and autosave. [TipTap advisory](https://github.com/advisories/GHSA-cp6q-959q-f8rh)
