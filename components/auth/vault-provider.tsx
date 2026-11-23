"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { getAdditionalUserInfo, onAuthStateChanged, signOut, type User } from "firebase/auth";
import { JournalProvider } from "@/components/journal/journal-provider";
import { OviLoginPage } from "./ovi-login-page";
import { OviWelcomeBackPage } from "./ovi-welcome-back-page";
import { OVILogo } from "@/components/ovi-logo";
import { getFirebaseServices, signInWithGoogle } from "@/lib/firebase/client";
import { createVault, recoverVault, unlockVault, type VaultMetadata } from "@/lib/security/vault";
import { createVaultOnce, loadVault, updateVaultAfterRecovery } from "@/lib/firebase/repository";

interface Session { user: User; masterKey: CryptoKey }
const VaultContext = createContext<{ session: Session; lock: () => Promise<boolean> } | null>(null);
export function useVault() {
  const context = useContext(VaultContext);
  if (!context) throw new Error("Vault is locked.");
  return context;
}
type Stage = "initializing" | "signed-out" | "loading" | "restoring" | "restore-error" | "setup" | "recovery-key" | "locked" | "recovering" | "unlocked";

export function VaultProvider({ children }: { children: ReactNode }) {
  const [stage, setStage] = useState<Stage>("initializing");
  const [user, setUser] = useState<User | null>(null);
  const [metadata, setMetadata] = useState<VaultMetadata | null>(null);
  const [masterKey, setMasterKey] = useState<CryptoKey | null>(null);
  const [pending, setPending] = useState<Awaited<ReturnType<typeof createVault>> | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [recovery, setRecovery] = useState("");
  const [savedRecovery, setSavedRecovery] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [locking, setLocking] = useState(false);
  const [existingAccount, setExistingAccount] = useState(false);
  const busyRef = useRef(false);
  const authGenerationRef = useRef(0);
  const clearSecrets = useCallback(() => { setPassword(""); setConfirmation(""); setRecovery(""); setPending(null); }, []);
  const lock = useCallback(async () => {
    // Freeze input while the active editor commits its latest checkpoint.
    const generation = authGenerationRef.current;
    flushSync(() => setLocking(true));
    const detail: { promises: Promise<boolean>[] } = { promises: [] };
    window.dispatchEvent(new CustomEvent("ovi:flush", { detail }));
    const results = await Promise.all(detail.promises);
    if (results.some((success) => !success)) { setLocking(false); return false; }
    if (generation !== authGenerationRef.current) { setLocking(false); return false; }
    setMasterKey(null); clearSecrets(); setStage("locked"); setError("");
    setLocking(false);
    return true;
  }, [clearSecrets]);
  const restoreVault = useCallback(async (current: User, generation: number) => {
    setStage("restoring");
    setError("");
    try {
      // A server read is required: a missing cached document is not a new vault.
      const vault = await loadVault(current.uid);
      if (generation !== authGenerationRef.current) return;
      setMetadata(vault);
      setStage(vault ? "locked" : "setup");
    } catch {
      if (generation !== authGenerationRef.current) return;
      setMetadata(null);
      setStage("restore-error");
      setError("We couldn’t open your vault right now. Check your connection and try again.");
    }
  }, []);
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let active = true;
    try {
      const auth = getFirebaseServices().auth;
      unsubscribe = onAuthStateChanged(auth, (current) => {
        if (!active) return;
        const generation = ++authGenerationRef.current;
        setMasterKey(null);
        setMetadata(null);
        clearSecrets();
        if (!current) {
          setUser(null);
          setError("");
          setStage("signed-out");
          return;
        }
        setUser(current);
        setExistingAccount(true);
        void restoreVault(current, generation);
      });
      void auth.authStateReady().catch(() => {
        if (active) { setStage("signed-out"); setError("We couldn’t restore your sign-in. Please try again."); }
      });
    } catch {
      setStage("signed-out");
      setError("Firebase configuration is missing from this build. Check the local environment settings.");
    }
    return () => { active = false; authGenerationRef.current++; unsubscribe?.(); };
  }, [clearSecrets, restoreVault]);
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try { await action(); } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      if (message.includes("Firebase configuration")) setError("Firebase configuration is missing from this build. Check the local environment settings.");
      else if (code === "auth/popup-blocked") setError("Your browser blocked the Google sign-in window. Allow pop-ups for OVI and try again.");
      else setError("Something went wrong. Please check your connection and try again. Your existing vault has not been changed.");
    }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function signIn() {
    await run(async () => {
      setStage("loading");
      try {
        const credential = await signInWithGoogle();
        setExistingAccount(!getAdditionalUserInfo(credential)?.isNewUser);
      } catch (error) { setStage("signed-out"); throw error; }
    });
  }
  function switchAccount() {
    void run(async () => { await signOut(getFirebaseServices().auth); });
  }
  function setup(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    if (password.length < 12 || password.length > 1024) { setError("Choose a password of at least 12 characters."); return; }
    if (password !== confirmation) { setError("Your passwords do not match."); return; }
    const generation = authGenerationRef.current;
    void run(async () => { const result = await createVault(user.uid, password); if (generation !== authGenerationRef.current) return; clearSecrets(); setPending(result); setSavedRecovery(false); setStage("recovery-key"); });
  }
  function finishSetup() {
    if (!user || !pending || !savedRecovery) return;
    const generation = authGenerationRef.current;
    void run(async () => { await createVaultOnce(user.uid, pending.metadata, user.displayName ?? ""); if (generation !== authGenerationRef.current) return; setMetadata(pending.metadata); setMasterKey(pending.masterKey); clearSecrets(); setStage("unlocked"); });
  }
  function unlock(event: FormEvent) {
    event.preventDefault();
    if (!user || !metadata) return;
    if (busyRef.current) return;
    const generation = authGenerationRef.current;
    busyRef.current = true; setBusy(true); setError("");
    void unlockVault(user.uid, password, metadata).then((key) => { if (generation === authGenerationRef.current) { setPassword(""); setMasterKey(key); setStage("unlocked"); } }).catch(() => { if (generation === authGenerationRef.current) setError("That password could not unlock your vault. Please try again."); })
      .finally(() => { busyRef.current = false; setBusy(false); });
  }
  function recover(event: FormEvent) {
    event.preventDefault();
    if (!user || !metadata) return;
    if (password.length < 12 || password.length > 1024) { setError("Choose a password of at least 12 characters."); return; }
    if (password !== confirmation) { setError("Your passwords do not match."); return; }
    if (busyRef.current) return;
    const generation = authGenerationRef.current;
    busyRef.current = true; setBusy(true); setError("");
    void (async () => {
      let result: Awaited<ReturnType<typeof recoverVault>>;
      try { result = await recoverVault(user.uid, recovery, password, metadata); }
      catch { if (generation === authGenerationRef.current) setError("The recovery key could not unlock your vault. Please check it and try again."); return; }
      if (generation !== authGenerationRef.current) return;
      try { await updateVaultAfterRecovery(user.uid, result.metadata, metadata.revision); }
      catch { if (generation === authGenerationRef.current) setError("Your password could not be updated. Check your connection and try again; your existing vault is unchanged."); return; }
      if (generation !== authGenerationRef.current) return;
      setMetadata(result.metadata); setMasterKey(result.masterKey); clearSecrets(); setStage("unlocked");
    })().finally(() => { busyRef.current = false; setBusy(false); });
  }
  if (stage === "unlocked" && user && masterKey) return <VaultContext.Provider value={{ session: { user, masterKey }, lock }}><JournalProvider><div inert={locking}>{children}</div></JournalProvider></VaultContext.Provider>;
  if (stage === "initializing") return <main className="vault-shell"><p role="status">Opening your space…</p></main>;
  if (stage === "signed-out" || stage === "loading") return <OviLoginPage onSignIn={() => void signIn()} isLoading={busy || stage === "loading"} error={error} />;
  if (stage === "locked" || stage === "restoring" || stage === "restore-error") return <OviWelcomeBackPage displayName={user?.displayName ?? null} password={password} onPasswordChange={setPassword} onUnlock={unlock} onRecover={() => { clearSecrets(); setError(""); setStage("recovering"); }} onSwitchAccount={switchAccount} onRetry={() => { if (user) void restoreVault(user, ++authGenerationRef.current); }} isLoading={busy} isRestoring={stage === "restoring"} hasVault={Boolean(metadata)} error={error} />;
  return <main className="vault-shell"><div className="vault-card"><OVILogo />
    {stage === "setup" && <><h1>A space that’s yours.</h1>{existingAccount && <p>No vault was found for this Google account. Creating one cannot recover a vault from a different account. Continue only if you intend to create a new vault.</p>}<form onSubmit={setup}><label>Create your OVI password<input type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={password} onChange={(e) => setPassword(e.target.value)} /></label><label>Confirm your password<input type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label><button className="vault-primary" disabled={busy}>Create my Vault</button></form><button className="vault-link" onClick={switchAccount} disabled={busy}>Use another Google account</button></>}
    {stage === "recovery-key" && pending && <><h1>Keep your memories safe.</h1><p>Save this recovery key somewhere safe. If you lose both your password and recovery key, your encrypted journals may be unrecoverable.</p><code className="recovery-key">{pending.recoveryKey}</code><button type="button" className="vault-link" onClick={() => void navigator.clipboard.writeText(pending.recoveryKey).catch(() => setError("Copy was unavailable. Select and copy the key instead."))}>Copy recovery key</button><label className="vault-checkbox"><input type="checkbox" checked={savedRecovery} onChange={(e) => setSavedRecovery(e.target.checked)} />I saved my recovery key securely.</label><button className="vault-primary" disabled={!savedRecovery || busy} onClick={finishSetup}>Continue to OVI</button></>}
    {stage === "recovering" && <><h1>Recover your vault.</h1><p>Your recovery key lets you create a new password without losing your journals. Without either, your encrypted journals may be unrecoverable.</p><form onSubmit={recover}><label>Recovery key<input type="password" autoComplete="off" required value={recovery} onChange={(e) => setRecovery(e.target.value)} /></label><label>New OVI password<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={password} onChange={(e) => setPassword(e.target.value)} /></label><label>Confirm new password<input type="password" autoComplete="new-password" required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></label><button className="vault-primary" disabled={busy}>Recover my Vault</button></form><button className="vault-link" onClick={() => { clearSecrets(); setError(""); setStage("locked"); }}>Back to unlock</button></>}
    {busy && <p role="status">Please wait…</p>}{error && <p className="vault-error" role="alert">{error}</p>}
  </div></main>;
}
