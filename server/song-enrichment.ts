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
  album?: { title: string; year?: number | null; coverUrl?: string; sourceUrl?: string; rightsStatus?: string } | null;
  sources?: Array<{ provider: string; url: string }>;
};

type AutoArtist = {
  name?: string;
  country?: string | null;
  artistForm?: string;
  activeYears?: { since?: number | null; until?: number | null; ended?: boolean } | null;
  members?: { current?: Array<{ name: string; roles?: string[]; since?: number | null }> };
  photo?: { url: string; attribution: string; license: string; licenseUrl: string; sourceUrl: string } | null;
  facts?: Array<{ text: string; sourceUrl?: string }>;
  sources?: Array<{ provider: string; url: string }>;
};

type AutoEnrichment = { songs: Record<string, AutoSong>; artists: Record<string, AutoArtist> };
type CatalogSong = { id: string; artist: string; title: string; artistAliases: string[]; titleAliases: string[] };

let loaded: { songs: CatalogSong[]; enrichment: AutoEnrichment } | null = null;

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
  loaded = { songs: database.songs, enrichment };
  return loaded;
}

export function getPersistedTrackInfo(artist: string, title: string) {
  const data = load();
  const artistKey = fingerprint(artist);
  const titleKey = fingerprint(title);
  const song = data.songs.find((item) =>
    [item.artist, ...(item.artistAliases || [])].some((value) => fingerprint(value) === artistKey)
    && [item.title, ...(item.titleAliases || [])].some((value) => fingerprint(value) === titleKey));
  if (!song) return null;
  const enrichment = data.enrichment.songs[song.id];
  if (!enrichment || enrichment.status !== "matched") return null;
  const profiles = (enrichment.artistMbids || []).map((id) => data.enrichment.artists[id]).filter(Boolean);
  const primary = profiles[0];
  const since = primary?.activeYears?.since;
  const until = primary?.activeYears?.until;
  const activeYears = since
    ? primary.activeYears?.ended ? `${since}–${until || "?"}` : `с ${since}`
    : undefined;
  const artistUrl = enrichment.artistMbids?.[0] ? `https://musicbrainz.org/artist/${enrichment.artistMbids[0]}` : undefined;
  return {
    name: primary?.name || enrichment.artistCredits?.map(({ name, joinPhrase = "" }) => `${name}${joinPhrase}`).join("").trim() || artist,
    artistForm: primary?.artistForm,
    country: primary?.country || undefined,
    activeYears,
    members: primary?.members?.current || [],
    image: primary?.photo || undefined,
    facts: profiles.flatMap((profile) => profile.facts || []).slice(0, 3),
    artistUrl,
    recordingTitle: enrichment.recordingTitle,
    releaseYear: enrichment.releaseYear || undefined,
    releaseYearStatus: enrichment.releaseYearState === "verified" ? "verified" : "candidate",
    album: enrichment.album ? { ...enrichment.album, kind: "album" } : undefined,
    sources: [
      ...(enrichment.sources || []),
      ...profiles.flatMap((profile) => profile.sources || []),
    ],
  };
}
