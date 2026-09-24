import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const clientDir = path.join(root, 'dist', 'client');

async function prerender() {
  console.log('\n[prerender] Generating static HTML for Vercel CDN...');

  const { startProdServer } = await import('../node_modules/vinext/dist/server/prod-server.js');
  const port = 4099;
  
  await startProdServer({
    port,
    silent: true,
    outDir: path.join(root, 'dist'),
  });

  const routes = [
    { url: '/', files: ['index.html'] },
    { url: '/editor', files: ['editor/index.html', 'editor.html'] },
    { url: '/dublajlar', files: ['dublajlar/index.html', 'dublajlar.html'] },
    { url: '/nasil-oynanir', files: ['nasil-oynanir/index.html', 'nasil-oynanir.html'] },
  ];

  for (const route of routes) {
    const res = await fetch(`http://127.0.0.1:${port}${route.url}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} on ${route.url}`);
    }
    const html = await res.text();
    for (const file of route.files) {
      const output = path.join(clientDir, file);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, html, 'utf-8');
      console.log(`✓ Generated ${path.relative(root, output)} (${(html.length / 1024).toFixed(1)} KB)`);
    }
  }

  console.log('[prerender] Static pages ready for Vercel deployment!\n');
  process.exit(0);
}

prerender().catch((err) => {
  console.error('[prerender] Fatal error:', err);
  process.exit(1);
});
