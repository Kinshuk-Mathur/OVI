"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { browserPopupRedirectResolver, connectAuthEmulator, initializeAuth, GoogleAuthProvider, inMemoryPersistence, signInWithPopup, type Auth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, type Firestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage, type FirebaseStorage } from "firebase/storage";

export interface FirebaseServices { app: FirebaseApp; auth: Auth; db: Firestore; storage: FirebaseStorage }
let services: FirebaseServices | undefined;

/** Construct lazily in the browser so incomplete deployments fail closed. */
export function getFirebaseServices(): FirebaseServices {
  if (services) return services;
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  };
  if (Object.values(config).some((value) => !value)) throw new Error("Firebase configuration is incomplete.");
  const app = getApps().find((candidate) => candidate.name === "[DEFAULT]") ?? initializeApp(config);
  if (app.options.projectId !== config.projectId || app.options.authDomain !== config.authDomain || app.options.storageBucket !== config.storageBucket || app.options.appId !== config.appId) throw new Error("Firebase configuration does not match the initialized app.");
  const auth = initializeAuth(app, { persistence: inMemoryPersistence }), db = getFirestore(app), storage = getStorage(app);
  if (process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === "true") {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
    connectStorageEmulator(storage, "127.0.0.1", 9199);
  }
  services = { app, auth, db, storage };
  return services;
}

/** Popup is intentional: redirect cannot reliably retain memory-only auth state. */
export async function signInWithGoogle() {
  const { auth } = getFirebaseServices();
  return signInWithPopup(auth, new GoogleAuthProvider(), browserPopupRedirectResolver);
}
