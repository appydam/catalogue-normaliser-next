import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {},
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "catalogai-product-images.s3.us-east-1.amazonaws.com",
      },
    ],
  },
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
