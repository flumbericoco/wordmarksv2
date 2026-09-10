import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const MCP_URL = process.env.WORDMARKS_MCP_URL || 'https://wordmarks.net/mcp';
const token = process.env.WORDMARKS_MCP_TOKEN;

if (!token) {
  console.error('WORDMARKS_MCP_TOKEN belum diset.');
  console.error('$env:WORDMARKS_MCP_TOKEN="token-anda"');
  process.exit(1);
}

const rl = createInterface({ input, output });

try {
  const brandName = (await rl.question('Nama brand: ')).trim();
  if (!brandName) throw new Error('Nama brand wajib diisi.');

  const description = (await rl.question('Deskripsi bisnis: ')).trim();
  const style = (await rl.question('Gaya [modern minimal]: ')).trim() || 'modern minimal';
  const colorPreference = (await rl.question('Warna [black and white]: ')).trim() || 'black and white';
  const layout = (await rl.question('Layout [horizontal]: ')).trim() || 'horizontal';
  const defaultFile = `${brandName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'logo'}.svg`;
  const filename = (await rl.question(`Nama file [${defaultFile}]: `)).trim() || defaultFile;

  console.log('\nMembuat logo...');
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'generate_wordmark_logo',
        arguments: { brandName, description, style, colorPreference, layout },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  const result = await response.json();
  if (!response.ok || result.error || result.result?.isError) {
    const message = result.error?.message || result.result?.content?.[0]?.text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  const image = result.result?.content?.find((item) => item.type === 'image');
  if (!image?.data || image.mimeType !== 'image/svg+xml') {
    throw new Error('Server tidak mengembalikan SVG.');
  }

  const outputPath = resolve(process.cwd(), filename.endsWith('.svg') ? filename : `${filename}.svg`);
  await writeFile(outputPath, Buffer.from(image.data, 'base64'));
  console.log(`Logo berhasil disimpan: ${outputPath}`);
} catch (error) {
  console.error(`Gagal: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  rl.close();
}
