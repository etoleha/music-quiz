import assert from "node:assert/strict";
import { inspectYouTubeWatchHtml } from "./youtube-playability.mjs";

const response = (playabilityStatus, videoDetails = { videoId: "abcdefghijk" }) =>
  `<script>var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus, videoDetails })};</script>`;

assert.deepEqual(inspectYouTubeWatchHtml(response({ status: "OK", playableInEmbed: true })), {
  status: "passed",
  reason: "watch-page-playable",
});
assert.deepEqual(inspectYouTubeWatchHtml(response({ status: "LOGIN_REQUIRED", reason: "Sign in to confirm your age" }, null)), {
  status: "failed",
  reason: "age-restricted",
});
assert.deepEqual(inspectYouTubeWatchHtml(response({ status: "OK", playableInEmbed: false })), {
  status: "failed",
  reason: "embedding-disabled",
});
assert.deepEqual(inspectYouTubeWatchHtml("<html></html>"), {
  status: "failed",
  reason: "playability-undetermined",
});

console.log("youtube playability tests passed");
