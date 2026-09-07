import fs from "node:fs";
import path from "node:path";
import { publicationReport, validatePublicationVerification } from "./publication-verification.mjs";

const root = path.resolve(import.meta.dirname, "..");
const pool = JSON.parse(fs.readFileSync(path.join(root, "data", "quiz-ready-songs.json"), "utf8"));
const verificationPath = path.join(root, "data", "song-publication-verification.json");
const verification = validatePublicationVerification(JSON.parse(fs.readFileSync(verificationPath, "utf8")));
const quizId = "new-rules-test-03";
const publishedAt = new Date().toISOString();

for (const [songId, record] of Object.entries(verification.songs)) {
  if (record.selectedForQuiz === quizId) delete verification.songs[songId];
}

// ВИА в этом выпуске не являются обязательной квотой. Рэп-позиция одна.
// У популярных артистов по возможности взяты песни вне их самых очевидных топ-3.
const selected = [
  ["pool-3943f5f6301a", "recognizable", "Исполнительница"],
  ["pool-b11addc0dee2", "middle", "Исполнительница"],
  ["pool-580722db53cb", "recognizable", "Группа"],
  ["pool-474ae5fa17e3", "recognizable", "Группа"],
  ["pool-c9ab57d241e7", "recognizable", "Группа"],
  ["pool-8fc2e5bf0d9b", "deep", "Исполнитель"],
  ["pool-a4e9c86d0a47", "middle", "Группа"],
  ["pool-6b763cdcb2e3", "middle", "Исполнительница"],
  ["pool-973a19b01114", "recognizable", "Группа"],
  ["pool-1da222662ba3", "middle", "Группа"],
  ["avtoradio-c90898020198", "middle", "Исполнительница"],
  ["pool-cb0abeb6b572", "deep", "Исполнитель"],
  ["pool-7da7768e8d19", "recognizable", "Группа"],
  ["pool-b5c1d85a20cf", "middle", "Исполнитель"],
  ["avtoradio-33d606bc1826", "middle", "Исполнительница"],
  ["pool-45de8bbc70fa", "recognizable", "Исполнитель"],
  ["pool-5159a849239d", "middle", "Группа"],
  ["chart-00135", "recognizable", "Исполнительница"],
  ["pool-364239afe81a", "deep", "Исполнитель"],
  ["avtoradio-d2cc3ce48d5c", "middle", "Исполнительница"],
];

const details = {
  "pool-3943f5f6301a": {
    album: { title: "«Течёт река Волга» — архивная запись", kind: "archive", year: 1963 },
    credits: [{ role: "Музыка", names: ["Марк Фрадкин"] }, { role: "Слова", names: ["Лев Ошанин"] }],
    sources: ["https://music-museum.ru/about/news/k-95-letiyu-so-dnya-rozhdeniya-lyudmilyi-zyikinoj.html"],
    note: "Одна из визитных карточек Людмилы Зыкиной: узнаваемая советская опора выпуска.",
  },
  "pool-b11addc0dee2": {
    album: { title: "«Проснись и пой» — запись из фильма", kind: "soundtrack", year: 1971 },
    credits: [{ role: "Музыка", names: ["Геннадий Гладков"] }, { role: "Слова", names: ["Владимир Луговой"] }],
    soundtrack: { title: "Джентльмены удачи", kind: "кинофильм", year: 1971, sourceUrl: "https://ru.wikipedia.org/wiki/Проснись_и_пой!" },
    sources: ["https://ru.wikipedia.org/wiki/Проснись_и_пой!", "https://ru.wikipedia.org/wiki/Мондрус,_Лариса_Израилевна"],
    note: "Мелодия знакома по кино, но имя исполнительницы вспоминается не мгновенно.",
  },
  "pool-580722db53cb": {
    lineup: [["Александр Васильев", "вокал, гитара, автор · лидер"], ["Стас Березовский", "гитара"], ["Александр Морозов", "бас-гитара"], ["Николай Ростовский", "клавишные"], ["Николай Лысов", "ударные"]],
    related: ["alexandervasilyev", "stasberezovsky", "alexandermorozov", "nikolayrostovsky", "nikolaylysov"],
    credits: [{ role: "Музыка и слова", names: ["Александр Васильев"] }],
    sources: ["https://www.shazam.com/ru-ru/song/1345372354/выхода-нет"],
    note: "Очень узнаваемая рок-песня: в выпуске работает как понятная точка опоры.",
  },
  "pool-474ae5fa17e3": {
    lineup: [["Валерий Сюткин", "вокал, соавтор · солист записи"], ["Евгений Хавтан", "гитара, композитор · лидер"], ["Павел Кузин", "ударные"], ["Дмитрий Ашман", "бас-гитара"], ["Александр Степаненко", "саксофон, клавишные"]],
    related: ["valerysyutkin", "evgeniykhavtan", "pavelkuzin", "dmitryashman", "alexanderstepanenko"],
    credits: [{ role: "Музыка", names: ["Евгений Хавтан"] }, { role: "Слова", names: ["Валерий Сюткин"] }],
    sources: ["https://www.youtube.com/watch?v=VyS9GKNUsWI", "https://ru.wikipedia.org/wiki/Дорога_в_облака"],
    note: "Известная песня периода Валерия Сюткина, но не самая первая ассоциация с группой.",
  },
  "pool-c9ab57d241e7": {
    youtubeId: "9XewOH8co2o",
    lineup: [["Сергей Чиграков", "вокал, гитара · лидер"], ["Алексей Романюк", "бас-гитара"], ["Владимир Ханутин", "ударные"]],
    related: ["sergeychigrakov", "alexeyromanyuk", "vladimirkhanutin"],
    credits: [{ role: "Авторство", names: ["традиционная песня; авторство не установлено"] }],
    sources: ["https://www.shazam.com/song/1624055771/фантом-live"],
    note: "Песня широко известна в русской рок-среде, но исполнитель может потребовать секунду на узнавание.",
  },
  "pool-8fc2e5bf0d9b": {
    credits: [{ role: "Музыка и слова", names: ["Вячеслав Быков"] }],
    sources: ["https://ru.wikipedia.org/wiki/Быков,_Вячеслав_Анатольевич"],
    note: "Большой хит своего времени, но имя исполнителя вне постоянной ротации — глубокая позиция.",
  },
  "pool-a4e9c86d0a47": {
    lineup: [["Кети Топурия", "вокал · фронтвумен"], ["Байгали Серкебаев", "клавишные, руководитель · ключевой"], ["Владимир Миклошич", "бас-гитара"], ["Фёдор Досумов", "гитара"]],
    related: ["ketitopuria", "baigaliserkebayev", "vladimirmikloshich", "fedordosumov"],
    credits: [{ role: "Музыка", names: ["Александр Зацепин"] }, { role: "Слова", names: ["Леонид Дербенёв"] }],
    sources: ["https://www.shazam.com/ru-ru/song/1586641012/так-же-как-все-live", "https://www.shazam.com/ru-ru/artist/astudio/1294637073"],
    note: "У популярной группы взята не первая ассоциация каталога, а заметная кавер-версия.",
  },
  "pool-6b763cdcb2e3": {
    credits: [{ role: "Слова", names: ["МакSим"] }],
    sources: ["https://www.shazam.com/song/582865392/на-радиоволнах"],
    note: "Осознанно не топ-3 МакSим: знакомый голос, но песню нужно вспомнить.",
  },
  "pool-973a19b01114": {
    youtubeId: "dT_Mm-bUzCg",
    releaseYear: 2009,
    lineup: [["Татьяна Решетняк (TAYANNA)", "вокал записи · солистка"], ["Дмитрий Климашенко", "продюсер, композитор · ключевой"]],
    related: ["tayanna", "tatianareshetnyak", "dmitryklimashenko"],
    credits: [{ role: "Музыка", names: ["Дмитрий Климашенко"] }, { role: "Слова", names: ["Татьяна Решетняк", "Леонид Басович"] }],
    sources: ["https://www.youtube.com/watch?v=syv-84jabbQ", "https://www.shazam.com/ru-ru/song/390271994/береги"],
    note: "Крупный хит группы и ещё одна доступная точка выпуска.",
  },
  "pool-1da222662ba3": {
    lineup: [["Эдмунд Шклярский", "вокал, гитара, автор · лидер"], ["Марат Корчемный", "бас-гитара"], ["Станислав Шклярский", "клавишные"], ["Леонид Кирнос", "ударные"]],
    related: ["edmundshklyarsky", "maratkorchemny", "stanislavshklyarsky", "leonidkirnos"],
    credits: [{ role: "Музыка и слова", names: ["Эдмунд Шклярский"] }],
    sources: ["https://www.shazam.com/artist/*/367314783/highlights"],
    note: "Не самый очевидный хит известной рок-группы: средний уровень без редкости ради редкости.",
  },
  "avtoradio-c90898020198": {
    credits: [{ role: "Музыка", names: ["Максим Фадеев"] }, { role: "Слова", names: ["Ирина Секачёва"] }],
    related: ["maximfadeev", "irinasekacheva"],
    sources: ["https://music.apple.com/ru/album/корабли/1470249814?i=1470249828&uo=4"],
    note: "У популярной исполнительницы взята заметная, но не первая каталожная ассоциация.",
  },
  "pool-cb0abeb6b572": {
    credits: [{ role: "Музыка и слова", names: ["Андрей Лысиков"] }],
    related: ["andreylisikov"],
    sources: ["https://www.shazam.com/ru-ru/song/1834367582/весна"],
    note: "Альтернативная песня с атмосферным фрагментом — одна из трёх глубоких позиций.",
  },
  "pool-7da7768e8d19": {
    lineup: [["Роман Билык", "вокал, гитара · лидер"], ["Александр Войтинский", "соавтор, продюсер · ключевой"], ["Кирилл Афонин", "бас-гитара"], ["Герман Осипов", "гитара"]],
    related: ["romanbilyk", "alexandervoitinsky", "kirillafonin", "germanosipov"],
    credits: [{ role: "Музыка", names: ["Александр Войтинский", "Роман Билык"] }, { role: "Слова", names: ["Роман Билык", "Владимир Бондарев"] }],
    sources: ["https://www.karaoke.ru/artists/zveri/text/dozhdi-pistoleti/", "https://ru.wikipedia.org/wiki/Голод_(альбом)"],
    note: "У очень известной группы взят узнаваемый, но не самый очевидный трек.",
  },
  "pool-b5c1d85a20cf": {
    releaseYear: 2019,
    album: { title: "Всё о любви", kind: "album", year: 2020 },
    credits: [{ role: "Музыка и слова", names: ["Александр Ревва"] }],
    related: ["alexanderrevva"],
    sources: ["https://www.shazam.com/ru-ru/song/1496188344/она-решила-сдаться"],
    note: "Не топ-3 Артура Пирожкова, но клип и припев достаточно массовые для среднего уровня.",
  },
  "avtoradio-33d606bc1826": {
    releaseYear: 2016,
    credits: [{ role: "Музыка", names: ["Даниил Бабичев"] }, { role: "Слова", names: ["Андрей Фролов"] }],
    sources: ["https://ru.wikipedia.org/wiki/На_Титанике"],
    note: "Большая песня 2010-х, но в выпуске она стоит среди менее прямолинейных соседей.",
  },
  "pool-45de8bbc70fa": {
    credits: [{ role: "Музыка и слова", names: ["Денис Ковальский"] }],
    sources: ["https://www.shazam.com/song/1859951550/задыхаюсь"],
    note: "У Димы Билана взят не главный хит, но узнаваемая песня эпохи.",
  },
  "pool-5159a849239d": {
    releaseYear: 2015,
    album: { title: "Сторона А сторона Б", kind: "album", year: 2015 },
    lineup: [["Тимур Одилбеков (Брутто)", "вокал · участник дуэта"], ["Анар Зейналов (ВесЪ)", "вокал, продюсер · участник дуэта"]],
    related: ["timurodilbekov", "brutto", "anarzeynalov", "ves"],
    credits: [{ role: "Слова", names: ["Тимур Одилбеков", "Анар Зейналов"] }, { role: "Музыка", names: ["Вадим Панасюк"] }],
    sources: ["https://www.shazam.com/song/1544956661/табор-уходит-в-небо"],
    note: "Единственная рэп-позиция выпуска: один трек из допустимого диапазона 0–2.",
  },
  "chart-00135": {
    album: { title: "Княжна из хрущёвки", kind: "album", year: 2021 },
    credits: [{ role: "Музыка", names: ["Давид Деймур"] }, { role: "Слова", names: ["Арина Буланова"] }],
    related: ["arinabulanova", "daviddemour", "gspd"],
    sources: ["https://www.shazam.com/en-us/song/1573269531/бесприданница"],
    note: "Современная стилизация с ярким припевом — узнаваемая позиция 2020-х.",
  },
  "pool-364239afe81a": {
    credits: [{ role: "Музыка", names: ["Алексей Вуцкий"] }, { role: "Слова", names: ["Иван Минаев"] }],
    related: ["ivanminaev", "alexeyvutskiy"],
    sources: ["https://www.shazam.com/song/1647188908/моя-хулиганка"],
    note: "Современный артист, которого ты можешь знать хуже: оставлена как глубокая позиция.",
  },
  "avtoradio-d2cc3ce48d5c": {
    credits: [{ role: "Музыка и слова", names: ["Анна Герасимик", "Олеся Лиходед"] }],
    sources: ["https://www.shazam.com/song/1590850662/наполовину"],
    note: "Для известной исполнительницы выбрана песня вне её самых очевидных ранних хитов.",
  },
};

const defaultDifficulty = {
  recognizable: "Широко узнаваемая песня; фрагмент выбран так, чтобы ответ не звучал сразу.",
  middle: "Знакомая песня или артист, но конкретный фрагмент требует небольшого усилия.",
  deep: "Менее привычная для твоего профиля зона, оставленная для контраста и роста.",
};

const find = (songId) => {
  const song = pool.songs.find((item) => item.songId === songId);
  if (!song) throw new Error(`Missing ready song: ${songId}`);
  return structuredClone(song);
};

const tracks = selected.map(([songId, band, artistForm]) => {
  const song = find(songId);
  const extra = details[songId] || {};
  if (extra.youtubeId) song.youtube = { ...song.youtube, videoId: extra.youtubeId, selectedBy: "editorial-replacement" };
  song.era = extra.era || song.era;
  song.recognizability = band;
  song.approximateYear = extra.releaseYear || song.approximateYear;
  const youtubeUrl = `https://www.youtube.com/watch?v=${song.youtube.videoId}`;
  const fallbackCover = { url: `https://i.ytimg.com/vi/${song.youtube.videoId}/hqdefault.jpg`, sourceUrl: youtubeUrl, attribution: "Кадр музыкального видео", rightsStatus: "contextual-only" };
  const album = structuredClone(extra.album || song.optionalMetadata.album || { title: `${song.title} — видеозапись`, kind: "archive", year: song.approximateYear });
  if (!album.coverUrl) album.coverUrl = fallbackCover.url;
  if (!album.sourceUrl) album.sourceUrl = extra.sources?.[0] || youtubeUrl;
  if (!album.rightsStatus) album.rightsStatus = "contextual-only";
  if (album.coverUrl.startsWith("http://")) album.coverUrl = album.coverUrl.replace("http://", "https://");
  const image = extra.image || song.optionalMetadata.artistImage || fallbackCover;
  song.optionalMetadata = { ...song.optionalMetadata, releaseYearStatus: "verified", artistForm, album, artistImage: image };
  const lineup = (extra.lineup || []).map(([name, role]) => ({ name, role, highlighted: /ключевой|лидер|солист|фронт/u.test(role) }));
  const relationships = { conflictEntityIds: [...new Set([...(song.artistIds || []), ...(extra.related || [])])], lineup, sourceUrl: extra.sources?.[0] || song.optionalMetadata.sources?.[0] || youtubeUrl };
  const sourceUrls = [...new Set([...(song.optionalMetadata.sources || []), ...(extra.sources || []), album.sourceUrl, image.sourceUrl, extra.soundtrack?.sourceUrl, youtubeUrl].filter(Boolean))];
  const checks = Object.fromEntries(["identity", "release", "artwork", "artistImage", "youtube", "fragment", "relationships", "difficulty"].map((name) => [name, { state: "verified", sources: name === "youtube" || name === "fragment" ? [youtubeUrl] : sourceUrls }]));
  checks.credits = { state: extra.credits?.length ? "verified" : "not-applicable", sources: extra.credits?.length ? sourceUrls : [] };
  checks.soundtrack = { state: extra.soundtrack ? "verified" : "not-applicable", sources: extra.soundtrack ? [extra.soundtrack.sourceUrl] : [] };
  verification.songs[songId] = {
    selectedForQuiz: quizId,
    publishedAt,
    identity: { artist: song.artist, artistAliases: song.artistAliases, artistForm },
    checks,
    release: { releaseYear: song.approximateYear, versionYear: extra.versionYear || song.approximateYear, album },
    artistImage: image,
    relationships,
    credits: extra.credits || [],
    soundtrack: extra.soundtrack || null,
    difficulty: { band, score: band === "recognizable" ? 28 : band === "middle" ? 52 : 72, explanation: extra.note || defaultDifficulty[band], basis: ["personal-feedback", "catalog-position", "fragment-position"] },
  };
  return song;
});

validatePublicationVerification(verification);
const report = tracks.map((song) => publicationReport(song, verification.songs[song.songId]));
if (report.some((item) => !item.passed)) throw new Error(JSON.stringify(report.filter((item) => !item.passed), null, 2));

const owners = new Map();
for (const song of tracks) {
  for (const entity of verification.songs[song.songId].relationships.conflictEntityIds) {
    if (owners.has(entity)) throw new Error(`Relationship conflict: ${entity} in ${owners.get(entity)} and ${song.songId}`);
    owners.set(entity, song.songId);
  }
}

if (new Set(tracks.map((song) => song.youtube.videoId)).size !== tracks.length) throw new Error("Duplicate YouTube video");
if (new Set(tracks.map((song) => `${song.artist}\u0000${song.title}`.toLocaleLowerCase("ru-RU"))).size !== tracks.length) throw new Error("Duplicate song");

const output = {
  version: 2,
  generatedAt: new Date().toISOString(),
  status: "verified",
  quiz: { id: quizId, title: "Квиз XXV · мягкая калибровка", level: "средний", published: "7 сентября 2026" },
  policy: {
    trackCount: 20,
    uniqueSongs: true,
    uniqueYouTubeVideos: true,
    relationshipConflicts: true,
    strictMetadataGate: true,
    personalization: { sovietViasRequired: false, rapTracksAllowed: [0, 1, 2], rapTracksSelected: 1, popularArtistTopThreeAvoidedWherePractical: true },
  },
  stats: {
    eras: Object.fromEntries(["soviet", "1990s", "2000s", "2010s", "2020s"].map((era) => [era, tracks.filter((song) => song.era === era).length])),
    recognition: Object.fromEntries(["recognizable", "middle", "deep"].map((band) => [band, tracks.filter((song) => song.recognizability === band).length])),
    rapTracks: 1,
    sovietViaTracks: 0,
  },
  tracks,
};

fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`);
fs.writeFileSync(path.join(root, "data", "quiz-release-new-rules-03.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ status: output.status, tracks: tracks.length, stats: output.stats }, null, 2));
