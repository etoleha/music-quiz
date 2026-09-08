import VideoQuiz from "../../../video-quiz";
export const dynamic = "force-dynamic";
export default async function GuestVideo({ params }: { params: Promise<{ token: string }> }) {
  return <main className="shell"><header className="topbar"><div className="wordmark">НЕ ПО ПРИПЕВУ</div><span>Гостевой видеоквиз</span></header><VideoQuiz shareToken={(await params).token} /></main>;
}
