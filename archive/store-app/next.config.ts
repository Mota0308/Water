import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Avoid picking C:\Users\Dolphin as root when a parent lockfile exists.
    root: path.join(__dirname),
  },
};

export default nextConfig;
