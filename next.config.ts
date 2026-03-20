import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "replicate.delivery",
      },
      {
        protocol: "https",
        hostname: "*.replicate.delivery",
      },
      {
        protocol: "https",
        hostname: "pbxt.replicate.delivery",
      },
    ],
  },
  // Include @sparticuz/chromium binary files in serverless function bundle
  outputFileTracingIncludes: {
    "/api/lead-generator/*": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
};

export default nextConfig;
