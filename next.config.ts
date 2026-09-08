import type { NextConfig } from "next";

const songRuntimeFiles = [
  "./data/song-database.json",
  "./data/song-database.json.gz",
  "./data/song-database.json.gz.part-*",
  "./data/song-enrichment-auto.json",
  "./data/song-publication-verification.json",
  "./data/quiz-release-new-rules-*-metadata.json",
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": ["./data/*.sqlite*", "./data/*.db*"],
  },
  outputFileTracingIncludes: {
    "/api/video-*": ["./server/video-data/*.json"],
    "/g/video-*": ["./server/video-data/*.json"],
    "/catalog": [
      ...songRuntimeFiles,
      "./data/quiz-ready-songs.json",
      "./data/song-golden-reserve.json",
      "./data/quiz-candidates.json",
      "./data/*-policy.json",
      "./data/*-overrides.json",
      "./data/artist-aliases.json",
      "./data/song-pool*.json",
      "./data/chart*.json",
      "./data/chart*.json.gz",
    ],
    "/api/track-info": songRuntimeFiles,
    "/g/track-info": songRuntimeFiles,
  },
};

export default nextConfig;
