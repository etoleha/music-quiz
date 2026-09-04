import { fingerprint } from "./chart-normalization.mjs";

const BLOCKED_VERSION = /\b(?:karaoke|cover|remix|live|concert|instrumental|slowed|sped\s*up|nightcore|reverb|reaction|tutorial|parody|phonk|bass\s*boosted|mashup)\b|караоке|кавер|ремикс|концерт|минусовк|разбор|реакци|пароди|задом\s+нап[её]р[её]д|один\s+в\s+один|вечерний\s+ургант/iu;
const SOFT_VERSION = /\b(?:lyrics?|audio|visualizer)\b|текст\s+песни|аудио/iu;

const rendererText = (value) => value?.simpleText
  || value?.runs?.map(({ text }) => text).join("")
  || "";

const parseClock = (value) => {
  const parts = String(value || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) return null;
  return parts.reduce((seconds, part) => seconds * 60 + part, 0);
};

export const parseViewCount = (value) => {
  const normalized = String(value || "").toLocaleLowerCase("ru-RU").replace(/\u00a0/g, " ");
  const match = normalized.match(/\d[\d\s.,]*/u);
  if (!match) return null;
  let number = Number(match[0].trim().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(number)) return null;
  const suffix = normalized.slice((match.index || 0) + match[0].length).trim().match(/^(млрд|млн|тыс|b|m|k)(?:\s|\.|$)/iu)?.[1];
  const multiplier = { млрд: 1_000_000_000, b: 1_000_000_000, млн: 1_000_000, m: 1_000_000, тыс: 1_000, k: 1_000 }[suffix?.toLocaleLowerCase("ru-RU")] || 1;
  return Math.round(number * multiplier);
};

export const extractAssignedJson = (html, markers) => {
  for (const marker of markers) {
    const markerIndex = html.indexOf(marker);
    if (markerIndex < 0) continue;
    const start = html.indexOf("{", markerIndex + marker.length);
    if (start < 0) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < html.length; index += 1) {
      const character = html[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{") depth += 1;
      if (character === "}" && --depth === 0) return JSON.parse(html.slice(start, index + 1));
    }
  }
  throw new Error("YouTube initial data was not found");
};

const collectRenderers = (value, output = [], seen = new Set()) => {
  if (!value || typeof value !== "object") return output;
  if (value.videoRenderer?.videoId && !seen.has(value.videoRenderer.videoId)) {
    seen.add(value.videoRenderer.videoId);
    output.push(value.videoRenderer);
  }
  for (const child of Object.values(value)) collectRenderers(child, output, seen);
  return output;
};

export const parseYouTubeSearchHtml = (html) => {
  const initialData = extractAssignedJson(html, [
    "var ytInitialData =",
    "window[\"ytInitialData\"] =",
    "ytInitialData =",
  ]);
  return collectRenderers(initialData).map((renderer) => {
    const badges = (renderer.badges || []).map(({ metadataBadgeRenderer }) => rendererText(metadataBadgeRenderer?.label));
    const overlays = renderer.thumbnailOverlays || [];
    const live = badges.some((badge) => /live|прямой эфир/iu.test(badge))
      || overlays.some(({ thumbnailOverlayTimeStatusRenderer }) => thumbnailOverlayTimeStatusRenderer?.style === "LIVE");
    return {
      videoId: renderer.videoId,
      title: rendererText(renderer.title),
      channel: rendererText(renderer.ownerText),
      durationSeconds: parseClock(rendererText(renderer.lengthText)),
      viewCount: parseViewCount(rendererText(renderer.viewCountText) || rendererText(renderer.shortViewCountText)),
      badges,
      live,
    };
  });
};

const tokenOverlap = (expected, actual) => {
  const expectedTokens = new Set(expected.match(/[a-zа-яё0-9]+/giu) || []);
  if (!expectedTokens.size) return 0;
  const actualTokens = new Set(actual.match(/[a-zа-яё0-9]+/giu) || []);
  return [...expectedTokens].filter((token) => actualTokens.has(token)).length / expectedTokens.size;
};

export const scoreYouTubeResult = ({ artist, title }, result) => {
  if (!result.videoId || result.live || !result.durationSeconds || result.durationSeconds < 90 || result.durationSeconds > 480) return -Infinity;
  if (BLOCKED_VERSION.test(result.title)) return -Infinity;
  const resultTitle = fingerprint(result.title);
  const resultChannel = fingerprint(result.channel);
  const expectedTitle = fingerprint(title);
  const expectedArtist = fingerprint(artist);
  const residualTitle = resultTitle
    .replace(expectedArtist, "")
    .replace(/(?:official|music|video|клип|видеоклип|премьера|audio|аудио|текст|песни|full|hd|hq|sd|4k|19\d{2}|20\d{2})/giu, "");
  const titleOverlap = resultTitle.includes(expectedTitle) ? 1 : tokenOverlap(String(title).toLocaleLowerCase("ru-RU"), String(result.title).toLocaleLowerCase("ru-RU"));
  const artistOverlap = resultTitle.includes(expectedArtist) || resultChannel.includes(expectedArtist)
    ? 1
    : Math.max(
      tokenOverlap(String(artist).toLocaleLowerCase("ru-RU"), String(result.title).toLocaleLowerCase("ru-RU")),
      tokenOverlap(String(artist).toLocaleLowerCase("ru-RU"), String(result.channel).toLocaleLowerCase("ru-RU")),
    );
  if (!expectedTitle || titleOverlap < 0.65 || artistOverlap < 0.45) return -Infinity;
  let score = titleOverlap * 70 + artistOverlap * 45;
  if (resultTitle.includes(expectedTitle)) score += 25;
  if (residualTitle === expectedTitle) score += 42;
  else if (residualTitle.startsWith(expectedTitle) || residualTitle.endsWith(expectedTitle)) score += 12;
  if (resultTitle.includes(expectedArtist)) score += 20;
  if (resultChannel.includes(expectedArtist)) score += 16;
  if (/\btopic\b|официальн/iu.test(result.channel)) score += 8;
  if (SOFT_VERSION.test(result.title)) score -= 8;
  if (result.badges.some((badge) => /официальный|official|проверено/iu.test(badge))) score += 8;
  score += Math.min(49, Math.log10(Math.max(1, result.viewCount || 1)) * 7);
  return Number(score.toFixed(3));
};

export const rankYouTubeResults = (song, results) => results
  .map((result) => ({ ...result, score: scoreYouTubeResult(song, result) }))
  .filter(({ score }) => Number.isFinite(score) && score >= 80)
  .sort((left, right) => right.score - left.score || (right.viewCount || 0) - (left.viewCount || 0));

export async function searchYouTubeVideos(song, { fetchImpl = fetch } = {}) {
  const query = `${song.artist} ${song.title}`.replace(/\s+/g, " ").trim();
  const response = await fetchImpl(`https://www.youtube.com/results?hl=ru&search_query=${encodeURIComponent(query)}`, {
    headers: {
      "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`YouTube search returned HTTP ${response.status}`);
  const results = parseYouTubeSearchHtml(await response.text());
  return { query, results: rankYouTubeResults(song, results) };
}
