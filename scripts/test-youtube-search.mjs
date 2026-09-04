import assert from "node:assert/strict";
import { parseViewCount, rankYouTubeResults } from "./youtube-search.mjs";

assert.equal(parseViewCount("1,2 млн просмотров"), 1_200_000);
assert.equal(parseViewCount("845 тыс. просмотров"), 845_000);
assert.equal(parseViewCount("470 592 просмотра"), 470_592);
assert.equal(parseViewCount("2.3M views"), 2_300_000);

const song = { artist: "Евгения Отрадная", title: "Уходи и дверь закрой" };
const ranked = rankYouTubeResults(song, [
  { videoId: "abcdefghijk", title: "Евгения Отрадная — Уходи и дверь закрой", channel: "Музыка", durationSeconds: 220, viewCount: 5_000_000, badges: [], live: false },
  { videoId: "lmnopqrstuv", title: "Уходи и дверь закрой (караоке cover)", channel: "Евгения Отрадная", durationSeconds: 220, viewCount: 50_000_000, badges: [], live: false },
  { videoId: "01234567890", title: "Совсем другая песня", channel: "Другой артист", durationSeconds: 220, viewCount: 500_000_000, badges: [], live: false },
]);
assert.equal(ranked.length, 1);
assert.equal(ranked[0].videoId, "abcdefghijk");

const rareSovietRecording = rankYouTubeResults(
  { artist: "Майя Кристалинская", title: "Нежность" },
  [{
    videoId: "sovietrare1",
    title: "Майя Кристалинская — Нежность",
    channel: "Советские песни",
    durationSeconds: 185,
    viewCount: 842,
    badges: [],
    live: false,
  }],
);
assert.equal(rareSovietRecording.length, 1, "a matching Soviet archive recording must not require 100k views");

console.log("youtube search tests passed");
