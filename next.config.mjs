/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained build for slim Docker images (ghcr.io/.../sentinel:latest).
  output: 'standalone',
};

export default nextConfig;
