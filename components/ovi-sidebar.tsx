"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type MouseEvent } from "react";
import { BookOpen, MessageCircle } from "lucide-react";
import { OVILogo } from "./ovi-logo";
import { UserControls } from "./user-controls";

export function OVISidebar({ active = "talk" }: { active?: "talk" | "journal" }) {
  const router = useRouter();
  const navigating = useRef(false);
  const [notice, setNotice] = useState("");
  async function navigate(event: MouseEvent<HTMLAnchorElement>, destination: string) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (navigating.current) return;
    navigating.current = true;
    try {
      const detail: { promises: Promise<boolean>[] } = { promises: [] };
      window.dispatchEvent(new CustomEvent("ovi:flush", { detail }));
      if ((await Promise.all(detail.promises)).some((saved) => !saved)) { setNotice("Finish adding your photo or save your changes before leaving."); return; }
      setNotice(""); router.push(destination);
    } finally { navigating.current = false; }
  }
  return <aside className="sidebar">
    <div className="sidebar-top"><OVILogo /><div className="mobile-avatar"><UserControls compact={active === "talk"} showFullscreen={active !== "journal"} /></div></div>
    <nav className="navigation" aria-label="Main navigation">
      <Link className={`nav-item${active === "talk" ? " active" : ""}`} href="/" onClick={(event) => void navigate(event, "/")} aria-current={active === "talk" ? "page" : undefined}><MessageCircle aria-hidden="true" /><span className="desktop-label">Talk to OVI</span><span className="mobile-label">Talk</span></Link>
      <Link className={`nav-item${active === "journal" ? " active" : ""}`} href="/journal" onClick={(event) => void navigate(event, "/journal")} aria-current={active === "journal" ? "page" : undefined}><BookOpen aria-hidden="true" /><span>Journal</span></Link>
      {notice && <p className="sidebar-save-notice" role="alert">{notice}</p>}
    </nav><div className="sidebar-art" aria-hidden="true" />
  </aside>;
}
