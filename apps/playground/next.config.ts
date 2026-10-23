import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@gra-evat/core', '@gra-evat/mock'],
  poweredByHeader: false,
};
export default config;
