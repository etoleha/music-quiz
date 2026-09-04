import assert from "node:assert/strict";
import fs from "node:fs";

const checks = [
  ["app/quiz-data.ts", "track", "const artistForms", "export type Quiz"],
  ["app/quiz-data-extra.ts", "extraTrack", "const performerForms", "const manualArtistAliases"],
];

for (const [file, helper, startMarker, endMarker] of checks) {
  const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
  const map = source.slice(source.indexOf(startMarker), source.indexOf(endMarker));
  const forms = new Map([...map.matchAll(/^\s{2}"([^"]+)":\s*"([^"]+)",$/gm)].map((match) => [match[1], match[2]]));
  const artists = [...source.matchAll(new RegExp(`\\b${helper}\\(\\"[^\\"]+\\",\\s*\\"([^\\"]+)\\"`, "g"))].map((match) => match[1]);
  for (const artist of artists) assert.ok(forms.has(artist), `${file}: нет явной формы для ${artist}`);
  assert.doesNotMatch(source, /artistForm:\s*[^\n]+\?\?\s*"Группа"/, `${file}: запрещён молчаливый fallback «Группа»`);
}

const base = fs.readFileSync(new URL("../app/quiz-data.ts", import.meta.url), "utf8");
const extra = fs.readFileSync(new URL("../app/quiz-data-extra.ts", import.meta.url), "utf8");
for (const [artist, form] of [
  ["Иван Дорн", "Исполнитель"],
  ["Мурат Тхагалегов", "Исполнитель"],
  ["Ёлка", "Исполнительница"],
  ["Глюк’oZa", "Исполнительница"],
  ["Фактор-2", "Исполнитель + исполнитель"],
  ["Непара", "Исполнитель + исполнительница"],
]) {
  const expression = new RegExp(`"${artist.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}":\\s*"${form.replaceAll("+", "\\+")}"`);
  assert.ok(expression.test(`${base}\n${extra}`), `неверная форма: ${artist}`);
}

assert.match(extra, /extraTrack\("Q6a_mLhifqc", "Quest Pistols Show", "Санта Лючия"/, "нужен основной клип, а не dance remix");
console.log("quiz semantic tests passed");
