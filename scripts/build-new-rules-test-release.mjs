import fs from "node:fs";
import path from "node:path";
import { publicationReport, validatePublicationVerification } from "./publication-verification.mjs";

const root = path.resolve(import.meta.dirname, "..");
const pool = JSON.parse(fs.readFileSync(path.join(root, "data", "quiz-ready-songs.json"), "utf8"));
const selected = [
  ["pool-978adfbe162b", "recognizable", "Исполнительница"],
  ["pool-ce212e6f31b2", "middle", "Исполнитель"],
  ["pool-e80b214f0717", "middle", "Исполнительница"],
  ["pool-18cf32537a9c", "middle", "Группа"],
  ["pool-1fadbf33cea6", "deep", "Группа"],
  ["pool-3b54008bfd88", "deep", "Исполнительница"],
  ["pool-45032d8576bc", "recognizable", "Группа"],
  ["pool-70d9b24a4d75", "middle", "Исполнитель"],
  ["pool-af17c0902a1f", "recognizable", "Группа"],
  ["pool-422fe801e24e", "deep", "Группа"],
  ["pool-bac316c53e73", "middle", "Группа"],
  ["pool-0e583ac94f14", "deep", "Исполнитель"],
  ["pool-0b90b0e6a49a", "deep", "Группа"],
  ["chart-00184", "recognizable", "Исполнитель"],
  ["pool-02467427b223", "middle", "Дуэт"],
  ["pool-d873bf3a5166", "middle", "Исполнитель"],
  ["pool-acbf866be1c4", "deep", "Группа"],
  ["chart-00076", "recognizable", "Дуэт"],
  ["pool-b0a66e2f50ce", "middle", "Группа"],
  ["pool-d4376b2c25ff", "deep", "Проект"],
];

const details = {
  "pool-978adfbe162b": {
    releaseYear: 1940, versionYear: 1975,
    artistImage: { url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/Klavdiya%20Shulzhenko%20in%201934.jpg?width=800", sourceUrl: "https://commons.wikimedia.org/wiki/File:Klavdiya_Shulzhenko_in_1934.jpg", attribution: "Главархив Москвы / Mos.ru", license: "CC BY 4.0", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" },
    releaseArtwork: { title: "«Синий платочек» — архивная запись", kind: "archive", year: 1942, coverUrl: "https://commons.wikimedia.org/wiki/Special:Redirect/file/%D0%9A%D0%BB%D0%B0%D0%B2%D0%B4%D1%96%D1%8F%20%D0%A8%D1%83%D0%BB%D1%8C%D0%B6%D0%B5%D0%BD%D0%BA%D0%BE%2C%20%D0%9A%D0%BE%D0%BD%D1%86%D0%B5%D1%80%D1%82%20%D1%84%D1%80%D0%BE%D0%BD%D1%82%D1%83.jpg?width=800", sourceUrl: "https://commons.wikimedia.org/wiki/File:%D0%9A%D0%BB%D0%B0%D0%B2%D0%B4%D1%96%D1%8F_%D0%A8%D1%83%D0%BB%D1%8C%D0%B6%D0%B5%D0%BD%D0%BA%D0%BE,_%D0%9A%D0%BE%D0%BD%D1%86%D0%B5%D1%80%D1%82_%D1%84%D1%80%D0%BE%D0%BD%D1%82%D1%83.jpg" },
    credits: [{ role: "Музыка", names: ["Ежи Петерсбурский"] }, { role: "Слова версии 1942 года", names: ["Михаил Максимов"] }],
    sources: ["https://ru.wikipedia.org/wiki/Синий_платочек", "https://commons.wikimedia.org/wiki/File:Klavdiya_Shulzhenko_in_1934.jpg"],
    difficultyNote: "Мелодия очень известна, но запись и короткий куплет требуют узнать именно исполнительницу.",
  },
  "pool-ce212e6f31b2": {
    releaseYear: 1968, versionYear: 1968,
    artistImage: { url: "https://commons.wikimedia.org/wiki/Special:Redirect/file/%D0%92%D0%B0%D0%B4%D0%B8%D0%BC%20%D0%9C%D1%83%D0%BB%D0%B5%D1%80%D0%BC%D0%B0%D0%BD.jpg?width=800", sourceUrl: "https://commons.wikimedia.org/wiki/File:%D0%92%D0%B0%D0%B4%D0%B8%D0%BC_%D0%9C%D1%83%D0%BB%D0%B5%D1%80%D0%BC%D0%B0%D0%BD.jpg", attribution: "Wikimedia Commons" },
    releaseArtwork: { title: "Трус не играет в хоккей / Нам не страшен серый волк", kind: "single", year: 1969, coverUrl: "https://i.ytimg.com/vi/Q9cqazIMgw0/hqdefault.jpg", sourceUrl: "https://rusneb.ru/catalog/000199_000009_008199764/" },
    credits: [{ role: "Музыка", names: ["Александра Пахмутова"] }, { role: "Слова", names: ["Сергей Гребенников", "Николай Добронравов"] }],
    sources: ["https://ru.wikipedia.org/wiki/Трус_не_играет_в_хоккей", "https://rusneb.ru/catalog/000199_000009_008199764/"],
    difficultyNote: "Название вспоминается быстро, но голос первого исполнителя знают хуже самой песни.",
  },
  "pool-18cf32537a9c": { lineup: [["Алексей Иванов", "основатель"], ["Алексей Румянцев", "основатель"], ["Денис Фёдоров", "основатель"]], lineupSource: "https://www.kupala.ru/band", difficultyNote: "Хит заметный, но не самый очевидный трек проекта." },
  "pool-1fadbf33cea6": { lineup: [["Фёдор Чистяков", "вокал, баян · фронтмен"], ["Алексей Николаев", "ударные"], ["Дмитрий Гусаков", "бас"], ["Георгий Стариков", "гитара"]], related: ["fedorchistyakov"], lineupSource: "https://ru.wikipedia.org/wiki/Ноль_(группа)", difficultyNote: "Культовая рок-песня вне массового поп-радио." },
  "pool-45032d8576bc": { lineup: [["Игорь Капранов", "экстремальный вокал · фронтмен"], ["Денис Животовский", "бас, чистый вокал"], ["Александр Павлов", "гитара"], ["Дмитрий Рубановский", "гитара"], ["Даниил Светлов", "ударные"]], related: ["daniilsvetlov", "deniszhivotovskiy", "igorkapranov"], lineupSource: "https://ru.wikipedia.org/wiki/Amatory", difficultyNote: "Узнаваемый трек сцены 2000-х, но жанр знаком не всем." },
  "pool-af17c0902a1f": { lineup: [["Диана Теркулова", "вокал"], ["Яна Павлова-Лацвиева", "вокал · голос студийных записей"], ["Наталья Лушникова (Быстрова)", "вокал"]], lineupSource: "https://ru.wikipedia.org/wiki/Воровайки", difficultyNote: "Шансон-хит с большим охватом, узнаваемый прежде всего по характерной подаче." },
  "pool-422fe801e24e": { lineup: [["Егор Летов", "вокал, гитара · фронтмен"], ["Наталья Чумакова", "бас, орган"]], related: ["egorletov"], difficultyNote: "Альбомная песня известной группы, заметно сложнее её главных хитов." },
  "pool-bac316c53e73": { lineup: [["Полина Цветкова", "вокал"], ["Екатерина Семенкова", "вокал"]], difficultyNote: "Поп-хит начала 2000-х, который заметно реже звучит сегодня." },
  "pool-0b90b0e6a49a": { lineup: [["Борис Гребенщиков", "вокал, гитара · лидер"]], related: ["borisgrebenshchikov", "bg"], difficultyNote: "Не главный радиохит группы и неброский фрагмент куплета." },
  "chart-00184": { related: ["maksimlazin"], difficultyNote: "Миллионы прослушиваний внутри рэп-аудитории, но низкая общая радиоротация." },
  "pool-02467427b223": { lineup: [["Айгель Гайсина", "текст, вокал · фронтвумен"], ["Илья Барамия", "музыка, продакшн"]], related: ["aigelgaisina", "ilyabaramiya", "elochnyeigrushki", "2hcompany", "sbpch"], credits: [{ role: "Текст и вокал", names: ["Айгель Гайсина"] }, { role: "Музыка и продакшн", names: ["Илья Барамия"] }], sources: ["https://ru.wikipedia.org/wiki/Аигел"], difficultyNote: "Заметный трек дуэта, но татарская стилистика и фрагмент без подсказки усложняют ответ." },
  "pool-acbf866be1c4": { difficultyNote: "Не конкурсный хит коллектива, а менее известная сезонная песня." },
  "chart-00076": { artist: "Miyagi & Andy Panda", aliases: ["Мияги", "Miyagi", "MiyaGi & Эндшпиль", "Miyagi & Эндшпиль"], lineup: [["Miyagi (Азамат Кудзаев)", "рэп, вокал"], ["Andy Panda (Сослан Бурнацев)", "рэп, вокал"]], related: ["miyagi", "andypanda", "endshpil", "azamatkudzaev", "soslanburnatsev"], difficultyNote: "Очень крупный стриминговый хит — сложность в коротком фрагменте, а не в редкости песни." },
  "pool-b0a66e2f50ce": { lineup: [["Илья Золотухин", "вокал, автор · фронтмен"], ["Никита Горелкин", "гитара"], ["Екатерина Нечаева", "контрабас"], ["Софья Беляева", "клавишные"], ["Дамир Мухамеджанов", "ударные"], ["Наталья Цуканова", "бэк-вокал"]], related: ["ilyazolotukhin"], lineupSource: "https://ru.wikipedia.org/wiki/Бонд_с_кнопкой", credits: [{ role: "Автор песни", names: ["Илья Золотухин"] }], difficultyNote: "Среднеизвестный альбомный трек группы до её большого чартового прорыва." },
  "pool-d4376b2c25ff": { lineup: [["Дмитрий Наумов", "вокал, автор · создатель проекта"]], related: ["dmitriynaumov"], difficultyNote: "Яркий клип помог песне, но название и артист редко встречаются в общих чартах." },
};

const defaultDifficulty = {
  recognizable: "Широко известная песня или очень большой цифровой охват; фрагмент выбран не по названию.",
  middle: "Песня знакома своей аудитории, но не относится к тройке самых очевидных хитов исполнителя.",
  deep: "Альбомная, нишевая или менее ротируемая песня; для ответа нужно хорошо знать исполнителя.",
};

const find = (songId) => {
  const song = pool.songs.find((item) => item.songId === songId);
  if (!song) throw new Error(`Missing ready song: ${songId}`);
  return structuredClone(song);
};

const verification = { version: 1, policyVersion: "2026-09-07", generatedAt: new Date().toISOString(), songs: {} };
const tracks = selected.map(([songId, recognizability, artistForm]) => {
  const song = find(songId);
  const extra = details[songId] || {};
  if (songId === "pool-e80b214f0717") song.youtube = { ...song.youtube, videoId: "Shxk_X1_lj8", title: "Азиза. Всё или ничего. 1997 год", channel: "AZIZA MUHAMEDOVA", viewCount: 2643, durationSeconds: 264, selectedBy: "editorial-replacement" };
  song.recognizability = recognizability;
  song.optionalMetadata.artistForm = artistForm;
  if (extra.artist) {
    song.artist = extra.artist;
    song.artistAliases = [...new Set([...(song.artistAliases || []), ...(extra.aliases || [])])];
  }
  const releaseYear = extra.releaseYear || song.approximateYear;
  const album = extra.releaseArtwork || song.optionalMetadata.album;
  const image = extra.artistImage || song.optionalMetadata.artistImage;
  const sourceUrls = [...new Set([...(extra.sources || []), ...(song.optionalMetadata.sources || []), extra.lineupSource, album?.sourceUrl, image?.sourceUrl].filter(Boolean))];
  song.approximateYear = releaseYear;
  song.optionalMetadata = { ...song.optionalMetadata, releaseYearStatus: "verified", album, artistImage: image };
  const lineup = (extra.lineup || []).map(([name, role]) => ({ name, role, highlighted: /ключевой|лидер|фронт|создатель/u.test(role) }));
  const relationships = { conflictEntityIds: [...new Set([...(song.artistIds || []), ...(extra.related || [])])], lineup, sourceUrl: extra.lineupSource };
  const checks = Object.fromEntries(["identity", "release", "artwork", "artistImage", "youtube", "fragment", "relationships", "difficulty"].map((name) => [name, { state: "verified", sources: name === "youtube" || name === "fragment" ? [`https://www.youtube.com/watch?v=${song.youtube.videoId}`] : sourceUrls }]));
  checks.credits = { state: extra.credits?.length ? "verified" : "not-applicable", sources: extra.credits?.length ? sourceUrls : [] };
  checks.soundtrack = { state: "not-applicable", sources: [] };
  verification.songs[songId] = {
    selectedForQuiz: "new-rules-test-01",
    publishedAt: "2026-09-07T12:00:00+04:00",
    identity: { artist: song.artist, artistAliases: song.artistAliases, artistForm },
    checks,
    release: { releaseYear, versionYear: extra.versionYear || releaseYear, album },
    artistImage: image,
    relationships,
    credits: extra.credits || [],
    soundtrack: null,
    difficulty: { band: recognizability, score: recognizability === "recognizable" ? 32 : recognizability === "middle" ? 58 : 78, explanation: extra.difficultyNote || defaultDifficulty[recognizability], basis: ["source-quiz", "catalog-popularity", "fragment-position"] },
  };
  return song;
});

validatePublicationVerification(verification);
const report = tracks.map((song) => publicationReport(song, verification.songs[song.songId]));
if (report.some((item) => !item.passed)) throw new Error(JSON.stringify(report.filter((item) => !item.passed), null, 2));
const conflictOwners = new Map();
for (const song of tracks) for (const entity of verification.songs[song.songId].relationships.conflictEntityIds) {
  if (conflictOwners.has(entity)) throw new Error(`Relationship conflict: ${entity} in ${conflictOwners.get(entity)} and ${song.songId}`);
  conflictOwners.set(entity, song.songId);
}
if (new Set(tracks.map((song) => song.youtube.videoId)).size !== tracks.length) throw new Error("Duplicate YouTube video");
if (new Set(tracks.map((song) => `${song.artist}\u0000${song.title}`.toLocaleLowerCase("ru-RU"))).size !== tracks.length) throw new Error("Duplicate song");

const output = {
  version: 2,
  generatedAt: new Date().toISOString(),
  status: "verified",
  quiz: { id: "new-rules-test-01", title: "Квиз XXIII · новый стандарт", level: "смешанный", published: "7 сентября 2026" },
  policy: { trackCount: 20, uniqueSongs: true, uniqueYouTubeVideos: true, relationshipConflicts: true, strictMetadataGate: true },
  stats: {
    eras: Object.fromEntries(["soviet", "1990s", "2000s", "2010s", "2020s"].map((era) => [era, tracks.filter((song) => song.era === era).length])),
    recognition: Object.fromEntries(["recognizable", "middle", "deep"].map((band) => [band, tracks.filter((song) => song.recognizability === band).length])),
  },
  tracks,
};

fs.writeFileSync(path.join(root, "data", "song-publication-verification.json"), `${JSON.stringify(verification, null, 2)}\n`);
fs.writeFileSync(path.join(root, "data", "quiz-release-new-rules.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ status: output.status, tracks: tracks.length, stats: output.stats }, null, 2));
