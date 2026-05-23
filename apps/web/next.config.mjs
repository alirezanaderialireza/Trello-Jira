/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@repo/api",
    "@repo/auth",
    "@repo/db",
    "@repo/domain",
    "@repo/infrastructure",
  ],
};

export default nextConfig;
