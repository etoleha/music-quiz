import assert from "node:assert/strict";
import {
  applyArtistCreditOverride,
  artistIdentityFromStatusOverride,
  externalIdsFromStatusOverride,
  publicationBlockersFor,
  validateSongStatusOverrides,
} from "./song-status-overrides.mjs";

const youtubeId = "AbCdEfGhI_1";
const document = {
  version: 1,
  songs: {
    "artist:title": {
      externalIds: { youtube: [youtubeId, youtubeId] },
    },
  },
};

assert.doesNotThrow(() => validateSongStatusOverrides(document));
assert.deepEqual(externalIdsFromStatusOverride(document.songs["artist:title"]), { youtube: [youtubeId] });

const identityOverride = {
  artistCredit: "  Miyagi & Эндшпиль feat. Рем Дигга  ",
  artistIds: ["miyagi", "endshpil", "remdigga"],
};
assert.deepEqual(artistIdentityFromStatusOverride(identityOverride), {
  artistCredit: "Miyagi & Эндшпиль feat. Рем Дигга",
  artistIds: ["miyagi", "endshpil", "remdigga"],
});
assert.equal(artistIdentityFromStatusOverride({}), null);

const entryWithIncompleteCredit = {
  artist: "Miyagi & Эндшпиль",
  artistAliases: ["Miyagi & Эндшпиль", "Мияги и Эндшпиль"],
  normalizedArtist: { primary: "miyagi", participants: ["miyagi", "endshpil"] },
};
applyArtistCreditOverride(entryWithIncompleteCredit, artistIdentityFromStatusOverride(identityOverride));
assert.equal(entryWithIncompleteCredit.artist, "Miyagi & Эндшпиль feat. Рем Дигга");
assert.equal(entryWithIncompleteCredit.sourceArtistCredit, "Miyagi & Эндшпиль");
assert.ok(entryWithIncompleteCredit.artistAliases.includes("Miyagi & Эндшпиль"));
assert.ok(entryWithIncompleteCredit.artistAliases.includes("Miyagi & Эндшпиль feat. Рем Дигга"));
assert.deepEqual(entryWithIncompleteCredit.normalizedArtist, {
  primary: "miyagi",
  participants: ["miyagi", "endshpil", "remdigga"],
});

for (const [override, expected] of [
  [{ artistCredit: "Artist feat. Guest" }, /must be specified together/],
  [{ artistIds: ["artist", "guest"] }, /must be specified together/],
  [{ artistCredit: "   ", artistIds: ["artist"] }, /non-empty string/],
  [{ artistCredit: "Artist", artistIds: [] }, /non-empty array/],
  [{ artistCredit: "Artist", artistIds: ["artist", ""] }, /non-empty strings/],
  [{ artistCredit: "Artist", artistIds: ["Artist"] }, /non-normalized artist ID/],
  [{ artistCredit: "Artist", artistIds: ["artist-id"] }, /non-normalized artist ID/],
  [{ artistCredit: "Artist", artistIds: ["artist", "artist"] }, /unique normalized artist IDs/],
]) {
  assert.throws(() => artistIdentityFromStatusOverride(override), expected);
}

assert.throws(
  () => validateSongStatusOverrides({ version: 1, songs: { bad: { externalIds: { youtube: youtubeId } } } }),
  /must be an array/,
);
assert.throws(
  () => validateSongStatusOverrides({ version: 1, songs: { bad: { externalIds: { youtube: ["https:\/\/youtu.be\/AbCdEfGhI_1"] } } } }),
  /invalid video ID/,
);
assert.throws(
  () => validateSongStatusOverrides({ version: 1, songs: { bad: { externalIds: { spotify: ["track-id"] } } } }),
  /supports only youtube/,
);

const entry = {
  artistIdentityResolved: true,
  allArtistsUnused: true,
  release: { releaseYearStatus: "verified" },
  externalIds: externalIdsFromStatusOverride(document.songs["artist:title"]),
  enrichment: { review: "verified" },
};
const blockers = publicationBlockersFor(entry, {
  language: "russian",
  reviewStatus: "verified",
  fragmentStatus: "not-checked",
});

assert.equal(blockers.includes("youtube-video"), false, "a valid manual YouTube ID removes the video blocker");
assert.equal(blockers.includes("fragment-review"), true, "a YouTube ID does not claim that the fragment was listened to");

console.log("song status override tests passed");
