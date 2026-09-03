import { getQuiz } from "../../quiz-data";
import { createOrReuseShare } from "../../../server/shares";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { quizId?: string };
    if (!body.quizId || !getQuiz(body.quizId)) {
      return Response.json({ error: "Квиз не найден" }, { status: 404 });
    }
    const token = createOrReuseShare(body.quizId);
    return Response.json({ path: `/g/${token}` });
  } catch (error) {
    console.error("share creation failed", error);
    return Response.json({ error: "Не удалось создать ссылку" }, { status: 500 });
  }
}
