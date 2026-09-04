import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingIncludes: {
    "/catalog": [
      "./data/song-database.json",
      "./data/song-database.json.gz",
      "./data/song-database.json.gz.part-01",
      "./data/song-database.json.gz.part-02",
    ],
  },
};

export default nextConfig;
