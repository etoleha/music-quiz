import fs from "node:fs";
import path from "node:path";
import { fingerprint } from "./chart-normalization.mjs";

const keysForEntry = (entry) => new Set([entry.canonical, ...(entry.aliases || [])].map(fingerprint).filter(Boolean));

const compileEntries = (entries = []) => entries.map((entry) => ({ ...entry, keys: keysForEntry(entry) }));

export const loadArtistSelectionPolicy = (repoRoot) => {
  const source = JSON.parse(fs.readFileSync(path.join(repoRoot, "data", "artist-selection-policy.json"), "utf8"));
  if (source.version !== 1 || !Array.isArray(source.blocked) || !Array.isArray(source.priorityInclude)) {
    throw new Error("Некорректный data/artist-selection-policy.json");
  }
  return {
    ...source,
    blocked: compileEntries(source.blocked),
    priorityInclude: compileEntries(source.priorityInclude),
  };
};

const artistKeysForSong = (song) => new Set([
  ...(song.artistIds || []),
  fingerprint(song.artist),
  ...(song.artistAliases || []).map(fingerprint),
].filter(Boolean));

const matchingEntry = (song, entries) => {
  const artistKeys = artistKeysForSong(song);
  return entries.find((entry) => [...entry.keys].some((key) => artistKeys.has(key))) || null;
};

export const artistSelectionFor = (song, policy) => ({
  blockedBy: matchingEntry(song, policy.blocked),
  prioritizedBy: matchingEntry(song, policy.priorityInclude),
});

export const isArtistBlocked = (song, policy) => Boolean(artistSelectionFor(song, policy).blockedBy);
export const isArtistPrioritized = (song, policy) => Boolean(artistSelectionFor(song, policy).prioritizedBy);
