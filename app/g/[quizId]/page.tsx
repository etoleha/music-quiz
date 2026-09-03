import MusicQuiz from "../../music-quiz";
import { notFound } from "next/navigation";
import { getGuestShare } from "../../../server/shares";

export default async function GuestQuizPage({ params }: { params: Promise<{ quizId: string }> }) {
  const { quizId: token } = await params;
  const share = getGuestShare(token);
  if (!share) notFound();
  return <MusicQuiz initialQuizId={share.quizId} guestMode comparison={share.comparison} excludedTrackKeys={share.excludedTrackKeys} />;
}
