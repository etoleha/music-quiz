import { fingerprint, normalizeArtist, textSimilarity } from "./chart-normalization.mjs";

const VERSION_PATTERNS = [
  ["remix", /\b(remix|mix|rmx|ремикс)\b/iu],
  ["live", /\b(live|concert|жив(?:ь|о|ой)|концерт)\b/iu],
  ["acoustic", /\b(acoustic|акустическ)\w*/iu],
  ["edit", /\b(edit|radio edit|версия)\b/iu],
  ["cover", /\b(cover|кавер)\b/iu],
];

export const extractVersionType = (value = "") =>
  VERSION_PATTERNS.find(([, expression]) => expression.test(value))?.[0] || "original";

export const recordingArtistCredits = (recording = {}) =>
  (recording["artist-credit"] || [])
    .filter((credit) => credit && typeof credit === "object" && credit.artist?.name)
    .map((credit) => ({
      name: credit.name || credit.artist.name,
      musicBrainzArtistId: credit.artist.id,
      joinPhrase: credit.joinphrase || "",
    }));

const artistParticipantSets = (song, aliasIndex) => {
  const values = [song.artist, ...(song.artistAliases || [])].filter(Boolean);
  return values.map((value) => new Set(normalizeArtist(value, aliasIndex).participants));
};

const artistCoverage = (song, recording, aliasIndex) => {
  const actual = new Set(recordingArtistCredits(recording).flatMap(({ name }) => normalizeArtist(name, aliasIndex).participants));
  if (!actual.size) return 0;
  return Math.max(0, ...artistParticipantSets(song, aliasIndex).map((expected) => {
    if (!expected.size) return 0;
    const shared = [...expected].filter((participant) => actual.has(participant)).length;
    const precision = shared / actual.size;
    const recall = shared / expected.size;
    return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  }));
};

const titleSimilarity = (song, recording) => {
  const remote = fingerprint(recording.title || "");
  return Math.max(0, ...[song.title, ...(song.titleAliases || [])]
    .filter(Boolean)
    .map((value) => textSimilarity(fingerprint(value), remote)));
};

const recordingYear = (recording) => Number(String(recording["first-release-date"] || "").slice(0, 4)) || null;

const yearCompatibility = (song, recording) => {
  const year = recordingYear(recording);
  const expected = [song.release?.releaseYear, ...(song.release?.candidateYears || []).map(({ year: value }) => value)]
    .map(Number)
    .filter(Number.isFinite);
  if (!year || !expected.length) return 0.5;
  const distance = Math.min(...expected.map((value) => Math.abs(value - year)));
  if (distance === 0) return 1;
  if (distance === 1) return 0.8;
  if (distance <= 3) return 0.4;
  return 0;
};

export const scoreRecording = (song, recording, aliasIndex, { exactIsrc = false } = {}) => {
  const title = titleSimilarity(song, recording);
  const artists = artistCoverage(song, recording, aliasIndex);
  const remote = Math.max(0, Math.min(1, Number(recording.score || 0) / 100));
  const year = yearCompatibility(song, recording);
  const localVersion = extractVersionType(`${song.title} ${(song.titleAliases || []).join(" ")}`);
  const remoteVersion = extractVersionType(recording.title || "");
  const versionCompatible = localVersion === remoteVersion || (localVersion === "original" && remoteVersion === "edit");
  const score = title * 0.45 + artists * 0.35 + remote * 0.1 + year * 0.05 + (versionCompatible ? 0.05 : 0);
  const eligible = title >= (exactIsrc ? 0.88 : 0.84)
    && artists >= (exactIsrc ? 0.5 : 0.66)
    && versionCompatible;
  return { score, title, artists, year, versionCompatible, eligible, exactIsrc };
};

export const chooseRecording = (song, recordings, aliasIndex, { exactIsrc = false } = {}) => {
  const ranked = recordings
    .map((recording) => ({ recording, ...scoreRecording(song, recording, aliasIndex, { exactIsrc }) }))
    .filter(({ eligible }) => eligible)
    .sort((left, right) => right.score - left.score);
  if (!ranked.length) return { status: "not-found", alternatives: [] };
  const best = ranked[0];
  const runnerUpDelta = ranked[1] ? best.score - ranked[1].score : null;
  const accepted = exactIsrc
    ? best.score >= 0.82 && (runnerUpDelta === null || runnerUpDelta >= 0.03)
    : best.score >= 0.92 && (runnerUpDelta === null || runnerUpDelta >= 0.08);
  return {
    status: accepted ? "matched" : "ambiguous",
    ...best,
    runnerUpDelta,
    alternatives: ranked.slice(0, 3).map(({ recording, score }) => ({ id: recording.id, title: recording.title, score: Number(score.toFixed(4)) })),
  };
};

const yearFrom = (value) => Number(String(value || "").slice(0, 4)) || null;

export const selectReleaseInfo = (recording = {}) => {
  const official = (recording.releases || []).filter((release) => !release.status || release.status === "Official");
  const dated = official.filter((release) => yearFrom(release.date || release["release-group"]?.["first-release-date"]));
  const earliest = [...dated].sort((left, right) =>
    String(left.date || left["release-group"]?.["first-release-date"]).localeCompare(String(right.date || right["release-group"]?.["first-release-date"])))[0];
  const albums = dated.filter((release) => release["release-group"]?.["primary-type"] === "Album"
    && !(release["release-group"]?.["secondary-types"] || []).some((type) => ["Compilation", "Live"].includes(type)));
  const albumRelease = [...albums].sort((left, right) =>
    String(left["release-group"]?.["first-release-date"] || left.date).localeCompare(String(right["release-group"]?.["first-release-date"] || right.date)))[0];
  const firstReleaseYear = yearFrom(recording["first-release-date"] || earliest?.date || earliest?.["release-group"]?.["first-release-date"]);
  const albumGroup = albumRelease?.["release-group"];
  return {
    firstReleaseYear,
    firstReleaseDate: recording["first-release-date"] || earliest?.date || null,
    album: albumGroup ? {
      title: albumGroup.title || albumRelease.title,
      year: yearFrom(albumGroup["first-release-date"] || albumRelease.date),
      releaseGroupMbid: albumGroup.id,
      coverUrl: `https://coverartarchive.org/release-group/${albumGroup.id}/front-500`,
      sourceUrl: `https://musicbrainz.org/release-group/${albumGroup.id}`,
      rightsStatus: "contextual-only",
    } : null,
  };
};

export const isAllowedCommonsLicense = (license = "") => {
  const normalized = String(license).replace(/\s+/g, " ").trim().toUpperCase();
  if (/\b(?:NC|ND)\b/.test(normalized)) return false;
  return normalized === "CC0"
    || normalized.startsWith("CC BY ")
    || normalized.startsWith("CC BY-SA ")
    || normalized.includes("PUBLIC DOMAIN");
};

export const inferArtistForm = ({ type, gender, memberCount } = {}) => {
  if (type === "Group") return "Группа";
  if (gender === "Female") return "Исполнительница";
  return "Исполнитель";
};

export const enrichmentPriority = (song) => [
  Number(!song.quizRefs?.length),
  Number(song.readyForUniqueArtistQuiz),
  Number(song.status?.languageConfidence === "high" || song.status?.languageConfidence === "manual"),
  Number(song.artistIdentityResolution === "registry"),
  -Number(song.publicationBlockers?.length ?? 99),
  Number(Boolean(song.externalIds?.isrc?.length)),
  Number(song.release?.candidateYears?.length === 1),
  Number(song.chart?.sourceCount || 0),
  Number(song.candidateScore || 0),
];

export const compareEnrichmentPriority = (left, right) => {
  const leftPriority = enrichmentPriority(left);
  const rightPriority = enrichmentPriority(right);
  for (let index = 0; index < leftPriority.length; index += 1) {
    if (leftPriority[index] !== rightPriority[index]) return rightPriority[index] - leftPriority[index];
  }
  return String(left.id).localeCompare(String(right.id));
};
