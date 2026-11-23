"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useEffect, useState } from "react";
import { UserAvatar } from "./user-avatar";
import { useVault } from "@/components/auth/vault-provider";

export function UserControls({ showFullscreen = true }: { showFullscreen?: boolean }) {
  const { lock } = useVault();
  const [supported, setSupported] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSupported(Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen));
    const syncFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", syncFullscreen);
    syncFullscreen();
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  async function toggleFullscreen() {
    try {
      setError("");
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("Fullscreen is unavailable in this browser.");
    }
  }

  return <div className="user-controls">
    {showFullscreen && supported && <button className="fullscreen-button" type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>{fullscreen ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</button>}
    {error && <span className="fullscreen-error" role="status">{error}</span>}
    <button className="vault-lock-button" type="button" onClick={() => void lock().then((success) => { if (!success) setError("Finish adding your photo or save your changes before locking."); })}>Lock</button><UserAvatar />
  </div>;
}
