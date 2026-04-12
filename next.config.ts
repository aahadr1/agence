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
    "/api/lead-generator/search": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/api/lead-generator/enrich": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/api/lead-generator/lists/[listId]/expand": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
    "/api/research/browse": ["./node_modules/@sparticuz/chromium/bin/**/*"],
    "/api/business-analyzer/analyze": [
      "./node_modules/@sparticuz/chromium/bin/**/*",
    ],
  },
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
};

export default nextConfig;
