import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/api/video-*": ["./server/video-data/*.json"],
    "/g/video-*": ["./server/video-data/*.json"],
    "/catalog": [
      "./data/song-database.json",
      "./data/song-database.json.gz",
      "./data/song-database.json.gz.part-01",
      "./data/song-database.json.gz.part-02",
      "./data/song-enrichment-auto.json",
    ],
  },
};

export default nextConfig;
