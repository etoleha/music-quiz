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

export const validateSongStatusOverrides = (document) => {
  if (!objectOrNull(document)) throw new Error("song-status-overrides.json must contain an object");
  if (!objectOrNull(document.songs)) throw new Error("song-status-overrides.json.songs must contain an object");
  for (const [key, override] of Object.entries(document.songs)) {
    externalIdsFromStatusOverride(override, `song-status-overrides.json.songs[${JSON.stringify(key)}]`);
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
