import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataDirectory = path.join(repoRoot, "data");
const indexPath = path.join(dataDirectory, "chart-songs-tophit-monthly.json");
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const archivePath = path.join(dataDirectory, index.archive);
const archive = JSON.parse(zlib.gunzipSync(fs.readFileSync(archivePath)).toString("utf8"));

const normalizeLanguage = (value = "") => {
  const language = value.trim().toLowerCase();
  if (["russian", "русский", "ru"].includes(language)) return "russian";
  if (["english", "английский", "en"].includes(language)) return "english";
  return language || null;
};

const observations = new Map();
for (const inputPath of process.argv.slice(2)) {
  const html = fs.readFileSync(path.resolve(inputPath), "utf8");
  for (const row of html.split(/<div role="row" class="Row_row__/).slice(1)) {
    const trackId = row.match(/href="(?:https:\/\/tophit\.com)?\/tracks\/(\d+)/)?.[1];
    const languageName = row.match(/Row_language__[^>]*>[\s\S]*?<span title="([^"]+)"/)?.[1]?.trim();
    const flagCode = row.match(/Row_language__[^>]*>[\s\S]*?class="[^"]*\bfi-([a-z]{2})\b/i)?.[1]?.toLowerCase();
    if (!trackId || !languageName) continue;
    const observation = observations.get(trackId) || { names: new Set(), codes: new Set(), flags: new Set() };
    observation.names.add(languageName);
    observation.codes.add(normalizeLanguage(languageName));
    if (flagCode) observation.flags.add(flagCode);
    observations.set(trackId, observation);
  }
}

let matchedTracks = 0;
for (const track of archive.tracks) {
  const observation = observations.get(String(track.topHitTrackId));
  if (!observation) continue;
  matchedTracks += 1;
  track.languageNames = [...new Set([...(track.languageNames || []), ...observation.names])].sort();
  track.languageCodes = [...new Set([...(track.languageCodes || []), ...observation.codes])].sort();
  track.languageFlagCodes = [...new Set([...(track.languageFlagCodes || []), ...observation.flags])].sort();
  track.languageStatus = track.languageCodes.length > 1 ? "conflicting" : track.languageCodes.length === 1 ? "unique" : "missing";
}

fs.writeFileSync(archivePath, zlib.gzipSync(Buffer.from(JSON.stringify(archive)), { level: 9 }));
index.languageQuality = {
  ...(index.languageQuality || {}),
  observedTrackIds: observations.size,
  matchedTracks,
  rule: "Language comes from TopHit row title (for example Russian or English); fi-* is stored only as visual-flag audit data.",
};
fs.writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`);
console.log(JSON.stringify({ observedTrackIds: observations.size, matchedTracks }, null, 2));
