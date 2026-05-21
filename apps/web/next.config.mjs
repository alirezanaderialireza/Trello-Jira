/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@repo/api",
    "@repo/db",
    "@repo/domain",
    "@repo/auth",
    "@repo/infrastructure",
  ],
};

export default nextConfig;
