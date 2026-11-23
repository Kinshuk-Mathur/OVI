import { OVILogo } from "@/components/ovi-logo";
import styles from "./ovi-login-page.module.css";

interface OviLoginPageProps {
  onSignIn: () => void;
  isLoading: boolean;
  error: string;
}

export function OviLoginPage({ onSignIn, isLoading, error }: OviLoginPageProps) {
  return (
    <main className={styles.page}>
      <section className={styles.welcome} aria-labelledby="login-heading">
        <div className={styles.content}>
          <h1 id="login-heading" className={styles.heading}>Welcome to</h1>
          <div className={styles.brand}><OVILogo /></div>
          <p className={styles.description}>
            A calm, thoughtful space for your<br className={styles.desktopBreak} /> ideas, feelings, and everyday conversations.
          </p>
          <button className={styles.googleButton} type="button" onClick={onSignIn} disabled={isLoading} aria-busy={isLoading}>
            <span className={styles.googleIcon}><img src="/google-g.svg" alt="" width="40" height="40" /></span>
            <span>{isLoading ? "Connecting to Google…" : "Continue with Google"}</span>
          </button>
          <div className={styles.feedback} aria-live="polite">
            {isLoading && <span className={styles.screenReaderOnly}>Opening your space…</span>}
            {error && <p role="alert">{error}</p>}
          </div>
        </div>
      </section>
      <div className={styles.art} aria-hidden="true">
        <img src="/ovi-login-right-art.webp" alt="" width="835" height="941" />
      </div>
    </main>
  );
}
