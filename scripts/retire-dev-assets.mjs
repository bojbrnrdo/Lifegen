// Do not deploy retired Dev-tab public files. Vercel can serve /public
// statically before Express sees requests, so route-level 404 is insufficient.
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function retireDevAssets(root, productionBuild) {
  if (!productionBuild) return false;
  await rm(path.join(root, 'public', 'lifeide'), { recursive: true, force: true });
  await rm(path.join(root, 'public', 'admin', 'js', 'views', 'devWorkspace.js'), { force: true });
  await rm(path.join(root, 'public', 'admin', 'js', 'views', 'developer.js'), { force: true });
  return true;
}

const entry = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === entry) {
  const root = path.resolve(path.dirname(entry), '..');
  const productionBuild = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV) || process.env.NODE_ENV === 'production';
  if (await retireDevAssets(root, productionBuild)) console.log('Removed retired Dev static assets from production build.');
}
