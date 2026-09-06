import "server-only";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

type AutoSong = {
  status: string;
  overallState?: "verified" | "candidate" | "conflict";
  recordingMbid?: string;
  recordingTitle?: string;
  artistCredits?: Array<{ name: string; musicBrainzArtistId?: string; joinPhrase?: string }>;
  artistMbids?: string[];
  releaseYear?: number | null;
  releaseYearState?: "verified" | "candidate" | "conflict";
  album?: { title: string; kind?: "album" | "single" | "soundtrack" | "release"; year?: number | null; coverUrl?: string; sourceUrl?: string; rightsStatus?: string } | null;
  sources?: Array<{ provider: string; url: string }>;
};

type AutoArtist = {
  name?: string;
  country?: string | null;
  artistForm?: string;
  activeYears?: { since?: number | null; until?: number | null; ended?: boolean } | null;
  members?: { current?: Array<{ name: string; roles?: string[]; since?: number | null }> };
  photo?: { url: string; attribution: string; license: string; licenseUrl: string; sourceUrl: string } | null;
  facts?: Array<{ text: string; sourceUrl?: string; state?: "verified" | "candidate" }>;
  sources?: Array<{ provider: string; url: string }>;
};

type AutoEnrichment = { songs: Record<string, AutoSong>; artists: Record<string, AutoArtist> };
type CatalogSong = {
  id: string;
  artist: string;
  title: string;
  artistAliases: string[];
  titleAliases: string[];
  quizRefs?: Array<{ youtubeId?: string }>;
  quizPreparation?: { youtube?: { videoId?: string } } | null;
  release?: {
    releaseYear?: number | null;
    releaseYearStatus?: "verified" | "candidate" | "missing";
    album?: { title: string; kind?: "album" | "single" | "soundtrack" | "release"; year?: number | null; coverUrl?: string; sourceUrl?: string; rightsStatus?: string } | null;
  };
  enrichment?: {
    artistForm?: string | null;
    artistImage?: AutoArtist["photo"];
    facts?: Array<{ text: string; sourceUrl?: string; state?: "verified" | "candidate" }>;
    sources?: string[];
  };
};

type PublicationVerification = {
  songs: Record<string, {
    checks?: Record<string, { state: string; sources?: string[] }>;
    release?: { releaseYear?: number; versionYear?: number; album?: CatalogSong["release"] extends infer R ? R extends { album?: infer A } ? A : never : never };
    artistImage?: AutoArtist["photo"];
    relationships?: { lineup?: Array<{ name: string; role?: string; highlighted?: boolean }>; sourceUrl?: string };
    credits?: Array<{ role: string; names: string[] }>;
    soundtrack?: { title: string; kind?: string; year?: number; sourceUrl?: string } | null;
    difficulty?: { band: "recognizable" | "middle" | "deep"; score: number; explanation: string; basis?: string[] };
    publishedAt?: string;
  }>;
};

let loaded: { songs: CatalogSong[]; enrichment: AutoEnrichment; verification: PublicationVerification } | null = null;

const fingerprint = (value = "") => String(value)
  .normalize("NFKD")
  .toLocaleLowerCase("ru-RU")
  .replaceAll("ё", "е")
  .replace(/[^a-zа-я0-9]+/giu, "");

function load() {
  if (loaded) return loaded;
  const dataDirectory = path.join(process.cwd(), "data");
  const index = JSON.parse(fs.readFileSync(path.join(dataDirectory, "song-database.json"), "utf8"));
  const compressed = Array.isArray(index.archiveParts) && index.archiveParts.length
    ? Buffer.concat(index.archiveParts.map((part: string) => fs.readFileSync(path.join(dataDirectory, part))))
    : fs.readFileSync(path.join(dataDirectory, index.archive));
  if (index.archiveSha256 && crypto.createHash("sha256").update(compressed).digest("hex") !== index.archiveSha256) {
    throw new Error("Song database archive checksum mismatch");
  }
  const database = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
  const enrichment = JSON.parse(fs.readFileSync(path.join(dataDirectory, "song-enrichment-auto.json"), "utf8"));
  const verificationPath = path.join(dataDirectory, "song-publication-verification.json");
  const verification = fs.existsSync(verificationPath)
    ? JSON.parse(fs.readFileSync(verificationPath, "utf8"))
    : { songs: {} };
  loaded = { songs: database.songs, enrichment, verification };
  return loaded;
}

export function getPersistedTrackInfo(artist: string, title: string, youtubeId?: string) {
  const data = load();
  const artistKey = fingerprint(artist);
  const titleKey = fingerprint(title);
  const exactVideoSong = youtubeId ? data.songs.find((item) => item.quizPreparation?.youtube?.videoId === youtubeId
    || item.quizRefs?.some((reference) => reference.youtubeId === youtubeId)) : undefined;
  const song = exactVideoSong || data.songs.find((item) =>
      [item.artist, ...(item.artistAliases || [])].some((value) => fingerprint(value) === artistKey)
      && [item.title, ...(item.titleAliases || [])].some((value) => fingerprint(value) === titleKey));
  if (!song) return null;
  const verified = data.verification.songs[song.id];
  const enrichment = data.enrichment.songs[song.id];
  if (!enrichment || enrichment.status !== "matched") {
    const verifiedSources = Object.values(verified?.checks || {}).flatMap((check) => check.sources || []);
    const verifiedCount = Object.values(verified?.checks || {}).filter((check) => ["verified", "not-applicable"].includes(check.state)).length;
    return {
      name: song.artist,
      artistForm: song.enrichment?.artistForm || undefined,
      image: verified?.artistImage || song.enrichment?.artistImage || undefined,
      facts: (song.enrichment?.facts || []).filter((fact) => fact.state !== "candidate").slice(0, 3),
      releaseYear: verified?.release?.releaseYear || song.release?.releaseYear || undefined,
      versionYear: verified?.release?.versionYear || undefined,
      releaseYearStatus: verified?.checks?.release?.state === "verified" || song.release?.releaseYearStatus === "verified" ? "verified" : "candidate",
      album: verified?.release?.album || (song.release?.album ? { ...song.release.album, kind: song.release.album.kind || "album" } : undefined),
      members: verified?.relationships?.lineup || [],
      credits: verified?.credits || [],
      soundtrack: verified?.soundtrack || undefined,
      difficulty: verified?.difficulty,
      verification: verified ? { status: verified.publishedAt ? "published" : "verified", verifiedChecks: verifiedCount, totalChecks: Object.keys(verified.checks || {}).length } : undefined,
      sources: [...new Set([...(song.enrichment?.sources || []), ...verifiedSources])].map((url) => ({ provider: "source", url })),
    };
  }
  const profiles = (enrichment.artistMbids || []).map((id) => data.enrichment.artists[id]).filter(Boolean);
  const primary = profiles[0];
  const since = primary?.activeYears?.since;
  const until = primary?.activeYears?.until;
  const activeYears = since
    ? primary.activeYears?.ended ? `${since}–${until || "?"}` : `с ${since}`
    : undefined;
  const artistUrl = enrichment.artistMbids?.[0] ? `https://musicbrainz.org/artist/${enrichment.artistMbids[0]}` : undefined;
  const catalogYear = song.release?.releaseYear || undefined;
  const verifiedEnrichmentYear = enrichment.releaseYearState === "verified"
    ? enrichment.releaseYear || undefined
    : undefined;
  const releaseYear = verifiedEnrichmentYear || catalogYear || enrichment.releaseYear || undefined;
  const enrichmentAlbumYear = enrichment.album?.year || enrichment.releaseYear || undefined;
  const enrichmentAlbumMatchesCatalog = !catalogYear || !enrichmentAlbumYear
    || Math.abs(catalogYear - enrichmentAlbumYear) <= 2;
  const catalogAlbumYear = song.release?.album?.year || undefined;
  const catalogAlbumMatchesYear = !catalogYear || !catalogAlbumYear
    || Math.abs(catalogYear - catalogAlbumYear) <= 2;
  const album = enrichment.album && (verifiedEnrichmentYear || enrichmentAlbumMatchesCatalog)
    ? { ...enrichment.album, kind: enrichment.album.kind || "album" }
    : song.release?.album && catalogAlbumMatchesYear
      ? { ...song.release.album, kind: song.release.album.kind || "album" }
      : undefined;
  const verifiedSources = Object.values(verified?.checks || {}).flatMap((check) => check.sources || []);
  const verifiedCount = Object.values(verified?.checks || {}).filter((check) => ["verified", "not-applicable"].includes(check.state)).length;
  return {
    name: primary?.name || enrichment.artistCredits?.map(({ name, joinPhrase = "" }) => `${name}${joinPhrase}`).join("").trim() || artist,
    artistForm: primary?.artistForm || song.enrichment?.artistForm || undefined,
    country: primary?.country || undefined,
    activeYears,
    members: verified?.relationships?.lineup || primary?.members?.current || [],
    image: verified?.artistImage || primary?.photo || song.enrichment?.artistImage || undefined,
    facts: [
      ...profiles.flatMap((profile) => profile.facts || []),
      ...(song.enrichment?.facts || []),
    ].filter((fact) => fact.state === "verified").slice(0, 3),
    artistUrl,
    recordingTitle: enrichment.recordingTitle,
    releaseYear: verified?.release?.releaseYear || releaseYear,
    versionYear: verified?.release?.versionYear || undefined,
    releaseYearStatus: verified?.checks?.release?.state === "verified" || verifiedEnrichmentYear || song.release?.releaseYearStatus === "verified" ? "verified" : "candidate",
    album: verified?.release?.album || album,
    credits: verified?.credits || [],
    soundtrack: verified?.soundtrack || undefined,
    difficulty: verified?.difficulty,
    verification: verified ? { status: verified.publishedAt ? "published" : "verified", verifiedChecks: verifiedCount, totalChecks: Object.keys(verified.checks || {}).length } : undefined,
    sources: [
      ...(enrichment.sources || []),
      ...profiles.flatMap((profile) => profile.sources || []),
      ...verifiedSources.map((url) => ({ provider: "verification", url })),
    ],
  };
}
