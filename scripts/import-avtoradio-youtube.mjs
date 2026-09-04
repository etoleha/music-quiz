import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { extractAssignedJson, parseViewCount } from "./youtube-search.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const channelUrl = "https://www.youtube.com/@AvtoradioMoscow/videos?hl=ru";
const maxPagesArg = process.argv.indexOf("--max-pages");
const maxPages = maxPagesArg >= 0 ? Math.max(1, Number(process.argv[maxPagesArg + 1])) : Infinity;
const headers = {
  "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
};

const text = (value) => value?.simpleText || value?.runs?.map((run) => run.text).join("") || "";
const clock = (value) => String(value || "").split(":").map(Number).reduce((seconds, part) => seconds * 60 + part, 0) || null;
const collect = (value, key, output = []) => {
  if (!value || typeof value !== "object") return output;
  if (value[key]) output.push(value[key]);
  for (const child of Object.values(value)) collect(child, key, output);
  return output;
};
const continuationFrom = (value) => collect(value, "continuationCommand")
  .map((item) => item?.token)
  .find(Boolean) || null;
const videoFrom = (renderer) => ({
  videoId: renderer.videoId,
  title: text(renderer.title),
  published: text(renderer.publishedTimeText),
  viewCount: parseViewCount(text(renderer.viewCountText) || text(renderer.shortViewCountText)),
  durationSeconds: clock(text(renderer.lengthText)),
  url: `https://www.youtube.com/watch?v=${renderer.videoId}`,
});
const lockupVideoFrom = (renderer) => {
  const metadataParts = collect(renderer, "metadataParts").flat();
  const metadataTexts = metadataParts.map((part) => part?.text?.content || part?.accessibilityLabel || "");
  const badges = collect(renderer, "thumbnailBadgeViewModel").map((badge) => badge?.text).filter(Boolean);
  const views = metadataTexts.find((value) => /просмотр|views?/iu.test(value)) || "";
  const published = metadataTexts.find((value) => /назад|премьер|ago/iu.test(value)) || "";
  return {
    videoId: renderer.contentId,
    title: renderer.metadata?.lockupMetadataViewModel?.title?.content || "",
    published,
    viewCount: parseViewCount(views),
    durationSeconds: clock(badges.find((value) => /^\d+(?::\d+){1,2}$/u.test(value))),
    url: `https://www.youtube.com/watch?v=${renderer.contentId}`,
  };
};
const videosFrom = (payload) => [
  ...collect(payload, "videoRenderer").map(videoFrom),
  ...collect(payload, "lockupViewModel")
    .filter((renderer) => /^[A-Za-z0-9_-]{11}$/.test(renderer.contentId || ""))
    .map(lockupVideoFrom),
];

const initialResponse = await fetch(channelUrl, { headers, signal: AbortSignal.timeout(30_000) });
if (!initialResponse.ok) throw new Error(`YouTube channel returned HTTP ${initialResponse.status}`);
const html = await initialResponse.text();
const initialData = extractAssignedJson(html, ["var ytInitialData =", "window[\"ytInitialData\"] =", "ytInitialData ="]);
const configValue = (name) => html.match(new RegExp(`"${name}":"([^"]+)"`))?.[1] || null;
const apiKey = configValue("INNERTUBE_API_KEY");
const clientVersion = configValue("INNERTUBE_CONTEXT_CLIENT_VERSION") || configValue("INNERTUBE_CLIENT_VERSION");
if (!apiKey || !clientVersion) throw new Error("YouTube InnerTube configuration was not found");

const videos = new Map(videosFrom(initialData).map((video) => [video.videoId, video]));
const seenTokens = new Set();
let continuation = continuationFrom(initialData);
let pages = 1;
while (continuation && pages < maxPages && !seenTokens.has(continuation)) {
  seenTokens.add(continuation);
  const response = await fetch(`https://www.youtube.com/youtubei/v1/browse?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion, hl: "ru", gl: "RU" } },
      continuation,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`YouTube continuation returned HTTP ${response.status} on page ${pages + 1}`);
  const payload = await response.json();
  for (const video of videosFrom(payload)) videos.set(video.videoId, video);
  continuation = continuationFrom(payload);
  pages += 1;
  if (pages % 25 === 0) console.log(`Авторадио: загружено ${videos.size} видео (${pages} страниц)`);
}

const trackPattern = /^(.+?)\s+[-–—]\s+(.+?)\s*\(\s*LIVE\s*@\s*Авторадио\s*\)\s*$/iu;
const clean = (value) => String(value || "")
  .replace(/[\u200B-\u200D\uFEFF]/gu, "")
  .replace(/\s*\*+\s*$/u, "")
  .replace(/\s+/g, " ")
  .trim();
const normalizedPair = (artist, title) => `${artist}:${title}`.toLocaleLowerCase("ru-RU")
  .replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/giu, " ").trim();
const candidates = new Map();
const collections = [];
for (const video of videos.values()) {
  const match = video.title.match(trackPattern);
  if (match) {
    const artist = clean(match[1]);
    const title = clean(match[2]);
    const key = normalizedPair(artist, title);
    const existing = candidates.get(key);
    if (!existing || (video.viewCount || 0) > (existing.sourceViews || 0)) {
      const digest = crypto.createHash("sha1").update(key).digest("hex").slice(0, 12);
      candidates.set(key, {
        id: `avtoradio-${digest}`,
        artist,
        title,
        listYear: null,
        listRank: null,
        sourceBand: (video.viewCount || 0) >= 5_000_000 ? "recognizable" : (video.viewCount || 0) >= 250_000 ? "middle" : "deep",
        candidateType: "avtoradio-live-catalog",
        sourceName: "Авторадио — живые выступления",
        sourceUrl: video.url,
        sourceVideoId: video.videoId,
        sourceViews: video.viewCount,
        note: "Исполнитель и песня взяты из каталога Авторадио; игровой ролик следует подбирать отдельно.",
      });
    }
  } else if (/плейлист|хит|русск|дискотек|ностальг|лучши|поп|рок/iu.test(video.title)) {
    collections.push(video);
  }
}

const videoArchive = {
  version: 1,
  importedAt: new Date().toISOString(),
  source: { id: "avtoradio-youtube", name: "Авторадио — YouTube", url: channelUrl },
  stats: { pages, videos: videos.size, trackCandidates: candidates.size, collections: collections.length, complete: !continuation },
  videos: [...videos.values()],
  collections,
};
const songPool = {
  version: 1,
  generatedAt: videoArchive.importedAt,
  source: videoArchive.source,
  stats: { tracks: candidates.size },
  collections,
  tracks: [...candidates.values()].sort((left, right) => left.artist.localeCompare(right.artist, "ru") || left.title.localeCompare(right.title, "ru")),
};
fs.writeFileSync(dataPath("avtoradio-youtube-videos.json"), `${JSON.stringify(videoArchive, null, 2)}\n`);
fs.writeFileSync(dataPath("song-pool-avtoradio.json"), `${JSON.stringify(songPool, null, 2)}\n`);
console.log(JSON.stringify(videoArchive.stats, null, 2));
