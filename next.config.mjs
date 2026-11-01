import { readFileSync } from 'node:fs'

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Sent along with bug reports so the owner knows which build the user was on.
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  // Development only: organizations live on <slug>.nextrotta.localhost, and the dev server refuses
  // its own scripts/HMR to origins it doesn't know — pages there wouldn't hydrate.
  allowedDevOrigins: ['nextrotta.localhost', '*.nextrotta.localhost'],
  // Browser protections on every response. HSTS keeps the whole domain on https; the framing rule stops other sites from
  // wrapping the system in a page of theirs; the camera stays available to the system itself (barcode scan in Venda de Peças).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // Controle de despesas used to live at /admin/financeiro: old links and bookmarks keep working.
      { source: '/admin/financeiro', destination: '/admin/despesas', permanent: true },
    ];
  },
}

export default nextConfig
