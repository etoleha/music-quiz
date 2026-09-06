export const CHECK_STATES = new Set(["missing", "automatic", "verified", "failed", "stale", "not-applicable"]);

export const REQUIRED_PUBLICATION_CHECKS = [
  "identity",
  "release",
  "artwork",
  "artistImage",
  "youtube",
  "fragment",
  "relationships",
  "difficulty",
  "credits",
  "soundtrack",
];

const objectOrNull = (value) => value && typeof value === "object" && !Array.isArray(value);

export function validatePublicationVerification(document) {
  if (!objectOrNull(document) || !objectOrNull(document.songs)) {
    throw new Error("song-publication-verification.json must contain a songs object");
  }
  for (const [songId, record] of Object.entries(document.songs)) {
    if (!objectOrNull(record.checks)) throw new Error(`${songId}: checks are required`);
    for (const [name, check] of Object.entries(record.checks)) {
      if (!objectOrNull(check) || !CHECK_STATES.has(check.state)) {
        throw new Error(`${songId}.${name}: invalid check state`);
      }
      if (check.sources !== undefined && (!Array.isArray(check.sources) || check.sources.some((url) => typeof url !== "string" || !/^https?:\/\//u.test(url)))) {
        throw new Error(`${songId}.${name}: sources must contain web URLs`);
      }
    }
    if (record.relationships?.conflictEntityIds && !Array.isArray(record.relationships.conflictEntityIds)) {
      throw new Error(`${songId}: conflictEntityIds must be an array`);
    }
  }
  return document;
}

export const blockingPublicationChecks = (record = {}) => REQUIRED_PUBLICATION_CHECKS.filter((name) => {
  const state = record.checks?.[name]?.state;
  return state !== "verified" && state !== "not-applicable";
});

export function lifecycleFor(record = {}) {
  if (record.disposition === "rejected") return "rejected";
  if (record.disposition === "quarantined" || Object.values(record.checks || {}).some((check) => check?.state === "failed")) return "quarantined";
  const blockers = blockingPublicationChecks(record);
  if (record.publishedAt && blockers.length === 0) return "published";
  if (record.selectedForQuiz && blockers.length === 0) return "verified";
  if (record.selectedForQuiz) return "selected";
  const technical = ["identity", "youtube", "fragment"].every((name) => ["verified", "not-applicable"].includes(record.checks?.[name]?.state));
  if (technical) return "technical-ready";
  const enriched = ["release", "artwork", "artistImage"].some((name) => ["automatic", "verified"].includes(record.checks?.[name]?.state));
  return enriched ? "enriched" : "catalogued";
}

export const conflictEntityIdsFor = (song, verificationDocument) => {
  const verified = verificationDocument?.songs?.[song.songId || song.id]?.relationships?.conflictEntityIds || [];
  return [...new Set([...(song.artistIds || []), ...verified])];
};

export function publicationReport(song, record) {
  const blockers = blockingPublicationChecks(record);
  return {
    songId: song.songId || song.id,
    artist: song.artist,
    title: song.title,
    lifecycle: lifecycleFor(record),
    blockers,
    passed: blockers.length === 0,
  };
}
