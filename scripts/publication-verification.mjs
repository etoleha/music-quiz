import crypto from "node:crypto";

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
const stableValue = (value) => Array.isArray(value)
  ? value.map(stableValue)
  : objectOrNull(value)
    ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stableValue(item)]))
    : value;

const materialSnapshot = (song = {}, record = {}) => ({
  song: {
    artist: song.artist,
    title: song.title,
    artistAliases: song.artistAliases,
    titleAliases: song.titleAliases,
    artistIds: song.artistIds,
    approximateYear: song.approximateYear,
    recognizability: song.recognizability,
    youtube: song.youtube,
    clip: song.clip,
    optionalMetadata: {
      artistForm: song.optionalMetadata?.artistForm,
      album: song.optionalMetadata?.album,
      artistImage: song.optionalMetadata?.artistImage,
      performers: song.optionalMetadata?.performers,
      facts: song.optionalMetadata?.facts,
    },
  },
  verification: {
    identity: record.identity,
    release: record.release,
    artistImage: record.artistImage,
    relationships: record.relationships,
    credits: record.credits,
    soundtrack: record.soundtrack,
    originalRecording: record.originalRecording,
    difficulty: record.difficulty,
  },
});

export const publicationSourceFingerprint = (song, record) => crypto.createHash("sha256")
  .update(JSON.stringify(stableValue(materialSnapshot(song, record))))
  .digest("hex");

export const sealPublicationVerification = (song, record, verifiedAt = new Date().toISOString()) => ({
  ...record,
  verificationSchemaVersion: 2,
  sourceFingerprint: publicationSourceFingerprint(song, record),
  lastFullyVerifiedAt: verifiedAt,
});

export const publicationVerificationIsCurrent = (song, record = {}) => !record.sourceFingerprint
  || record.sourceFingerprint === publicationSourceFingerprint(song, record);

export function validatePublicationVerification(document) {
  if (!objectOrNull(document) || !objectOrNull(document.songs)) {
    throw new Error("song-publication-verification.json must contain a songs object");
  }
  for (const [songId, record] of Object.entries(document.songs)) {
    if (!objectOrNull(record.checks)) throw new Error(`${songId}: checks are required`);
    if (record.verificationSchemaVersion >= 2 && !/^[a-f0-9]{64}$/u.test(record.sourceFingerprint || "")) {
      throw new Error(`${songId}: sourceFingerprint is required for verification schema 2`);
    }
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
}).concat([
  ...(record.release?.versionType === "cover" ? ["originalRecording"] : []),
  ...(record.checks?.audioLoudness ? ["audioLoudness"] : []),
].filter((name) => {
  const state = record.checks?.[name]?.state;
  return state !== "verified" && state !== "not-applicable";
}));

export const REQUIRED_GOLDEN_RESERVE_CHECKS = [
  "identity",
  "release",
  "artwork",
  "artistImage",
  "youtube",
  "difficulty",
  "credits",
  "soundtrack",
];

export const blockingGoldenReserveChecks = (record = {}) => REQUIRED_GOLDEN_RESERVE_CHECKS.filter((name) => {
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
  if (record.goldenReserve?.approvedAt && blockingGoldenReserveChecks(record).length === 0) return "golden";
  if (record.goldenReserve?.approvedAt) return "golden-review";
  const technical = ["identity", "youtube", "fragment"].every((name) => ["verified", "not-applicable"].includes(record.checks?.[name]?.state));
  if (technical) return "technical-ready";
  const enriched = ["release", "artwork", "artistImage"].some((name) => ["automatic", "verified"].includes(record.checks?.[name]?.state));
  return enriched ? "enriched" : "catalogued";
}

export function goldenReserveReport(song, record) {
  const blockers = blockingGoldenReserveChecks(record);
  return {
    songId: song.songId || song.id,
    lifecycle: lifecycleFor(record),
    blockers,
    passed: Boolean(record?.goldenReserve?.approvedAt) && blockers.length === 0,
  };
}

export const conflictEntityIdsFor = (song, verificationDocument) => {
  const verified = verificationDocument?.songs?.[song.songId || song.id]?.relationships?.conflictEntityIds || [];
  return [...new Set([...(song.artistIds || []), ...verified])];
};

export function publicationReport(song, record) {
  const blockers = [...new Set([
    ...(publicationVerificationIsCurrent(song, record) ? [] : ["fullReverification"]),
    ...blockingPublicationChecks(record),
  ])];
  return {
    songId: song.songId || song.id,
    artist: song.artist,
    title: song.title,
    lifecycle: lifecycleFor(record),
    blockers,
    passed: blockers.length === 0,
  };
}
