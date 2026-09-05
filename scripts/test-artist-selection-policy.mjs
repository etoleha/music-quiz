import assert from "node:assert/strict";
import path from "node:path";
import { artistSelectionFor, isArtistBlocked, isArtistPrioritized, loadArtistSelectionPolicy } from "./artist-selection-policy.mjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const policy = loadArtistSelectionPolicy(repoRoot);

assert.equal(isArtistBlocked({ artist: "SHAMAN", artistIds: ["shaman"] }, policy), true);
assert.equal(isArtistBlocked({ artist: "Любэ", artistIds: ["lyube"] }, policy), true);
assert.equal(isArtistBlocked({ artist: "Кто-то feat. Олег Газманов", artistIds: ["ktoto", "oleggazmanov"] }, policy), true);
assert.equal(artistSelectionFor({ artist: "Чичерина", artistIds: ["chicherina"] }, policy).blockedBy.canonical, "Юлия Чичерина");
assert.equal(isArtistPrioritized({ artist: "ДДТ", artistIds: ["ddt"] }, policy), true);
assert.equal(isArtistPrioritized({ artist: "Юрий Шевчук", artistIds: ["yuriishevchuk"] }, policy), true);
assert.equal(isArtistPrioritized({ artist: "Обычный исполнитель", artistIds: ["obychnyipolnitel"] }, policy), false);
assert.equal(isArtistBlocked({ artist: "Родион Газманов", artistIds: ["rodiongazmanov"] }, policy), false);

console.log("artist selection policy tests passed");
