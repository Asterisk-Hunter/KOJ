import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.clerk.accounts.dev",
      },
    ],
  },
};

export default nextConfig;
