const sourceUrl = process.env.QUIZ_FEEDBACK_URL || "https://quiz.lamtyugin.com/g/feedback";
const response = await fetch(sourceUrl, {
  headers: { accept: "application/json" },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`Feedback endpoint returned HTTP ${response.status}`);
const payload = await response.json();
const report = {
  collectedAt: new Date().toISOString(),
  sourceUrl,
  issues: (payload.badFragments || []).map((issue) => ({
    kind: issue.reason || "bad-fragment",
    ...issue,
  })),
  mistakes: payload.mistakes || [],
};
console.log(JSON.stringify(report, null, 2));
