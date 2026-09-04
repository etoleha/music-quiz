import assert from "node:assert/strict";
import { aggregateRows, canonicalIsrc, extractIsrc, parseCsv } from "./import-tophit-monthly.mjs";

assert.equal(canonicalIsrc("RU-A3K-16-00065"), "RUA3K1600065");
assert.equal(canonicalIsrc("Sony MusicFR-59R-19-88026"), "FR59R1988026");
assert.equal(canonicalIsrc("not-an-isrc"), null);
assert.deepEqual(extractIsrc({ isrc: "", rights_holder: "LabelRUA011600010" }), {
  value: "RUA011600010",
  source: "rights_holder_suffix",
});

const csv = '\uFEFF"artist","title","chart_month","position"\r\n"Artist, A","Song ""One""","2003-11","1"\r\n';
assert.deepEqual(parseCsv(csv), [{
  artist: "Artist, A",
  title: 'Song "One"',
  chart_month: "2003-11",
  position: "1",
}]);

const base = {
  artist: "Artist A",
  title: "Song A",
  genres: "Pop | Dance",
  rights_holder: "Label",
  track_url: "https://tophit.com/tracks/1",
  release_date: "1 Jan, 2003",
};
const { tracks, stats } = aggregateRows([
  { ...base, track_id: "1", chart_month: "2003-11", position: "5", isrc: "RU-A3K-16-00065", tophit_language: "Russian", tophit_language_flag: "ru" },
  { ...base, track_id: "1", chart_month: "2003-12", position: "2", isrc: "RU-A3K-16-00065", tophit_language: "Russian", tophit_language_flag: "ru" },
  { ...base, artist: "Artist B", title: "Song B", track_id: "2", chart_month: "2003-11", position: "8", isrc: "RU-A3K-16-00065" },
  { ...base, artist: "Artist C", title: "Song C", track_id: "3", chart_month: "2003-11", position: "1", isrc: "", tophit_language: "English", tophit_language_flag: "gb" },
  { ...base, artist: "", title: "Unknown artist song", track_id: "4", chart_month: "2003-11", position: "10", isrc: "" },
]);

assert.equal(stats.trackCount, 4);
assert.equal(stats.storedChartRows, 5);
assert.equal(stats.collisionIsrcCount, 1);
assert.equal(tracks[0].appearancesMonths, 2);
assert.equal(tracks[0].bestPosition, 2);
assert.equal(tracks[0].chartPoints, 195);
assert.equal(tracks[0].matchableIsrc, null);
assert.equal(tracks[1].isrcStatus, "collision");
assert.equal(tracks[2].isrcStatus, "missing");
assert.equal(tracks[3].artist, null);
assert.deepEqual(tracks[0].languageCodes, ["russian"]);
assert.equal(tracks[0].languageStatus, "unique");
assert.deepEqual(tracks[2].languageCodes, ["english"]);
assert.equal(tracks[3].languageStatus, "missing", "старый CSV без флага остаётся импортируемым");

console.log("TopHit import tests passed");
