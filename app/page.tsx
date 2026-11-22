import { ChatComposer } from "@/components/chat-composer";
import { JournalContext } from "@/components/journal/journal-context";
import { Greeting } from "@/components/greeting";
import { IllustratedBackground } from "@/components/illustrated-background";
import { OVISidebar } from "@/components/ovi-sidebar";
import { UserControls } from "@/components/user-controls";

export default function TalkPage() {
  return (
    <div className="app-shell">
      <OVISidebar />
      <main className="talk-page" id="talk">
        <IllustratedBackground />
        <div className="desktop-avatar"><UserControls /></div>
        <div className="welcome-content">
          <Greeting />
          <JournalContext />
          <ChatComposer />
        </div>
      </main>
    </div>
  );
}
