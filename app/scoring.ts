const normalize = (value: string) =>
  (value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[^a-zа-я0-9]+/g, " ")
    .trim();

const translit = (value: string) => {
  const map: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z",
    и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p",
    р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch",
    ш: "sh", щ: "shch", ы: "y", э: "e", ю: "yu", я: "ya", ь: "", ъ: "",
  };
  return [...normalize(value)].map((char) => map[char] ?? char).join("").replace(/\s+/g, "");
};

const distance = (left: string, right: string) => {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[right.length];
};

export function isAccepted(value: string, aliases: string[]) {
  const candidate = translit(value);
  if (!candidate) return false;
  return aliases.some((alias) => {
    const expected = translit(alias);
    if (candidate === expected) return true;
    const longest = Math.max(candidate.length, expected.length);
    const shortest = Math.min(candidate.length, expected.length);
    if (shortest >= 7 && (candidate.includes(expected) || expected.includes(candidate))) return true;
    const allowance = longest >= 16 ? 2 : longest >= 7 ? 1 : 0;
    return distance(candidate, expected) <= allowance;
  });
}
