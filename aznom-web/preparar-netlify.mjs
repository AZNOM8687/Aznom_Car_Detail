import { writeFileSync } from 'node:fs';

const destino = process.env.AZNOM_API_ORIGIN;
if (!destino) {
  throw new Error('Configure AZNOM_API_ORIGIN com o endereço HTTPS do backend.');
}

const url = new URL(destino);
if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
  throw new Error('AZNOM_API_ORIGIN deve conter somente a origem HTTPS do backend.');
}

writeFileSync(
  new URL('./dist/aznom-web/browser/_redirects', import.meta.url),
  `/api/* ${url.origin}/api/:splat 200!\n`,
);
