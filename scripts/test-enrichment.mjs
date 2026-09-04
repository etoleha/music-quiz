import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { buildAliasIndex } from "./chart-normalization.mjs";
import {
  chooseRecording,
  extractVersionType,
  inferArtistForm,
  isAllowedCommonsLicense,
  recordingArtistCredits,
  selectReleaseInfo,
} from "./enrichment-core.mjs";

const aliases = JSON.parse(fs.readFileSync(new URL("../data/artist-aliases.json", import.meta.url), "utf8"));
const aliasIndex = buildAliasIndex(aliases);
const song = {
  artist: "Би-2 и Юлия Чичерина",
  title: "Мой рок-н-ролл",
  artistAliases: ["Би-2 feat. Юлия Чичерина"],
  titleAliases: ["Мой рок-н-ролл"],
  release: { candidateYears: [{ year: 2001 }] },
};
const recording = {
  id: "recording-1",
  score: 100,
  title: "Мой рок-н-ролл",
  "first-release-date": "2001-01-01",
  "artist-credit": [
    { artist: { id: "artist-1", name: "Би-2" }, joinphrase: " feat. " },
    { artist: { id: "artist-2", name: "Юлия Чичерина" } },
  ],
};

const exact = chooseRecording(song, [recording], aliasIndex, { exactIsrc: true });
assert.equal(exact.status, "matched");
assert.equal(recordingArtistCredits(recording).length, 2, "all featured performers must survive matching");

const wrongArtist = { ...recording, id: "wrong", "artist-credit": [{ artist: { id: "artist-x", name: "Другой артист" } }] };
assert.equal(chooseRecording(song, [wrongArtist], aliasIndex).status, "not-found", "same-title song by another artist must be rejected");

const duplicate = { ...recording, id: "recording-2" };
assert.equal(chooseRecording(song, [recording, duplicate], aliasIndex, { exactIsrc: true }).status, "ambiguous", "an ISRC collision needs review");

assert.equal(extractVersionType("Песня (Live)"), "live");
assert.equal(extractVersionType("Песня — acoustic version"), "acoustic");
assert.equal(extractVersionType("Песня"), "original");

const release = selectReleaseInfo({
  "first-release-date": "2001-02-03",
  releases: [
    { title: "Сингл", date: "2001-02-03", status: "Official", "release-group": { id: "single", title: "Сингл", "primary-type": "Single", "first-release-date": "2001-02-03" } },
    { title: "Альбом", date: "2003-04-05", status: "Official", "release-group": { id: "album", title: "Альбом", "primary-type": "Album", "first-release-date": "2003-04-05" } },
  ],
});
assert.equal(release.firstReleaseYear, 2001, "album year must not replace the song's first release year");
assert.equal(release.album.year, 2003);

assert.equal(isAllowedCommonsLicense("CC BY-SA 4.0"), true);
assert.equal(isAllowedCommonsLicense("CC BY-NC 4.0"), false);
assert.equal(isAllowedCommonsLicense("CC BY-ND 4.0"), false);
assert.equal(isAllowedCommonsLicense("unknown"), false);
assert.equal(inferArtistForm({ type: "Group" }), "Группа");
assert.equal(inferArtistForm({ type: "Person", gender: "Female" }), "Исполнительница");

const databaseIndex = JSON.parse(fs.readFileSync(new URL("../data/song-database.json", import.meta.url), "utf8"));
const full = fs.readFileSync(new URL(`../data/${databaseIndex.archive}`, import.meta.url));
const parts = Buffer.concat(databaseIndex.archiveParts.map((file) => fs.readFileSync(new URL(`../data/${file}`, import.meta.url))));
assert.deepEqual(parts, full, "the monolithic archive and split parts must be byte-for-byte identical");
assert.equal(crypto.createHash("sha256").update(full).digest("hex"), databaseIndex.archiveSha256);
const archive = JSON.parse(zlib.gunzipSync(full).toString("utf8"));
assert.equal(archive.generatedAt, databaseIndex.generatedAt);
assert.deepEqual(archive.stats, databaseIndex.stats);

console.log("enrichment and artifact tests passed");
