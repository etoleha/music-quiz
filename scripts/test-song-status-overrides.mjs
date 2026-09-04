import assert from "node:assert/strict";
import {
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
