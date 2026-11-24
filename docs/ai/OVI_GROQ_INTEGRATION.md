# Groq and Firebase on Netlify

The existing Next.js App Router supplies Node.js route handlers. Chat uses a single outbound streaming request to Groq's chat completions endpoint. Voice uses multipart audio transcriptions. There is no fallback model, client SDK key or automatic provider retry. The adapter lives in `lib/ai/provider.ts`. The chat transport decodes UTF-8 incrementally, selects content deltas, reads terminal usage and requires a successful finish reason and stream terminator.

## Configure the existing site

1. Set the six existing `NEXT_PUBLIC_FIREBASE_*` web app settings in the Netlify build environment. Use one Firebase project and its actual default bucket. Check that Google sign-in and the Netlify domain are authorized.
2. Create a dedicated backend service account in that Firebase project. Grant Firestore data read/write (Cloud Datastore User), Firebase Authentication Viewer for revoked-token checks and Storage Object Admin scoped to the journal bucket. Keep the Google-managed Firebase Storage service agent intact. Independently review the scope if the project hosts other applications.
3. For Netlify Functions, set the secret `FIREBASE_ADMIN_CREDENTIALS` to the service-account JSON, preserving the JSON escaping in its private key. Keep it out of the repository, browser variables, logs and build output. A Google-hosted environment with an attached identity may instead use Application Default Credentials. The server checks the explicit credential's project against the web app project.
4. Set `GROQ_API_KEY` as a Functions secret. Configure the chat and transcription model IDs in the environment example. Enable access to both models in the Groq project and review its data controls.
5. Read the **actual organization limits** in the Groq console. Set `OVI_ORG_RPM`, `OVI_ORG_RPD`, `OVI_ORG_TPM` and `OVI_ORG_TPD` to safe shared ceilings. Set `OVI_ORG_AUDIO_SECONDS_HOUR` and `OVI_ORG_AUDIO_SECONDS_DAY` for Whisper. Budget for other applications that share the account. The proposed beta 6,000 TPM and 150,000 TPD are examples only. Missing budgets close the affected route. [Groq limits](https://console.groq.com/settings/organization/limits)
6. Compare deployed rules with this repository and coordinate rollout of the app and Storage rules. Grant Firebase Storage Rules permission to read Firestore when prompted in the Firebase console. Old upload clients will need the new reservation flow. In the target project deploy the reviewed Firestore and Storage rules using the command in the root README. [Firebase Storage rules](https://firebase.google.com/docs/storage/security/rules-conditions)
7. Redeploy using Netlify's Next.js runtime. Disable every Firebase emulator setting in production. Verify streaming time-to-first-text, function duration, voice body limits, cancellation and a real OAuth/Vault round trip on the deployed domain. Use separate credentials and quotas for preview environments.

A signed-out POST to `/api/ai/chat` should return HTTP 401 with JSON and `code: "auth"`. An HTML 500 on this request means the deployment failed before the normal API response. Use its `x-nf-request-id` to find the function log. The Next build bundles Firebase Admin’s Auth module and its ES module dependencies for Lambda compatibility. Run `npm run build` followed by `npm run test:runtime` to exercise the compiled handler under the same module restriction.

HTTP 401 on an OVI route means the Firebase identity needs attention. A Groq credential rejection is a sanitized service failure. HTTP 429 identifies a personal limit or shared capacity, with a reset or retry time when known. Never attach raw provider error bodies or request payloads to telemetry.

## Local development with live Groq

For an interactive local chat without a production Firebase service account, use a dedicated emulator configuration. Supply the six public Firebase web settings for `demo-ovi`, with `demo-ovi.appspot.com` as the bucket and nonempty dummy values for the web API key, sender ID and app ID. Set `NEXT_PUBLIC_FIREBASE_USE_EMULATORS=true` for that local process. Keep the Groq key in the ignored environment file and supply verified organization budgets as described above.

Start the app as the child of the emulator command so Firebase Admin and the browser connect to the same demo project. The Firebase CLI exports the Auth, Firestore and Storage emulator locations to that child.

```sh
npx firebase emulators:exec --only auth,firestore,storage --project demo-ovi 'npm run dev'
```

For a manually started Next server, explicitly export `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`, `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and `FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199` in addition to the local browser settings. The managed browser and integration test scripts already supply their own demo configuration.
