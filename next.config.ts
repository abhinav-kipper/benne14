import { execSync } from 'node:child_process';
import type { NextConfig } from 'next';

// One id per build (see lib/version.ts). It must be the same when the app is built and when it is
// started, or every screen would think the server is newer and reload: so it comes from the git
// commit (Vercel provides it), never from the clock.
function buildId(): string {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_BUILD_ID: buildId() },
};

export default nextConfig;
