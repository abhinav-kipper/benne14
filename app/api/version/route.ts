import { json } from '@/lib/server';
import { BUILD_ID } from '@/lib/version';

export const dynamic = 'force-dynamic';

// The build this server is running. Screens compare it with the build they were loaded from and
// reload themselves after a deploy (lib/client.ts useAutoReload).
export async function GET() {
  return json({ build: BUILD_ID });
}
