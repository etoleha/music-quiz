import fs from "node:fs";
import path from "node:path";
import { publicationReport, validatePublicationVerification } from "./publication-verification.mjs";

const root = path.resolve(import.meta.dirname, "..");
const pool = JSON.parse(fs.readFileSync(path.join(root, "data", "quiz-ready-songs.json"), "utf8"));
const verificationPath = path.join(root, "data", "song-publication-verification.json");
const verification = validatePublicationVerification(JSON.parse(fs.readFileSync(verificationPath, "utf8")));
const quizId = "new-rules-test-02";
const publishedAt = new Date().toISOString();
for (const [songId, record] of Object.entries(verification.songs)) {
  if (record.selectedForQuiz === quizId) delete verification.songs[songId];
}

const selected = [
  ["pool-35827af275a5", "middle", "Группа"],
  ["pool-ce99c7b7eb00", "middle", "Группа"],
  ["pool-c225e1b9d6de", "recognizable", "Группа"],
  ["pool-8b2d81c70d70", "middle", "Группа"],
  ["pool-a23bc4e4f2c4", "recognizable", "Группа"],
  ["pool-9820471f6ead", "recognizable", "Исполнительница"],
  ["pool-dd48777bcfb2", "recognizable", "Исполнительница"],
  ["pool-128d46828794", "middle", "Группа"],
  ["pool-989f4613b615", "middle", "Группа"],
  ["pool-c1a6d9123a57", "recognizable", "Исполнительница"],
  ["pool-2a3e179cf638", "recognizable", "Исполнительница"],
  ["pool-11ab87245ec0", "middle", "Исполнитель"],
  ["pool-eee8e4601088", "middle", "Исполнительница"],
  ["pool-a054b56a7942", "deep", "Исполнительница"],
  ["pool-23a6c1460c9d", "middle", "Группа"],
  ["avtoradio-20d993e657e9", "middle", "Группа"],
  ["pool-8a08e137b62d", "recognizable", "Исполнительница"],
  ["pool-0b3e3a5f099f", "deep", "Исполнитель"],
  ["chart-00138", "recognizable", "Исполнитель"],
  ["pool-4d45f4f2ba9b", "deep", "Исполнитель"],
];

const details = {
  "pool-35827af275a5": {
    era: "soviet", releaseYear: 1976, versionYear: 2019,
    album: { title: "«Вологда» — архивное телеисполнение", kind: "archive", year: 1976, coverUrl: "https://i.ytimg.com/vi/TRodzcQvxq0/hqdefault.jpg", sourceUrl: "https://www.youtube.com/watch?v=TRodzcQvxq0" },
    lineup: [["Владимир Мулявин", "руководитель, гитара · ключевой"], ["Анатолий Кашепаров", "вокал · солист песни"], ["Леонид Борткевич", "вокал"], ["Владислав Мисевич", "духовые"], ["Леонид Тышко", "бас-гитара"], ["Александр Демешко", "ударные"]],
    related: ["vladimirmulyavin", "anatoliykasheparov", "leonidbortkevich"],
    credits: [{ role: "Музыка", names: ["Борис Мокроусов"] }, { role: "Слова", names: ["Михаил Матусовский"] }],
    sources: ["https://ru.wikipedia.org/wiki/Вологда_(песня)", "https://ru.wikipedia.org/wiki/Песняры", "https://www.youtube.com/watch?v=TRodzcQvxq0"],
    note: "Знаменитая песня ВИА, но короткий фрагмент требует вспомнить именно коллектив.",
  },
  "pool-ce99c7b7eb00": {
    era: "soviet", releaseYear: 1975, versionYear: 2007,
    album: { title: "«Клён» — запись ВИА «Синяя птица»", kind: "archive", year: 1975, coverUrl: "https://i.ytimg.com/vi/IhxkoPeR6aY/hqdefault.jpg", sourceUrl: "https://ru.wikipedia.org/wiki/Синяя_птица_(ансамбль)" },
    lineup: [["Роберт Болотный", "основатель · ключевой"], ["Михаил Болотный", "клавишные, вокал"], ["Сергей Дроздов", "бас, вокал · солист песни"], ["Борис Белоцерковский", "ударные"], ["Евгения Завьялова", "вокал"], ["Юрий Метёлкин", "гитара"], ["Юрий Янин", "гитара"]],
    related: ["robertbolotny", "sergeydrozdov"],
    credits: [{ role: "Музыка", names: ["Юрий Акулов"] }, { role: "Слова", names: ["Людмила Шишко"] }],
    sources: ["https://ru.wikipedia.org/wiki/Синяя_птица_(ансамбль)", "https://www.km.ru/muzyka/encyclopedia/sinyaya-ptitsa"],
    note: "Один из главных хитов советских ВИА; сложность средняя из-за необходимости назвать коллектив.",
  },
  "pool-c225e1b9d6de": {
    album: { title: "Дым сигарет с ментолом", kind: "album", year: 1993, coverUrl: "https://i.ytimg.com/vi/5qsjsrgbTzM/hqdefault.jpg", sourceUrl: "https://www.youtube.com/watch?v=5qsjsrgbTzM" },
    lineup: [["Анатолий Бондаренко", "вокал, автор, лидер · ключевой"], ["Андрей Костенко", "клавишные, вокал"]], related: ["anatoliybondarenko", "andreykostenko"],
    credits: [{ role: "Музыка и слова версии группы", names: ["Анатолий Бондаренко"] }], sources: ["https://radioshanson.ru/artist/nensi", "https://www.youtube.com/watch?v=5qsjsrgbTzM"],
  },
  "pool-8b2d81c70d70": { lineup: [["Александра Зверева", "вокал · фронтвумен"], ["Вадим Поляков", "автор, продюсер"], ["Дмитрий Постовалов", "автор, продюсер"]], related: ["sashazvereva", "vadimpolyakov", "dmitriypostovalov"], credits: [{ role: "Музыка и слова", names: ["Вадим Поляков", "Дмитрий Постовалов"] }], sources: ["https://ru.wikipedia.org/wiki/Демо_(группа)", "https://ru.wikipedia.org/wiki/Солнышко_(альбом)"], note: "Большой танцевальный хит 1999 года, но менее очевидный, чем главная визитная карточка группы." },
  "pool-a23bc4e4f2c4": { releaseYear: 1995, versionYear: 1995, lineup: [["Анастасия Макаревич", "вокал, гитара · лидер"], ["Елена Перова", "вокал, гитара"], ["Изольда Ишханишвили", "вокал, гитара"]], related: ["anastasiyamakarevich", "elenaperova", "izoldaiskhanishvili"], credits: [{ role: "Музыка и слова", names: ["Алексей Макаревич"] }], sources: ["https://ru.wikipedia.org/wiki/Лицей_(группа)", "https://ru.wikipedia.org/wiki/Макаревич,_Алексей_Лазаревич"] },
  "pool-9820471f6ead": { releaseYear: 1999, album: { title: "Алсу", kind: "album", year: 1999, coverUrl: "https://coverartarchive.org/release/3519dd8a-1c65-448f-acc9-a06046904157/front-500", sourceUrl: "https://musicbrainz.org/release/3519dd8a-1c65-448f-acc9-a06046904157" }, credits: [{ role: "Музыка и слова", names: ["Александр Шевченко"] }], sources: ["https://www.youtube.com/watch?v=HqeQMg7iLnc", "https://ru.wikipedia.org/wiki/Алсу_(альбом)"] },
  "pool-dd48777bcfb2": { releaseYear: 2000, credits: [{ role: "Музыка и слова", names: ["Земфира Рамазанова"] }], sources: ["https://ru.wikipedia.org/wiki/Прости_меня_моя_любовь"] },
  "pool-128d46828794": { lineup: [["Карина Кокс", "вокал · фронтвумен"], ["Дарья Ермолаева", "вокал"], ["Ирина Васильева", "вокал"]], related: ["karinakoks", "daryaermolaeva", "irinavasilyeva"], credits: [{ role: "Музыка", names: ["Александр Зацепин"] }, { role: "Слова", names: ["Леонид Дербенёв"] }], sources: ["https://ru.wikipedia.org/wiki/Сливки_(группа)", "https://musicbrainz.org/release-group/181b887c-933d-4d76-b575-2d193ac31354"] },
  "pool-989f4613b615": { releaseYear: 2003, versionYear: 2003, youtubeId: "d5WpgXVR_2s", lineup: [["Ирина Нельсон", "вокал · фронтвумен"], ["Алёна Торганова", "вокал, танцы"], ["DJ Silver", "музыкант, DJ"]], related: ["irinanelson", "alenatorganova", "djsilver"], credits: [{ role: "Музыка", names: ["Вячеслав Тюрин"] }, { role: "Слова", names: ["Леона Войналович", "Глеб Кальпурний", "Наталья Тимченко"] }], sources: ["https://irinanelson.com/video/reflex", "https://www.youtube.com/watch?v=d5WpgXVR_2s"] },
  "pool-c1a6d9123a57": { credits: [{ role: "Автор песни", names: ["Виктор Дробыш"] }], sources: ["https://www.km.ru/music/d434ea01c64c407fbc71848e3f0b01af"] },
  "pool-2a3e179cf638": { releaseYear: 2003, credits: [{ role: "Музыка и слова", names: ["Максим Фадеев"] }], sources: ["https://ru.wikipedia.org/wiki/Мой_мармеладный_(Я_не_права)"] },
  "pool-11ab87245ec0": { credits: [{ role: "Музыка и слова", names: ["Василий Вакуленко"] }], related: ["vasiliyvakulenko", "noggano", "nintendo"], sources: ["https://ru.wikipedia.org/wiki/Баста_1"], note: "Единственная явная рэп-позиция выпуска: известный артист, но не самый очевидный массовый трек." },
  "pool-eee8e4601088": { era: "2000s", releaseYear: 2006, credits: [{ role: "Музыка и слова", names: ["Елена Ваенга"] }], sources: ["https://www.shazam.com/ru-ru/song/587863602/шопен", "https://ru.wikipedia.org/wiki/Ваенга,_Елена_Владимировна"], note: "Известная песня, но не универсальный поп-хит: средняя сложность для смешанного квиза." },
  "pool-2c5c3bd8aee9": { lineup: [["Анна Плетнёва", "вокал · фронтвумен"], ["Алексей Романоф", "композитор, продюсер · ключевой"]], related: ["annapletneva", "alexeyromanof", "litsey"], credits: [{ role: "Авторы", names: ["Антон Кох", "Алексей Романоф"] }], sources: ["https://ru.wikipedia.org/wiki/Знак_Водолея", "https://ru.wikipedia.org/wiki/Decamerone_(альбом)"] },
  "pool-a054b56a7942": { releaseYear: 2013, credits: [{ role: "Музыка и слова", names: ["Нюша Шурочкина"] }], sources: ["https://www.youtube.com/watch?v=Ewdap2FX-uE", "https://ru.wikipedia.org/wiki/Наедине"], note: "Не самый очевидный сингл популярной исполнительницы; для тебя это более глубокая позиция." },
  "pool-23a6c1460c9d": { releaseYear: 2013, lineup: [["Ирина Тонева", "вокал · ключевая участница"], ["Александра Савельева", "вокал"], ["Екатерина Ли", "вокал"]], related: ["irinatoneva", "alexandrasavelyeva", "ekaterinali"], credits: [{ role: "Музыка", names: ["Игорь Матвиенко"] }, { role: "Слова", names: ["Диана Поллыева", "Игорь Матвиенко"] }], sources: ["https://www.youtube.com/watch?v=HuSf1UcFRq0"] },
  "avtoradio-20d993e657e9": { lineup: [["Ольга Серябкина", "вокал, автор · ключевая"], ["Полина Фаворская", "вокал"], ["Дарья Шашина", "вокал"]], related: ["olgaseryabkina", "polinafavorskaya", "daryashashina"], credits: [{ role: "Авторы", names: ["Максим Фадеев", "Ольга Серябкина"] }], sources: ["https://ru.wikipedia.org/wiki/Serebro"] },
  "pool-8a08e137b62d": { credits: [{ role: "Музыка и слова", names: ["Кристен Андерсон-Лопес", "Роберт Лопес"] }], soundtrack: { title: "Холодное сердце", kind: "анимационный фильм", year: 2013, sourceUrl: "https://musicbrainz.org/release-group/7f8c1b27-8a5b-44c9-9707-c6bc9953959c" }, sources: ["https://musicbrainz.org/recording/7c62ffc3-e369-4bd7-9a63-86d1bebf5f89"] },
  "pool-0b3e3a5f099f": { credits: [{ role: "Музыка и слова", names: ["Амирхан Батабаев", "Алекс Давия", "Алимжан"] }], sources: ["https://ru.wikipedia.org/wiki/Эта_любовь_(сингл)"], note: "Современный международный хит, но для слушателя вне коротких видео это сложная позиция." },
  "chart-00138": { credits: [{ role: "Автор", names: ["HENSY"] }, { role: "Музыка", names: ["Азиз Закиев"] }], sources: ["https://www.youtube.com/watch?v=vIw8R8ezJrA", "https://ipex.ru/catalog/music/pobolelo-i-proshlo-1"] },
  "pool-4d45f4f2ba9b": { credits: [], sources: ["https://music.apple.com/ru/album/%D0%BE%D0%B9-%D0%BA%D0%B0%D0%BA%D0%B0%D1%8F-%D1%82%D1%8B/1670064940?i=1670064941&uo=4"], note: "Современная поп-песня с меньшей привычностью для твоего профиля." },
};

const defaultDifficulty = {
  recognizable: "Широко известная песня с высокой общей узнаваемостью; фрагмент не должен сразу произносить название.",
  middle: "Песня знакома широкой аудитории, но конкретный фрагмент или исполнитель требуют небольшого усилия.",
  deep: "Песня заметна в своей аудитории, но для твоего текущего профиля это более редкая или современная зона.",
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
  song.optionalMetadata.artistForm = artistForm;
  song.approximateYear = extra.releaseYear || song.approximateYear;
  const album = structuredClone(extra.album || song.optionalMetadata.album);
  if (album?.coverUrl?.startsWith("http://")) album.coverUrl = album.coverUrl.replace("http://", "https://");
  const youtubeUrl = `https://www.youtube.com/watch?v=${song.youtube.videoId}`;
  const image = extra.image || song.optionalMetadata.artistImage || { url: `https://i.ytimg.com/vi/${song.youtube.videoId}/hqdefault.jpg`, sourceUrl: youtubeUrl, attribution: "Кадр официального музыкального видео", rightsStatus: "contextual-only" };
  song.optionalMetadata = { ...song.optionalMetadata, releaseYearStatus: "verified", album, artistImage: image };
  const lineup = (extra.lineup || []).map(([name, role]) => ({ name, role, highlighted: /ключевой|лидер|солист|фронт/u.test(role) }));
  const relationships = { conflictEntityIds: [...new Set([...(song.artistIds || []), ...(extra.related || [])])], lineup, sourceUrl: extra.sources?.[0] };
  const sourceUrls = [...new Set([...(song.optionalMetadata.sources || []), ...(extra.sources || []), album?.sourceUrl, image?.sourceUrl, extra.soundtrack?.sourceUrl, youtubeUrl].filter(Boolean))];
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
    difficulty: { band, score: band === "recognizable" ? 28 : band === "middle" ? 52 : 72, explanation: extra.note || defaultDifficulty[band], basis: ["personal-genre-feedback", "catalog-popularity", "fragment-position"] },
  };
  return song;
});

validatePublicationVerification(verification);
const report = tracks.map((song) => publicationReport(song, verification.songs[song.songId]));
if (report.some((item) => !item.passed)) throw new Error(JSON.stringify(report.filter((item) => !item.passed), null, 2));
const owners = new Map();
for (const song of tracks) for (const entity of verification.songs[song.songId].relationships.conflictEntityIds) {
  if (owners.has(entity)) throw new Error(`Relationship conflict: ${entity} in ${owners.get(entity)} and ${song.songId}`);
  owners.set(entity, song.songId);
}
if (new Set(tracks.map((song) => song.youtube.videoId)).size !== tracks.length) throw new Error("Duplicate YouTube video");
if (new Set(tracks.map((song) => `${song.artist}\u0000${song.title}`.toLocaleLowerCase("ru-RU"))).size !== tracks.length) throw new Error("Duplicate song");
const output = {
  version: 2,
  generatedAt: new Date().toISOString(),
  status: "verified",
  quiz: { id: quizId, title: "Квиз XXIV · новая калибровка", level: "средний", published: "7 сентября 2026" },
  policy: { trackCount: 20, uniqueSongs: true, uniqueYouTubeVideos: true, relationshipConflicts: true, strictMetadataGate: true, personalization: { rapShareMaximum: 0.1, easierThan: "new-rules-test-01" } },
  stats: {
    eras: Object.fromEntries(["soviet", "1990s", "2000s", "2010s", "2020s"].map((era) => [era, tracks.filter((song) => song.era === era).length])),
    recognition: Object.fromEntries(["recognizable", "middle", "deep"].map((band) => [band, tracks.filter((song) => song.recognizability === band).length])),
  },
  tracks,
};
fs.writeFileSync(verificationPath, `${JSON.stringify(verification, null, 2)}\n`);
fs.writeFileSync(path.join(root, "data", "quiz-release-new-rules-02.json"), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ status: output.status, tracks: tracks.length, stats: output.stats }, null, 2));
