import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('PayPal configuration and product catalog are correctly defined', async () => {
  const source = await read('functions/lib/paypal.ts');
  assert.match(source, /topup:\s*\{[\s\S]*amount:\s*'25\.00'[\s\S]*credits:\s*25/);
  assert.match(source, /lite:\s*\{[\s\S]*amount:\s*'1\.00'[\s\S]*credits:\s*1/);
  assert.match(source, /growth:\s*\{[\s\S]*amount:\s*'3\.00'[\s\S]*credits:\s*4/);
  assert.match(source, /pro:\s*\{[\s\S]*amount:\s*'7\.00'[\s\S]*credits:\s*10/);
  assert.match(source, /scale:\s*\{[\s\S]*amount:\s*'17\.00'[\s\S]*credits:\s*28/);
  assert.match(source, /https:\/\/api-m\.paypal\.com/);
  assert.match(source, /https:\/\/api-m\.sandbox\.paypal\.com/);
});

test('PayPal order creation requires credentials and returns approval URL', async () => {
  const createOrderSource = await read('functions/api/v1/billing/paypal-create-order.ts');
  const helperSource = await read('functions/lib/paypal.ts');
  assert.match(createOrderSource, /createPayPalOrder/);
  assert.match(helperSource, /intent:\s*'CAPTURE'/);
  assert.match(helperSource, /v2\/checkout\/orders/);
  assert.match(helperSource, /rel === 'approve'/);
});

test('PayPal capture idempotency ensures credits are never double-awarded', async () => {
  const helperSource = await read('functions/lib/paypal.ts');
  const captureEndpoint = await read('functions/api/v1/billing/paypal-capture-order.ts');
  assert.match(helperSource, /SELECT credits FROM payment_transactions WHERE stripe_checkout_id = \? AND status = \?/);
  assert.match(helperSource, /alreadyProcessed:\s*true/);
  assert.match(helperSource, /paypal:\$\{orderId\}/);
  assert.match(helperSource, /INSERT INTO credit_ledger/);
  assert.match(helperSource, /UPDATE users SET credits = credits \+ \?/);
  assert.match(captureEndpoint, /capturePayPalOrder/);
});

test('Admin studio provides PayPal client ID, secret key, environment and connection test', async () => {
  const billingAdmin = await read('app/admin/billing/page.tsx');
  const settingsAdmin = await read('app/admin/settings/page.tsx');
  const settingsApi = await read('functions/api/v1/admin/settings.ts');
  const testApi = await read('functions/api/v1/admin/paypal-test.ts');

  assert.match(billingAdmin, /PayPal Payment Gateway/);
  assert.match(billingAdmin, /PayPal Client ID/);
  assert.match(billingAdmin, /PayPal Secret Key/);
  assert.match(billingAdmin, /Test PayPal Connection/);

  assert.match(settingsAdmin, /PayPal Payment Gateway/);
  assert.match(settingsAdmin, /paypalClientId/);

  assert.match(settingsApi, /paypalClientId/);
  assert.match(settingsApi, /paypalClientSecret/);
  assert.match(settingsApi, /paypalClientSecretMasked/);

  assert.match(testApi, /testPayPalCredentials/);
});

test('Zero free credits on registration and direct purchase policy enforcement', async () => {
  const accountAction = await read('functions/api/v1/account/[action].ts');
  const accountPage = await read('app/account/page.tsx');
  const homePage = await read('app/page.tsx');

  // New accounts start with 0 credits
  assert.match(accountAction, /INSERT INTO users \(id, email, password_hash, password_salt, credits\) VALUES \(\?, \?, \?, \?, 0\)/);

  // Free beta replaced with direct purchase / standard account
  assert.doesNotMatch(accountPage, /Free beta/);
  assert.match(accountPage, /Direct purchase account/);
  assert.match(accountPage, /No free trial/);

  // Home page reflects direct purchase
  assert.match(homePage, /Direct purchase · No free trial/);
});
