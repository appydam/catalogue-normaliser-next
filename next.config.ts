import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // pdfjs-dist references canvas & fs on the server — exclude from client bundle
      config.resolve.alias = {
        ...config.resolve.alias,
        canvas: false,
        fs: false,
      };
    }
    return config;
  },
};

export default nextConfig;
