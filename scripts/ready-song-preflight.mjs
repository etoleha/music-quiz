const eraRanges = {
  soviet: [1900, 1991],
  "1990s": [1990, 1999],
  "2000s": [2000, 2009],
  "2010s": [2010, 2019],
  "2020s": [2020, 2029],
};

const allowedArtistForms = new Set(["исполнитель", "исполнительница", "группа", "проект", "дуэт"]);
const allowedDurations = {
  recognizable: [5, 9],
  middle: [9, 13],
  deep: [13, 20],
};

const issue = (code, message) => ({ code, message });

export function validateReadySong(song) {
  const blockers = [];
  const warnings = [];
  const year = Number(song.approximateYear);
  const eraRange = eraRanges[song.era];
  const artistForm = song.optionalMetadata?.artistForm?.trim();
  const artistFormParts = artistForm?.toLocaleLowerCase("ru-RU").split(/\s*\+\s*/).filter(Boolean) || [];
  const videoDuration = Number(song.youtube?.durationSeconds);
  const clipStart = Number(song.clip?.start);
  const clipDuration = Number(song.clip?.duration);
  const durationRange = allowedDurations[song.recognizability];
  const albumYear = Number(song.optionalMetadata?.album?.year);

  if (!song.readyForQuiz) blockers.push(issue("not-ready", "Карточка не помечена готовой к квизу."));
  if (!song.eligibility?.approved) blockers.push(issue("language-not-approved", "Нет подтверждения соответствия языковым правилам."));
  if (!Array.isArray(song.artistIds) || !song.artistIds.length) blockers.push(issue("artist-identity-missing", "Не определена исполнительская сущность."));
  if (!artistFormParts.length || artistFormParts.some((part) => !allowedArtistForms.has(part))) {
    blockers.push(issue("artist-form-missing", "Не заполнен тип исполнителя, исполнительницы, дуэта, группы или проекта."));
  }
  if (!Number.isInteger(year) || !eraRange || year < eraRange[0] || year > eraRange[1]) {
    blockers.push(issue("era-year-mismatch", `Год ${song.approximateYear ?? "не указан"} не соответствует эпохе ${song.era}.`));
  }
  if (Number.isInteger(albumYear) && Number.isInteger(year) && Math.abs(albumYear - year) > 2) {
    blockers.push(issue("album-year-mismatch", `Альбом датирован ${albumYear}, песня — ${year}; вероятно, найден сборник или переиздание.`));
  }
  if (!/^[A-Za-z0-9_-]{11}$/.test(song.youtube?.videoId || "")) blockers.push(issue("youtube-id-invalid", "Некорректный YouTube ID."));
  if (!Number.isFinite(videoDuration) || videoDuration < 90 || videoDuration > 480) blockers.push(issue("video-duration-invalid", "Длина ролика вне допустимого диапазона 1:30–8:00."));
  if (!Number.isFinite(clipStart) || !Number.isFinite(clipDuration) || clipStart < 0 || clipDuration < 5
    || clipStart + clipDuration > videoDuration) {
    blockers.push(issue("clip-out-of-bounds", "Фрагмент выходит за границы ролика."));
  }
  if (durationRange && (clipDuration < durationRange[0] || clipDuration > durationRange[1])) {
    blockers.push(issue("clip-difficulty-mismatch", `Длина ${clipDuration} сек. не соответствует узнаваемости ${song.recognizability}.`));
  }
  if (/\b(?:nightcore|sped\s*up|slowed|karaoke|караоке|male\s+version|female\s+version)\b/iu.test(song.youtube?.title || "")) {
    blockers.push(issue("suspicious-video-version", "Название ролика указывает на изменённую или караоке-версию."));
  }
  if (song.optionalMetadata?.releaseYearStatus !== "verified") warnings.push(issue("year-approximate", "Год пока приблизительный."));
  if (song.clip?.review !== "verified" && song.clip?.review !== "manual") warnings.push(issue("fragment-needs-listening", "Границы фрагмента выбраны автоматически."));
  return { blockers, warnings };
}

export const preflightPolicy = { eraRanges, allowedDurations, allowedArtistForms: [...allowedArtistForms] };
