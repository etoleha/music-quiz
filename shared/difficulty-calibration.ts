export type DifficultyEvidence = {
  attempts: number;
  artistSuccesses: number;
  titleSuccesses: number;
};

export type DifficultyCalibration = DifficultyEvidence & {
  artistAccuracy: number;
  titleAccuracy: number;
  weightedAccuracy: number;
  difficulty: number;
  confidence: number;
};

export function calibrateDifficulty(
  evidence: DifficultyEvidence,
  priorDifficulty = 50,
  priorStrength = 6,
): DifficultyCalibration {
  const attempts = Math.max(0, evidence.attempts);
  const priorAccuracy = 1 - Math.max(0, Math.min(100, priorDifficulty)) / 100;
  const denominator = attempts + priorStrength;
  const artistAccuracy = denominator
    ? (evidence.artistSuccesses + priorAccuracy * priorStrength) / denominator
    : priorAccuracy;
  const titleAccuracy = denominator
    ? (evidence.titleSuccesses + priorAccuracy * priorStrength) / denominator
    : priorAccuracy;
  const weightedAccuracy = (artistAccuracy * 2 + titleAccuracy) / 3;
  return {
    ...evidence,
    attempts,
    artistAccuracy: Number(artistAccuracy.toFixed(4)),
    titleAccuracy: Number(titleAccuracy.toFixed(4)),
    weightedAccuracy: Number(weightedAccuracy.toFixed(4)),
    difficulty: Math.round((1 - weightedAccuracy) * 100),
    confidence: Number((attempts / denominator || 0).toFixed(4)),
  };
}
