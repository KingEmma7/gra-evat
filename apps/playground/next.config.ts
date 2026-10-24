import type { NextConfig } from 'next';
import { securityHeaders } from './security-headers.mjs';

const development = process.env.NODE_ENV === 'development';
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  transpilePackages: ['@gra-evat/core', '@gra-evat/mock'],
  poweredByHeader: false,
  // Production static headers are emitted after the export for the hosting platform.
  ...(development
    ? {
        async headers() {
          return [
            {
              source: '/:path*',
              headers: Object.entries(securityHeaders(true)).map(([key, value]) => ({
                key,
                value,
              })),
            },
          ];
        },
      }
    : {}),
};
export default config;
