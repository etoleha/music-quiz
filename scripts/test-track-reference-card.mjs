import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Load the actual TS component/server reader in memory. Only curated JSON/archive
// metadata is read: this test never imports a database, API or game persistence.
const root = path.resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
function load(file) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    name => name === "server-only" || name.endsWith(".css") ? {} : require(name),
    module, module.exports,
  );
  return module.exports;
}
const Card = load("app/track-reference-card.tsx").default;
const { getPersistedTrackInfo } = load("server/song-enrichment.ts");
const track = { key: "synthetic", artist: "Тестовая группа", title: "Тестовая песня", artistForm: "Группа" };
const render = (info, song = track) => renderToStaticMarkup(React.createElement(Card, { info, track: song }));

const credits = render({ status: "ready", credits: [
  { role: "музыка", names: ["Первый автор", "Второй автор"] },
  { role: "слова", name: "Третий автор" },
  { role: "неполная запись" }, null,
] });
for (const name of ["Первый автор", "Второй автор", "Третий автор"]) assert(credits.includes(name));
assert(!credits.includes("неполная запись"));
for (const band of ["unknown", "toString", undefined, null]) {
  const html = render({ status: "ready", difficulty: { band, explanation: "Описание из источника" } });
  assert(html.includes("Описание из источника"));
  assert(!html.includes("undefined"));
}
const albumOnly = render({ status: "ready", album: { title: "Переиздание", year: 2024 } });
assert(albumOnly.includes("<dt>Год песни</dt><dd>Уточняется</dd>"));
assert(!albumOnly.includes("<img"));
const release = JSON.parse(fs.readFileSync(path.join(root, "data/quiz-release-new-rules-10.json"), "utf8"));
assert.equal(release.quiz.id, "hard-31");
assert.equal(release.tracks.length, 20);
let withCredits = 0;
for (const song of release.tracks) {
  const info = getPersistedTrackInfo(song.artist, song.title, song.youtube?.videoId);
  assert(info, `Persisted metadata missing for ${song.songId}`);
  const html = render({ ...info, status: "ready" }, { ...song, key: song.songId });
  assert(html.includes("Год песни"));
  if (info.credits?.length) {
    withCredits++;
    assert(html.includes("Авторы"));
    for (const credit of info.credits) for (const name of credit.names || [credit.name]) {
      if (name) assert(html.includes(name.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")));
    }
  }
}
console.log(JSON.stringify({ status: "PASS", realCards: release.tracks.length, cardsWithCredits: withCredits,
  syntheticChecks: ["grouped/individual/missing credits", "unknown difficulty", "song year distinct from album", "no fake images"],
  databaseTouched: false, boundary: "Client render error boundary added; SSR cannot exercise React client error recovery." }));
