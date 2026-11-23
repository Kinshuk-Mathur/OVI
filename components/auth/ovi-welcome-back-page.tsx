"use client";

import { useState, type FormEvent } from "react";
import { Eye, EyeOff } from "lucide-react";
import { OVILogo } from "@/components/ovi-logo";
import layout from "./ovi-login-page.module.css";
import styles from "./ovi-welcome-back-page.module.css";

interface OviWelcomeBackPageProps {
  displayName: string | null;
  password: string;
  onPasswordChange: (value: string) => void;
  onUnlock: (event: FormEvent<HTMLFormElement>) => void;
  onRecover: () => void;
  onSwitchAccount: () => void;
  onRetry: () => void;
  isLoading: boolean;
  isRestoring: boolean;
  hasVault: boolean;
  error: string;
}

export function OviWelcomeBackPage({ displayName, password, onPasswordChange, onUnlock, onRecover, onSwitchAccount, onRetry, isLoading, isRestoring, hasVault, error }: OviWelcomeBackPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const name = displayName?.trim();
  return <main className={layout.page}>
    <section className={`${layout.welcome} ${styles.welcome}`} aria-labelledby="welcome-back-heading">
      <div className={styles.brand}><OVILogo /></div>
      <div className={`${layout.content} ${styles.content}`}>
        <h1 id="welcome-back-heading" className={styles.heading}>Welcome back{name ? <>,<span className={styles.name}>{name}</span></> : "."}</h1>
        <p className={styles.description}>Your thoughts are right where you left them.</p>
        <form className={styles.form} onSubmit={onUnlock}>
          <label htmlFor="vault-password">Your OVI password</label>
          <div className={styles.passwordField}>
            <input id="vault-password" type={showPassword ? "text" : "password"} autoComplete="current-password" maxLength={1024} required value={password} disabled={isLoading || isRestoring || !hasVault} onChange={(event) => onPasswordChange(event.target.value)} />
            <button type="button" className={styles.passwordToggle} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} disabled={isLoading || isRestoring || !hasVault} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}</button>
          </div>
          <button type="submit" className={styles.primary} disabled={isLoading || isRestoring || !hasVault} aria-busy={isLoading}>{isLoading ? "Unlocking…" : "Unlock OVI"}</button>
        </form>
        <div className={styles.actions}>
          {hasVault && <button type="button" onClick={onRecover} disabled={isLoading}>Forgot your password?</button>}
          {!isRestoring && !hasVault && <button type="button" onClick={onRetry}>Try again</button>}
          <button type="button" onClick={onSwitchAccount} disabled={isLoading}>Use another Google account</button>
        </div>
        <div className={styles.feedback} aria-live="polite">
          {isRestoring && <p role="status">Opening your vault…</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      </div>
    </section>
    <div className={layout.art} aria-hidden="true"><img src="/ovi-welcome-back-art.webp" width="1181" height="1331" alt="" /></div>
  </main>;
}
