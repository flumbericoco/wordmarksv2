import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('MCP accepts raster output and reports its actual media type', async () => {
  const source = await read('functions/mcp.ts');
  assert.match(source, /'image\/png'.*'image\/jpeg'.*'image\/webp'/s);
  assert.match(source, /mimeType: generatedImage\.mimeType/);
  assert.doesNotMatch(source, /Generated content is not valid SVG/);
});

test('generation archives large assets in R2 instead of D1 when bound', async () => {
  const source = await read('functions/api/v1/[action].ts');
  const config = await read('wrangler.toml');
  assert.match(source, /generatedBucket\.put\(r2Key/);
  assert.match(source, /r2_key = \?/);
  assert.match(config, /binding = "GENERATED_BUCKET"/);
  assert.match(config, /binding = "KB_BUCKET"/);
});

test('quality reviews are persisted and reused for the same brand', async () => {
  const source = await read('functions/api/v1/[action].ts');
  assert.match(source, /INSERT INTO quality_learnings/);
  assert.match(source, /FROM quality_learnings/);
  assert.match(source, /PERSISTENT QUALITY LEARNING/);
});

test('credit reservation and refund use unique ledger references', async () => {
  const source = await read('functions/api/v1/[action].ts');
  assert.match(source, /web-generation:\$\{requestId\}/);
  assert.match(source, /refund:\$\{spendReference\}/);
  assert.match(source, /Insufficient credits/);
});

test('automatic review obeys the Studio toggle', async () => {
  const source = await read('app/page.tsx');
  assert.match(source, /if \(autoReview\)/);
  assert.doesNotMatch(source, /autoReview \|\|/);
  assert.match(source, /A paid revision must always be compared/);
});

test('pure wordmark selection explicitly forbids detached icons', async () => {
  const prompt = await read('functions/lib/prompts.ts');
  const pipeline = await read('functions/api/v1/[action].ts');
  assert.match(prompt, /ABSOLUTE PURE WORDMARK MODE/);
  assert.match(prompt, /Do not create an icon/);
  assert.match(pipeline, /ABSOLUTE PURE-WORDMARK CONSTRAINT/);
  assert.match(pipeline, /Zero detached icons or symbols are allowed/);
  assert.match(pipeline, /TYPE-ONLY EXECUTION/);
});

test('logo history response stays below the legacy base64 payload ceiling', async () => {
  const account = await read('functions/api/v1/account/[action].ts');
  assert.match(account, /ORDER BY created_at DESC LIMIT 9/);
  assert.match(account, /Cache-Control': 'private, no-store/);
});
