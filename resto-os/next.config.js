/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    outputFileTracingIncludes: {
      '/api/**': ['./lib/schema.sql'],
    },
  },
};

module.exports = nextConfig;
