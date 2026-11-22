import { IllustratedBackground } from "@/components/illustrated-background";
import { JournalPaper } from "@/components/journal/journal-paper";
import { OVISidebar } from "@/components/ovi-sidebar";
import { UserControls } from "@/components/user-controls";

export const metadata = { title: "Write in your journal | OVI" };

export default async function JournalEntryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string; date?: string }> }) {
  const { id } = await params;
  const query = await searchParams;
  return (
    <div className="app-shell journal-shell">
      <OVISidebar active="journal" />
      <main className="talk-page journal-page">
        <IllustratedBackground />
        <div className="desktop-avatar"><UserControls showFullscreen={false} /></div>
        <JournalPaper entryId={id} isNew={query.new === "1"} requestedDate={query.date} />
      </main>
    </div>
  );
}
