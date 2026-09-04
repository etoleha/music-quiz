import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";

const dataUrl = new URL("../data/", import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL("song-database.json", dataUrl), "utf8"));
const database = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(index.archive, dataUrl))).toString("utf8"));

assert.equal(database.songs.length, index.stats.songs);
assert.equal(index.stats.poolPositions, 3000);
assert.equal(index.stats.quizTrackPositions, 420);
assert.equal(index.stats.publishedQuizSongs, 420);
assert.ok(index.stats.chartSongs > 9000);
assert.ok(index.stats.quizCandidates > 1000);

const hiFi = database.songs.find(({ artistAliases, titleAliases }) =>
  artistAliases.includes("Hi-Fi") && titleAliases.includes("Беспризорник"));
assert.ok(hiFi, "corrected Hi-Fi track must exist");
assert.equal(database.songs.some(({ artist, title }) => artist === "Hi" && title.startsWith("Fi - ")), false);

for (const song of database.songs) {
  assert.ok(["waiting", "used", "rejected"].includes(song.status.workflow));
  assert.ok(["russian", "foreign", "mixed", "unknown"].includes(song.status.language));
  assert.ok(["verified", "needs-review"].includes(song.status.review));
  assert.ok(["good", "bad", "not-checked"].includes(song.status.fragment));
  for (const values of Object.values(song.externalIds)) assert.equal(values.length, new Set(values).size);
}

console.log("song database tests passed");
