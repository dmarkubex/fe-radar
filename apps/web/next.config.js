/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@fe-radar/core", "@fe-radar/db", "@fe-radar/shared"]
};

export default nextConfig;
