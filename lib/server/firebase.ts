/** Lazy server-only Firebase services for verifying ID tokens, transacting on operational data and inspecting Storage. */
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { PublicError } from "./http";

/** Separate trusted server identity. Browser Firebase config is public and cannot authorize quota writes. */
function adminApp() {
  if (
    process.env.NETLIFY &&
    (process.env.FIREBASE_AUTH_EMULATOR_HOST ||
      process.env.FIRESTORE_EMULATOR_HOST ||
      process.env.FIREBASE_STORAGE_EMULATOR_HOST)
  )
    throw new Error("Firebase emulators are local-only.");
  const existing = getApps().find((app) => app.name === "ovi-server");
  if (existing) return existing;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("Firebase project configuration missing");
  const credentials = process.env.FIREBASE_ADMIN_CREDENTIALS;
  const account = credentials ? JSON.parse(credentials) : undefined;
  if (account && account.project_id !== projectId) throw new Error("Firebase project mismatch");
  return initializeApp(
    {
      projectId,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      credential: account ? cert(account) : applicationDefault(),
    },
    "ovi-server",
  );
}
export const db = () => getFirestore(adminApp());
export const bucket = () => getStorage(adminApp()).bucket();
export async function authenticatedUid(request: Request) {
  const token = /^Bearer ([^\s]{1,8192})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  const denied = () => new PublicError(401, "Sign in to OVI again to continue.", undefined, "auth");
  if (!token) throw denied();
  const auth = getAuth(adminApp());
  try {
    return (await auth.verifyIdToken(token, true)).uid;
  } catch {
    throw denied();
  }
}
