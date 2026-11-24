import { Talk } from "@/components/talk/talk";
import "./talk.css";
import { IllustratedBackground } from "@/components/illustrated-background";
import { OVISidebar } from "@/components/ovi-sidebar";
import { UserControls } from "@/components/user-controls";

export default function TalkPage() {
  return (
    <div className="app-shell talk-shell">
      <OVISidebar />
      <main className="talk-page" id="talk">
        <IllustratedBackground />
        <div className="desktop-avatar"><UserControls compact /></div>
        <Talk />
      </main>
    </div>
  );
}
