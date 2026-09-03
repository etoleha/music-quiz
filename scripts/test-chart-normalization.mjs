import assert from "node:assert/strict";
import fs from "node:fs";
import {
  artistsOverlap,
  buildAliasIndex,
  normalizeArtist,
  normalizeObservation,
  textSimilarity,
} from "./chart-normalization.mjs";

const aliases = JSON.parse(fs.readFileSync(new URL("../data/artist-aliases.json", import.meta.url), "utf8"));
const aliasIndex = buildAliasIndex(aliases);

const sameArtist = (left, right) => assert.deepEqual(
  normalizeArtist(left, aliasIndex),
  normalizeArtist(right, aliasIndex),
);

sameArtist("Баста", "Basta");
sameArtist("Моя Мишель", "Moya Mishel");
sameArtist("Михаил Шуфутинский", "Mikhail Shufutinskiy");
sameArtist("Артик и Асти", "Artik & Asti");

const collaborationA = normalizeArtist("Artist A & Artist B", aliasIndex);
const collaborationB = normalizeArtist("Artist B и Artist A", aliasIndex);
assert.deepEqual(collaborationA.participants, collaborationB.participants);
assert.ok(artistsOverlap(collaborationA, collaborationB));

const featured = normalizeObservation({ artist: "Artist A", title: "Song (feat. Artist B)" }, aliasIndex);
assert.equal(featured.titleKey, "song");
assert.deepEqual(featured.artist.participants, collaborationA.participants);

assert.equal(textSimilarity("song", "song"), 1);
assert.ok(textSimilarity("averylongsongtitle", "averylongsongtitl") > 0.94);
assert.equal(artistsOverlap(
  normalizeArtist("Artist A", aliasIndex),
  normalizeArtist("Artist C", aliasIndex),
), false);

console.log("chart normalization tests passed");
