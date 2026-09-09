import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // @queueos/core is deliberately absent from transpilePackages: it ships
  // pre-compiled CommonJS, and running the react-refresh loader over CJS makes
  // webpack inject `import.meta` into a file it is parsing as a script, which
  // fails the whole build with "Cannot use 'import.meta' outside a module".
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000',
  },
};

export default nextConfig;
