/* global process */
/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

// Full CSP for production. Next.js injects inline bootstrap scripts and inline
// styles (no nonce infra here), so 'unsafe-inline' is required for script/style;
// connect-src is same-origin only (API + SSE). In dev we relax CSP so HMR
// websockets / react-refresh eval keep working and e2e (dev server) isn't broken.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://g.alicdn.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' https://login.dingtalk.com https://pre-login.dingtalk.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'"
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: isProd ? PROD_CSP : "frame-ancestors 'self'"
  }
];

if (isProd) {
  // HSTS only takes effect over HTTPS; harmless (ignored) over plain HTTP, and
  // we avoid pinning localhost during dev. Internal TLS terminator should keep
  // this enabled. (Antigravity #7)
  securityHeaders.push({
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains"
  });
}

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@fe-radar/core", "@fe-radar/db", "@fe-radar/shared"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
