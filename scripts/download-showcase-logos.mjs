import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicShowcaseDir = path.join(rootDir, 'public', 'showcase');
const outShowcaseDir = path.join(rootDir, 'out', 'showcase');

if (!fs.existsSync(publicShowcaseDir)) {
  fs.mkdirSync(publicShowcaseDir, { recursive: true });
}
if (!fs.existsSync(outShowcaseDir)) {
  fs.mkdirSync(outShowcaseDir, { recursive: true });
}

const LOGOS = [
  { id: 'a902c884-457e-48b3-9871-124066655001', file: 'apexlab.png', name: 'ApexLab' },
  { id: '849c13cb-9d32-4f3a-98cf-d209ca6bb735', file: 'sentrio.png', name: 'Sentrio' },
  { id: 'fc5f91b5-dae5-4b8c-b803-be1fe763937a', file: 'arclume.png', name: 'Arclume' },
  { id: '67f9864b-d397-4bf4-9186-ba58ef5b27cd', file: 'gridora.png', name: 'Gridora' },
  { id: '74a1d9ab-6fe1-44fc-81c6-630ea654f4f7', file: 'velisse.png', name: 'Velisse' },
  { id: 'd30fc84a-a40d-4dd6-a4a6-e1b6bc1b336c', file: 'nodera.png', name: 'Nodera' },
  { id: '974d97f3-668f-4bdb-9ec3-8ffcdfb11baf', file: 'arvena.png', name: 'ARVENA' },
  { id: 'a4ad1abc-58da-4aa1-8134-fcbaa9f0b858', file: 'pesat.png', name: 'Pesat.ai' },
  { id: 'd9290418-98c2-4190-9814-397c3b4a0cd3', file: 'presto.png', name: 'Presto' },
];

async function run() {
  console.log('Downloading original full-resolution logos from Cloudflare D1...');

  for (let i = 0; i < LOGOS.length; i++) {
    const item = LOGOS[i];
    console.log(`[${i + 1}/${LOGOS.length}] Fetching original ${item.name} (${item.id})...`);

    const cmd = `npx.cmd wrangler d1 execute wordmarks-db --remote --json --command="SELECT result_url FROM generation_jobs WHERE id='${item.id}'"`;
    const stdout = execSync(cmd, { cwd: rootDir, maxBuffer: 30 * 1024 * 1024 }).toString();

    const parsed = JSON.parse(stdout);
    const resultUrl = parsed?.[0]?.results?.[0]?.result_url;

    if (!resultUrl) {
      console.error(`  ERROR: No result_url found for ${item.name}`);
      continue;
    }

    // Extract base64
    const base64Index = resultUrl.indexOf(';base64,');
    let buffer;
    if (base64Index !== -1) {
      const b64 = resultUrl.substring(base64Index + 8);
      buffer = Buffer.from(b64, 'base64');
    } else if (resultUrl.startsWith('data:')) {
      const commaIndex = resultUrl.indexOf(',');
      buffer = Buffer.from(resultUrl.substring(commaIndex + 1), 'base64');
    } else {
      console.error(`  ERROR: Unsupported resultUrl format: ${resultUrl.substring(0, 50)}`);
      continue;
    }

    const publicPath = path.join(publicShowcaseDir, item.file);
    const outPath = path.join(outShowcaseDir, item.file);

    fs.writeFileSync(publicPath, buffer);
    fs.writeFileSync(outPath, buffer);

    console.log(`  SUCCESS: Saved original ${item.name} -> ${item.file} (${(buffer.length / 1024).toFixed(1)} KB)`);
  }

  console.log('\nAll 9 original logos successfully downloaded in full resolution!');
}

run().catch((err) => {
  console.error('Download failed:', err);
  process.exit(1);
});
