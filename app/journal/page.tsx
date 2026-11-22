import { IllustratedBackground } from "@/components/illustrated-background";
import { JournalLibrary } from "@/components/journal/journal-library";
import { OVISidebar } from "@/components/ovi-sidebar";
import { UserControls } from "@/components/user-controls";

export const metadata = { title: "My Journal | OVI", description: "Your collection of journal entries." };

export default function JournalPage() {
  return <div className="app-shell journal-shell"><OVISidebar active="journal" /><main className="talk-page journal-page library-page"><IllustratedBackground /><div className="desktop-avatar"><UserControls showFullscreen={false} /></div><JournalLibrary /></main></div>;
}
