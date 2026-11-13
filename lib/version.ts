// Identifies one build. Set in next.config.ts (the git commit on Vercel, the build time elsewhere) and
// inlined into both the browser bundle and the server, so a screen can tell when the server is newer.
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';
