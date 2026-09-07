export const artistScoreWeight = 2;
export const titleScoreWeight = 1;
export const trackMaxScore = artistScoreWeight + titleScoreWeight;

export function weightedAnswerScore(artistPoint: number, titlePoint: number) {
  return artistPoint * artistScoreWeight + titlePoint * titleScoreWeight;
}

export function scoreToAnswerPoints(score: number) {
  if (score === titleScoreWeight) return { artistPoint: 0, titlePoint: 1 };
  if (score === artistScoreWeight) return { artistPoint: 1, titlePoint: 0 };
  if (score === trackMaxScore) return { artistPoint: 1, titlePoint: 1 };
  return { artistPoint: 0, titlePoint: 0 };
}
