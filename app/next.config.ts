import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    '/api/studio/**/*': [
      './studio-seed/selected/aa9fc8898c70b319e154e503f749ada069f41b5f-1024x512.png',
      './studio-seed/selected/d12fdb3dcf51e0a0f74d03a16cc5079f4025f819-1456x816.png',
      './studio-seed/selected/bdc42d57cc69c91335756c48bc1a256d617d8ef1-1456x816.png',
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
