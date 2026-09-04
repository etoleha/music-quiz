import "server-only";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";

type CatalogSong = {
  id: string;
  artist: string;
  title: string;
  artistAliases: string[];
  titleAliases: string[];
  artistIds: string[];
  usedArtistIds: string[];
  candidateScore: number;
  status: { workflow: string; language: string; review: string; fragment: string };
  chart: { sourceIds: string[]; years: number[] } | null;
  release: { releaseYear: number | null; releaseYearStatus: "verified" | "candidate" | "missing"; versionYear: number | null; candidateYears: Array<{ year: number; source: string }> };
  enrichment: { review: string; artistForm: string | null; facts: unknown[]; artistImage: unknown; performers: unknown[] };
  externalIds: Record<string, string[]>;
  quizRefs: unknown[];
  readyForCuration: boolean;
  readyForUniqueArtistQuiz: boolean;
  readyForPublication: boolean;
};

type CatalogArchive = { generatedAt: string; stats: Record<string, unknown>; songs: CatalogSong[] };

let archive: CatalogArchive | null = null;

function loadArchive() {
  if (archive) return archive;
  const dataDirectory = path.join(process.cwd(), "data");
  const index = JSON.parse(fs.readFileSync(path.join(dataDirectory, "song-database.json"), "utf8"));
  const compressed = Array.isArray(index.archiveParts) && index.archiveParts.length
    ? Buffer.concat(index.archiveParts.map((part: string) => fs.readFileSync(path.join(dataDirectory, part))))
    : fs.readFileSync(path.join(dataDirectory, index.archive));
  if (index.archiveSha256 && crypto.createHash("sha256").update(compressed).digest("hex") !== index.archiveSha256) {
    throw new Error("Song database archive checksum mismatch");
  }
  archive = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
  return archive!;
}

export type CatalogFilters = {
  q?: string;
  language?: string;
  workflow?: string;
  readiness?: string;
  source?: string;
  year?: string;
  artistUsage?: string;
  page?: string;
};

export function getCatalogPage(filters: CatalogFilters) {
  const database = loadArchive();
  const search = (filters.q || "").trim().toLocaleLowerCase("ru-RU");
  const year = Number(filters.year);
  const filtered = database.songs.filter((song) => {
    if (search && ![song.artist, song.title, ...song.artistAliases, ...song.titleAliases].some((value) => value.toLocaleLowerCase("ru-RU").includes(search))) return false;
    if (filters.language && filters.language !== "all" && song.status.language !== filters.language) return false;
    if (filters.workflow && filters.workflow !== "all" && song.status.workflow !== filters.workflow) return false;
    if (filters.source && filters.source !== "all" && !song.chart?.sourceIds.includes(filters.source)) return false;
    if (filters.year === "missing" && song.release.releaseYear) return false;
    if (Number.isFinite(year) && year > 1900 && song.release.releaseYear !== year) return false;
    if (filters.artistUsage === "new" && song.usedArtistIds.length) return false;
    if (filters.artistUsage === "used" && !song.usedArtistIds.length) return false;
    if (filters.readiness === "curation" && !song.readyForCuration) return false;
    if (filters.readiness === "unique" && !song.readyForUniqueArtistQuiz) return false;
    if (filters.readiness === "publish" && !song.readyForPublication) return false;
    if (filters.readiness === "review" && song.status.review === "verified" && song.enrichment.review === "verified") return false;
    return true;
  });
  const pageSize = 50;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(pageCount, Math.max(1, Number(filters.page) || 1));
  const sourceIds = [...new Set(database.songs.flatMap((song) => song.chart?.sourceIds || []))].sort();
  return {
    generatedAt: database.generatedAt,
    stats: database.stats,
    total: filtered.length,
    page,
    pageCount,
    sourceIds,
    songs: filtered.slice((page - 1) * pageSize, page * pageSize),
  };
}
