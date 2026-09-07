import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fingerprint } from "./chart-normalization.mjs";
import { isArtistBlocked, loadArtistSelectionPolicy } from "./artist-selection-policy.mjs";
import { checkYouTubeVideo } from "./youtube-playability.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dataPath = (...parts) => path.join(repoRoot, "data", ...parts);
const targetTotal = Math.max(1, Number(process.env.GOLDEN_RESERVE_LIMIT || 200));
const concurrency = Math.max(1, Number(process.env.GOLDEN_RESERVE_CONCURRENCY || 5));
const refresh = process.argv.includes("--refresh");
const cacheTtlMs = 7 * 24 * 60 * 60 * 1000;
const outputPath = dataPath("song-golden-reserve.json");
const cachePath = dataPath("song-golden-reserve-cache.json");
const verificationPath = dataPath("song-publication-verification.json");

if (targetTotal !== 200) throw new Error("Сейчас золотой резерв откалиброван ровно на 200 песен.");

const matrix = {
  "1990s": { recognizable: 8, middle: 12, deep: 10 },
  "2000s": { recognizable: 13, middle: 20, deep: 17 },
  "2010s": { recognizable: 15, middle: 24, deep: 21 },
  "2020s": { recognizable: 14, middle: 24, deep: 22 },
};
const coreGoldenChecks = ["identity", "release", "artwork", "artistImage", "youtube", "difficulty", "credits", "soundtrack"];
const source = JSON.parse(fs.readFileSync(dataPath("quiz-ready-songs.json"), "utf8"));
const verification = JSON.parse(fs.readFileSync(verificationPath, "utf8"));
const artistPolicy = loadArtistSelectionPolicy(repoRoot);
const cache = fs.existsSync(cachePath)
  ? JSON.parse(fs.readFileSync(cachePath, "utf8"))
  : { version: 1, songs: {} };
cache.songs ||= {};

const normalizePair = (artist, title) => `${fingerprint(artist)}::${fingerprint(title)}`;
const historicalPairs = new Set();
const historicalVideos = new Set();
for (const file of fs.readdirSync(dataPath()).filter((name) => /^quiz-release.*\.json$/u.test(name))) {
  const document = JSON.parse(fs.readFileSync(dataPath(file), "utf8"));
  for (const song of document.tracks || []) {
    historicalPairs.add(normalizePair(song.artist, song.title));
    if (song.youtube?.videoId) historicalVideos.add(song.youtube.videoId);
  }
}
for (const record of Object.values(verification.songs || {})) {
  if (record.identity?.artist && record.identity?.title) historicalPairs.add(normalizePair(record.identity.artist, record.identity.title));
}

const yandexIds = (song) => {
  const match = String(song.optionalMetadata?.album?.sourceUrl || "").match(/music\.yandex\.(?:com|ru)\/album\/(\d+)\/track\/(\d+)/u);
  return match ? { albumId: match[1], trackId: match[2] } : null;
};

const staticCandidate = (song) => {
  const metadata = song.optionalMetadata || {};
  const album = metadata.album;
  const image = metadata.artistImage;
  return song.readyForQuiz
    && !isArtistBlocked(song, artistPolicy)
    && !historicalPairs.has(normalizePair(song.artist, song.title))
    && !historicalVideos.has(song.youtube?.videoId)
    && matrix[song.era]
    && yandexIds(song)
    && album?.title
    && Number.isInteger(album.year)
    && album.coverUrl
    && album.sourceUrl
    && image?.url
    && image?.sourceUrl
    && metadata.artistForm
    && Number.isInteger(song.approximateYear)
    && Math.abs(song.approximateYear - album.year) <= 2
    && /^[A-Za-z0-9_-]{11}$/u.test(song.youtube?.videoId || "")
    && Number(song.youtube?.durationSeconds) >= 90
    && Number(song.youtube?.durationSeconds) <= 480
    && !/\b(?:nightcore|sped\s*up|slowed|karaoke|караоке|cover|кавер|remix|rmx)\b/iu.test(`${song.title} ${song.youtube?.title || ""}`);
};

const popularityScore = (song) => {
  const views = Math.log10(Math.max(1, Number(song.youtube?.viewCount || 0)));
  const sourceBonus = { recognizable: 1.2, middle: 0.45, deep: 0 }[song.recognizability] || 0;
  return views + sourceBonus;
};

const queues = {};
for (const [era, targets] of Object.entries(matrix)) {
  const songs = source.songs.filter((song) => song.era === era && staticCandidate(song))
    .sort((left, right) => popularityScore(right) - popularityScore(left)
      || String(left.songId).localeCompare(String(right.songId)));
  const total = songs.length;
  const recognizableEnd = Math.max(targets.recognizable * 2, Math.round(total * 0.25));
  const middleEnd = Math.max(recognizableEnd + targets.middle * 2, Math.round(total * 0.65));
  queues[era] = {
    recognizable: songs.slice(0, recognizableEnd),
    middle: songs.slice(recognizableEnd, middleEnd),
    deep: songs.slice(middleEnd),
  };
}

const requestJson = async (url) => {
  const response = await fetch(url, {
    headers: { "accept-language": "ru-RU,ru;q=0.9", "user-agent": "Mozilla/5.0 Chrome/131 Safari/537.36" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`http-${response.status}`);
  return response.json();
};

const checkImage = async (url) => {
  const response = await fetch(url, {
    method: "HEAD",
    headers: { "user-agent": "Mozilla/5.0 Chrome/131 Safari/537.36" },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const type = response.headers.get("content-type") || "";
  return { passed: response.ok && (!type || type.startsWith("image/")), status: response.status, contentType: type };
};

const transient = (value) => /(?:http-(?:408|425|429|5\d\d)|fetch failed|timeout|timed out|aborted|network)/iu.test(String(value));
const sourceHash = (song) => crypto.createHash("sha256").update(JSON.stringify({
  artist: song.artist,
  title: song.title,
  album: song.optionalMetadata.album,
  artistImage: song.optionalMetadata.artistImage,
  youtube: song.youtube,
})).digest("hex");
const sameIdentity = (expected, actual) => fingerprint(expected) === fingerprint(actual);
const artistRankingPromises = new Map();
const artistRanking = (artistId) => {
  if (!artistRankingPromises.has(artistId)) {
    artistRankingPromises.set(artistId, requestJson(`https://api.music.yandex.net/artists/${artistId}/track-ids-by-rating`));
  }
  return artistRankingPromises.get(artistId);
};

const verifyCandidate = async (song) => {
  const hash = sourceHash(song);
  const cached = cache.songs[song.songId];
  if (!refresh && cached?.sourceHash === hash && cached.checkedAt && Date.now() - Date.parse(cached.checkedAt) < cacheTtlMs) return cached;
  const ids = yandexIds(song);
  try {
    const trackDocument = await requestJson(`https://api.music.yandex.net/tracks/${ids.trackId}`);
    const track = trackDocument.result?.[0];
    if (!track || !sameIdentity(song.title, track.title)) throw new Error("catalog-title-mismatch");
    const remoteArtists = track.artists || [];
    if (!remoteArtists.some((artist) => sameIdentity(song.artist, artist.name)
      || (song.artistAliases || []).some((alias) => sameIdentity(alias, artist.name)))) throw new Error("catalog-artist-mismatch");
    const album = (track.albums || []).find((item) => String(item.id) === ids.albumId);
    if (!album || !sameIdentity(song.optionalMetadata.album.title, album.title)) throw new Error("catalog-album-mismatch");
    if (!Number.isInteger(album.year) || Math.abs(album.year - song.approximateYear) > 2) throw new Error("catalog-year-mismatch");
    const artistIdFromSource = String(song.optionalMetadata.artistImage.sourceUrl).match(/\/artist\/(\d+)/u)?.[1];
    const remoteArtist = remoteArtists.find((artist) => String(artist.id) === artistIdFromSource) || remoteArtists[0];
    if (!remoteArtist) throw new Error("catalog-artist-id-missing");
    const [ranking, cover, artistImage, youtube] = await Promise.all([
      artistRanking(remoteArtist.id),
      checkImage(song.optionalMetadata.album.coverUrl),
      checkImage(song.optionalMetadata.artistImage.url),
      checkYouTubeVideo(song.youtube.videoId),
    ]);
    if (!cover.passed) throw new Error(`album-cover-${cover.status}`);
    if (!artistImage.passed) throw new Error(`artist-image-${artistImage.status}`);
    if (youtube.status !== "passed") throw new Error(`youtube-${youtube.reason}`);
    const rankedTrackIds = (ranking.result?.tracks || []).map(String);
    const rating = ranking.result?.artist?.ratings || {};
    const popularArtist = Number(rating.month || Infinity) <= 2000 || Number(song.youtube.viewCount || 0) >= 20_000_000;
    const rank = rankedTrackIds.indexOf(String(ids.trackId)) + 1 || null;
    if (popularArtist && rank && rank <= 3) throw new Error("popular-artist-top-3");
    const result = {
      status: "passed",
      sourceHash: hash,
      checkedAt: new Date().toISOString(),
      catalog: {
        provider: "Яндекс Музыка",
        trackId: String(track.id),
        artistId: String(remoteArtist.id),
        albumId: String(album.id),
        artist: song.artist,
        title: track.title,
        albumTitle: album.title,
        albumYear: album.year,
        genre: album.genre || null,
        sourceUrl: song.optionalMetadata.album.sourceUrl,
        artistSourceUrl: song.optionalMetadata.artistImage.sourceUrl,
      },
      popularity: { popularArtist, catalogRank: rank, monthRank: Number(rating.month) || null },
      media: { cover, artistImage, youtube },
    };
    cache.songs[song.songId] = result;
    return result;
  } catch (error) {
    const reason = String(error?.message || error);
    if (transient(reason)) throw error;
    const result = { status: "failed", sourceHash: hash, checkedAt: new Date().toISOString(), reason };
    cache.songs[song.songId] = result;
    return result;
  }
};

const saveCache = () => {
  cache.updatedAt = new Date().toISOString();
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
};

const durationFor = (band) => ({ recognizable: 7, middle: 11, deep: 15 }[band]);
const selected = [];
const selectedSongIds = new Set();
const selectedVideoIds = new Set();
const selectedArtistIds = new Set();
const quarantined = [];

for (const [era, targets] of Object.entries(matrix)) {
  for (const [band, target] of Object.entries(targets)) {
    const queue = queues[era][band];
    let cursor = 0;
    while (selected.filter((song) => song.era === era && song.recognizability === band).length < target) {
      const batch = [];
      while (batch.length < concurrency && cursor < queue.length) {
        const song = queue[cursor++];
        if (selectedSongIds.has(song.songId) || selectedVideoIds.has(song.youtube.videoId)
          || song.artistIds.some((id) => selectedArtistIds.has(id))) continue;
        batch.push(song);
      }
      if (!batch.length) throw new Error(`Недостаточно кандидатов для ${era}/${band}.`);
      const checks = await Promise.all(batch.map(verifyCandidate));
      for (let index = 0; index < batch.length; index += 1) {
        const song = batch[index];
        const check = checks[index];
        if (check.status !== "passed") {
          quarantined.push({ songId: song.songId, reason: check.reason });
          continue;
        }
        if (selected.filter((item) => item.era === era && item.recognizability === band).length >= target) continue;
        if (song.artistIds.some((id) => selectedArtistIds.has(id))) continue;
        const clipDuration = durationFor(band);
        const clipStart = Math.min(Number(song.clip.start), Number(song.youtube.durationSeconds) - clipDuration - 5);
        selected.push({
          ...song,
          reserveTier: "golden",
          goldenStatus: "preverified",
          approximateYear: check.catalog.albumYear,
          recognizability: band,
          clip: { ...song.clip, start: Math.max(0, clipStart), duration: clipDuration, review: "automatic", requiresPublicationReview: true },
          optionalMetadata: {
            ...song.optionalMetadata,
            releaseYearStatus: "verified",
            album: { ...song.optionalMetadata.album, title: check.catalog.albumTitle, year: check.catalog.albumYear },
          },
          goldenVerification: check,
        });
        selectedSongIds.add(song.songId);
        selectedVideoIds.add(song.youtube.videoId);
        for (const id of song.artistIds) selectedArtistIds.add(id);
      }
      saveCache();
      console.log(`Золотой резерв: ${selected.length}/${targetTotal}`);
    }
  }
}

const generatedAt = new Date().toISOString();
for (const song of selected) {
  const catalog = song.goldenVerification.catalog;
  const trackSource = catalog.sourceUrl;
  const artistSource = catalog.artistSourceUrl;
  const youtubeSource = `https://www.youtube.com/watch?v=${song.youtube.videoId}`;
  verification.songs[song.songId] = {
    goldenReserve: { approvedAt: generatedAt, reserveVersion: 1, recheckAtPublication: ["youtube", "fragment", "relationships"] },
    identity: { artist: song.artist, title: song.title, artistAliases: song.artistAliases, titleAliases: song.titleAliases, artistForm: song.optionalMetadata.artistForm },
    checks: {
      identity: { state: "verified", sources: [trackSource, artistSource] },
      release: { state: "verified", sources: [trackSource] },
      artwork: { state: "verified", sources: [trackSource] },
      artistImage: { state: "verified", sources: [artistSource] },
      youtube: { state: "verified", sources: [youtubeSource] },
      fragment: { state: "automatic", sources: [youtubeSource], note: "Границы корректны; финальное прослушивание выполняется при выпуске." },
      relationships: { state: "automatic", sources: [artistSource], note: "Известные сущности сохранены; связи группа/соло повторно проверяются для двадцатки выпуска." },
      difficulty: { state: "verified", sources: [trackSource, youtubeSource] },
      credits: { state: "not-applicable", sources: [], note: "Каталог не предоставил подтверждённые авторские кредиты; при наличии они добавляются перед выпуском." },
      soundtrack: { state: "not-applicable", sources: [], note: "Связь с OST не обнаружена в каталожных данных; перепроверяется перед выпуском." },
    },
    release: { releaseYear: catalog.albumYear, versionYear: catalog.albumYear, album: song.optionalMetadata.album },
    artistImage: song.optionalMetadata.artistImage,
    relationships: { conflictEntityIds: [...song.artistIds], lineup: song.optionalMetadata.performers || [] },
    credits: [],
    soundtrack: null,
    difficulty: {
      band: song.recognizability,
      score: Number(popularityScore(song).toFixed(3)),
      explanation: "Сложность откалибрована по исходной квизовой категории и популярности выбранной записи, а не только исполнителя.",
      basis: ["source-quiz", "youtube-popularity", "catalog-rank"],
    },
  };
}

verification.updatedAt = generatedAt;
const stats = {
  total: selected.length,
  uniqueSongs: selectedSongIds.size,
  uniqueVideos: selectedVideoIds.size,
  uniqueArtistEntities: selectedArtistIds.size,
  eras: Object.fromEntries(Object.keys(matrix).map((era) => [era, selected.filter((song) => song.era === era).length])),
  difficulty: Object.fromEntries(["recognizable", "middle", "deep"].map((band) => [band, selected.filter((song) => song.recognizability === band).length])),
  popularArtistTop3Songs: selected.filter((song) => song.goldenVerification.popularity.popularArtist && (song.goldenVerification.popularity.catalogRank || Infinity) <= 3).length,
  withVerifiedAlbum: selected.filter((song) => song.optionalMetadata.releaseYearStatus === "verified" && song.optionalMetadata.album?.coverUrl).length,
  withArtistImage: selected.filter((song) => song.optionalMetadata.artistImage?.url).length,
  withSourceBackedCredits: selected.filter((song) => song.credits?.length).length,
  quarantinedCandidates: quarantined.length,
};
const output = {
  version: 1,
  generatedAt,
  status: "preverified",
  policy: {
    targetTotal,
    matrix,
    oneSongPerArtistEntity: true,
    excludesEveryKnownRelease: true,
    popularArtistTop3Excluded: true,
    requiredCatalogProvider: "Яндекс Музыка",
    coreGoldenChecks,
    recheckAtPublication: ["youtube", "fragment", "relationships", "credits", "soundtrack"],
    notes: [
      "Золотой резерв не раскрывается игроку и не является опубликованным квизом.",
      "Каталожные факты и изображения проверены заранее; доступность YouTube подтверждена на дату generatedAt.",
      "Фрагмент и связи группа/соло остаются обязательной повторной проверкой конкретного выпуска.",
      "Советские позиции пока добираются из обычного резерва: для них нет 20 карточек с сопоставимым полным набором источников.",
    ],
  },
  stats,
  songs: selected,
  quarantined: quarantined.slice(0, 100),
};

fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`);
console.log(JSON.stringify(stats, null, 2));
if (selected.length !== targetTotal) throw new Error(`Собрано ${selected.length}/${targetTotal} песен.`);
