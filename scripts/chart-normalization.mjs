const transliteration = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
};

export const decodeHtml = (value = "") =>
  String(value ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&#039;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");

export const fingerprint = (value = "") =>
  decodeHtml(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[а-яё]/g, (letter) => transliteration[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, "");

export const buildAliasIndex = (aliasFile) => {
  const index = new Map();
  for (const group of aliasFile.artists) {
    const canonical = fingerprint(group.canonical);
    index.set(canonical, canonical);
    for (const alias of group.aliases) index.set(fingerprint(alias), canonical);
  }
  return index;
};

const participantSeparators = /\s*(?:&|,|\+|\/|\bfeat\.?\b|\bft\.?\b|\bwith\b|\bx\b)\s*|\s+и\s+/iu;

export const normalizeArtist = (artist, aliasIndex) => {
  const decodedArtist = decodeHtml(artist).trim();
  const wholeArtistKey = fingerprint(decodedArtist);
  const wholeArtistAlias = aliasIndex.get(wholeArtistKey);
  if (wholeArtistAlias) {
    return { primary: wholeArtistAlias, participants: [wholeArtistAlias] };
  }

  const rawParticipants = decodedArtist
    .replace(/[()[\]]/g, " ")
    .split(participantSeparators)
    .map((value) => value.trim())
    .filter(Boolean);
  const participants = rawParticipants.map((value) => {
    const rawKey = fingerprint(value);
    return aliasIndex.get(rawKey) ?? rawKey;
  });
  return {
    primary: participants[0] ?? "unknown",
    participants: [...new Set(participants)].sort(),
  };
};

export const splitFeaturedArtistsFromTitle = (title) => {
  const featured = [];
  const cleanTitle = decodeHtml(title).replace(
    /\s*[([]\s*(?:feat\.?|ft\.?)\s+([^\])]+)[\])]/giu,
    (_, names) => {
      featured.push(names.trim());
      return "";
    },
  );
  return { title: cleanTitle.trim(), featured };
};

export const normalizeObservation = ({ artist, title }, aliasIndex) => {
  const separated = splitFeaturedArtistsFromTitle(title);
  const artistWithFeatures = [artist, ...separated.featured].filter(Boolean).join(" & ");
  return {
    titleKey: fingerprint(separated.title),
    cleanTitle: separated.title,
    artist: normalizeArtist(artistWithFeatures, aliasIndex),
  };
};

export const editDistance = (left, right) => {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
};

export const textSimilarity = (left, right) => {
  const length = Math.max(left.length, right.length);
  return length === 0 ? 1 : 1 - editDistance(left, right) / length;
};

export const artistsOverlap = (left, right) => {
  const leftSet = new Set(left.participants);
  const shared = right.participants.filter((participant) => leftSet.has(participant));
  return left.primary === right.primary || shared.length > 0;
};
