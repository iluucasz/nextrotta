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
  async redirects() {
    return [
      // Controle de despesas used to live at /admin/financeiro: old links and bookmarks keep working.
      { source: '/admin/financeiro', destination: '/admin/despesas', permanent: true },
    ];
  },
}

export default nextConfig
