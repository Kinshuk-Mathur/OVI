import Link from "next/link";
import { BookOpen, MessageCircle } from "lucide-react";
import { OVILogo } from "./ovi-logo";
import { UserControls } from "./user-controls";

export function OVISidebar({ active = "talk" }: { active?: "talk" | "journal" }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-top"><OVILogo /><div className="mobile-avatar"><UserControls showFullscreen={active !== "journal"} /></div></div>
      <nav className="navigation" aria-label="Main navigation">
        <Link className={`nav-item${active === "talk" ? " active" : ""}`} href="/" aria-current={active === "talk" ? "page" : undefined}><MessageCircle aria-hidden="true" /><span className="desktop-label">Talk to OVI</span><span className="mobile-label">Talk</span></Link>
        <Link className={`nav-item${active === "journal" ? " active" : ""}`} href="/journal" aria-current={active === "journal" ? "page" : undefined}><BookOpen aria-hidden="true" /><span>Journal</span></Link>
      </nav>
      <div className="sidebar-art" aria-hidden="true" />
    </aside>
  );
}
