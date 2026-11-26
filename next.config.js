/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          // CSP（2026-11-26 上架前補上；本站無外部腳本／字體／iframe，
          // 圖片來自多家官方 CDN 故 img-src 放寬為 https:；Next.js 內聯
          // 腳本與樣式需 unsafe-inline／unsafe-eval，否則水合會壞；
          // 瀏覽器端只連本站 /api 與 Supabase，故 connect-src 只放這兩處）。
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
              "frame-src 'none'",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
        source: "/:path*",
      },
    ];
  },
};

module.exports = nextConfig;
