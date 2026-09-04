const rendererText = (value) => value?.simpleText || value?.runs?.map(({ text }) => text).join("") || "";

const extractAssignedJson = (html, markers) => {
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
      if (character === '"') inString = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) return JSON.parse(html.slice(start, index + 1));
    }
  }
  return null;
};

export function inspectYouTubeWatchHtml(html) {
  const player = extractAssignedJson(html, ["var ytInitialPlayerResponse =", "ytInitialPlayerResponse ="]);
  const playability = player?.playabilityStatus;
  const textReason = rendererText(playability?.errorScreen?.playerErrorMessageRenderer?.reason)
    || rendererText(playability?.errorScreen?.playerLegacyDesktopYpcOfferRenderer?.itemTitle)
    || playability?.reason
    || "";
  const searchable = `${textReason} ${JSON.stringify(playability || {})} ${html.slice(0, 500_000)}`;
  if (/LOGIN_REQUIRED|AGE_RESTRICTED|ограничение по возрасту|confirm your age/iu.test(searchable)
    && /age|возраст|inappropriate|неприемлем|LOGIN_REQUIRED|AGE_RESTRICTED/iu.test(searchable)) {
    return { status: "failed", reason: "age-restricted" };
  }
  if (playability?.status && playability.status !== "OK") {
    return { status: "failed", reason: String(textReason || playability.status).slice(0, 200) };
  }
  if (playability?.playableInEmbed === false) return { status: "failed", reason: "embedding-disabled" };
  if (!player?.videoDetails?.videoId && !/"playableInEmbed":true/u.test(html)) {
    return { status: "failed", reason: "playability-undetermined" };
  }
  return { status: "passed", reason: "watch-page-playable" };
}

export async function checkYouTubeVideo(videoId, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}&hl=ru`, {
      headers: {
        "accept-language": "ru-RU,ru;q=0.9,en;q=0.7",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36",
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return { status: "failed", reason: `http-${response.status}` };
    return inspectYouTubeWatchHtml(await response.text());
  } catch (error) {
    return { status: "failed", reason: String(error?.message || error).slice(0, 200) };
  }
}
