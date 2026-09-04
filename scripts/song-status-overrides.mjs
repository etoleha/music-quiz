import { fingerprint } from "./chart-normalization.mjs";

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const objectOrNull = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

export const externalIdsFromStatusOverride = (override = {}, label = "song override") => {
  if (!objectOrNull(override)) throw new Error(`${label} must be an object`);
  if (override.externalIds === undefined) return {};
  if (!objectOrNull(override.externalIds)) throw new Error(`${label}.externalIds must be an object`);

  const unsupportedNamespaces = Object.keys(override.externalIds).filter((namespace) => namespace !== "youtube");
  if (unsupportedNamespaces.length) {
    throw new Error(`${label}.externalIds supports only youtube; found ${unsupportedNamespaces.join(", ")}`);
  }

  const youtube = override.externalIds.youtube;
  if (!Array.isArray(youtube)) throw new Error(`${label}.externalIds.youtube must be an array of video IDs`);
  for (const value of youtube) {
    if (typeof value !== "string" || !YOUTUBE_ID_PATTERN.test(value)) {
      throw new Error(`${label}.externalIds.youtube contains invalid video ID: ${JSON.stringify(value)}`);
    }
  }

  return youtube.length ? { youtube: [...new Set(youtube)] } : {};
};

export const artistIdentityFromStatusOverride = (override = {}, label = "song override") => {
  if (!objectOrNull(override)) throw new Error(`${label} must be an object`);
  const hasArtistCredit = override.artistCredit !== undefined;
  const hasArtistIds = override.artistIds !== undefined;
  if (!hasArtistCredit && !hasArtistIds) return null;
  if (hasArtistCredit !== hasArtistIds) {
    throw new Error(`${label}.artistCredit and ${label}.artistIds must be specified together`);
  }

  if (typeof override.artistCredit !== "string" || !override.artistCredit.trim()) {
    throw new Error(`${label}.artistCredit must be a non-empty string`);
  }
  if (!Array.isArray(override.artistIds) || override.artistIds.length === 0) {
    throw new Error(`${label}.artistIds must be a non-empty array of normalized artist IDs`);
  }

  const normalizedIds = override.artistIds.map((artistId) => {
    if (typeof artistId !== "string" || !artistId.trim()) {
      throw new Error(`${label}.artistIds must contain non-empty strings`);
    }
    const normalized = fingerprint(artistId);
    if (!normalized || artistId !== normalized) {
      throw new Error(`${label}.artistIds contains non-normalized artist ID: ${JSON.stringify(artistId)}`);
    }
    return normalized;
  });
  if (new Set(normalizedIds).size !== normalizedIds.length) {
    throw new Error(`${label}.artistIds must contain unique normalized artist IDs`);
  }

  return {
    artistCredit: override.artistCredit.trim(),
    artistIds: normalizedIds,
  };
};

export const applyArtistCreditOverride = (entry, identityOverride) => {
  if (!identityOverride) return entry;
  const sourceArtistCredit = entry.artist;
  entry.sourceArtistCredit = sourceArtistCredit;
  entry.artist = identityOverride.artistCredit;
  entry.artistAliases = [...new Set([
    ...(entry.artistAliases || []),
    sourceArtistCredit,
    identityOverride.artistCredit,
  ].filter(Boolean).map(String))].sort((left, right) => left.localeCompare(right, "ru"));
  entry.normalizedArtist = {
    primary: identityOverride.artistIds[0],
    participants: [...identityOverride.artistIds],
  };
  return entry;
};

export const validateSongStatusOverrides = (document) => {
  if (!objectOrNull(document)) throw new Error("song-status-overrides.json must contain an object");
  if (!objectOrNull(document.songs)) throw new Error("song-status-overrides.json.songs must contain an object");
  for (const [key, override] of Object.entries(document.songs)) {
    const label = `song-status-overrides.json.songs[${JSON.stringify(key)}]`;
    externalIdsFromStatusOverride(override, label);
    artistIdentityFromStatusOverride(override, label);
  }
};

export const publicationBlockersFor = (entry, { language, reviewStatus, fragmentStatus }) => [
  !entry.artistIdentityResolved && "artist-identity",
  language !== "russian" && "language",
  reviewStatus !== "verified" && "editorial-review",
  !entry.allArtistsUnused && "artist-already-used",
  entry.release.releaseYearStatus !== "verified" && "release-year",
  !entry.externalIds.youtube?.length && "youtube-video",
  fragmentStatus !== "good" && "fragment-review",
  entry.enrichment.review !== "verified" && "enrichment-review",
].filter(Boolean);

export const quizReadinessBlockersFor = (entry, preparation, { workflowStatus }) => {
  const clip = preparation?.clip;
  const youtube = preparation?.youtube;
  const validClip = Number.isInteger(clip?.start) && clip.start >= 0
    && Number.isInteger(clip?.duration) && clip.duration >= 5 && clip.duration <= 20
    && Number.isInteger(youtube?.durationSeconds)
    && clip.start + clip.duration <= youtube.durationSeconds;
  return [
    workflowStatus !== "waiting" && "workflow",
    !entry.artistIdentityResolved && "artist-identity",
    !entry.allArtistsUnused && "artist-already-used",
    !preparation?.eligibility?.approved && "quiz-eligibility",
    !Number.isInteger(preparation?.approximateYear) && "approximate-year",
    !["soviet", "1990s", "2000s", "2010s", "2020s"].includes(preparation?.era) && "era",
    !youtube?.videoId && "youtube-video",
    !validClip && "playable-fragment",
  ].filter(Boolean);
};
