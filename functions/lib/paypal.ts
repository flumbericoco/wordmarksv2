export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  mode: 'sandbox' | 'live';
  webhookId?: string;
  configured: boolean;
}

export const PAYPAL_PRODUCTS = {
  topup: {
    name: 'Wordmarks 25 Logo Credits',
    amount: '25.00',
    amountCents: 2500,
    credits: 25,
    kind: 'topup',
  },
  credit_1: {
    name: 'Wordmarks 1 Logo Credit',
    amount: '1.00',
    amountCents: 100,
    credits: 1,
    kind: 'topup',
  },
  credit_5: {
    name: 'Wordmarks 5 Logo Credits',
    amount: '5.00',
    amountCents: 500,
    credits: 5,
    kind: 'topup',
  },
  credit_10: {
    name: 'Wordmarks 10 Logo Credits',
    amount: '10.00',
    amountCents: 1000,
    credits: 10,
    kind: 'topup',
  },
  credit_25: {
    name: 'Wordmarks 25 Logo Credits',
    amount: '25.00',
    amountCents: 2500,
    credits: 25,
    kind: 'topup',
  },
  lite: {
    name: 'Wordmarks Lite Plan (1 Credit/mo)',
    amount: '1.00',
    amountCents: 100,
    credits: 1,
    kind: 'subscription',
  },
  growth: {
    name: 'Wordmarks Growth Plan (4 Credits/mo)',
    amount: '3.00',
    amountCents: 300,
    credits: 4,
    kind: 'subscription',
  },
  pro: {
    name: 'Wordmarks Pro Plan (10 Credits/mo)',
    amount: '7.00',
    amountCents: 700,
    credits: 10,
    kind: 'subscription',
  },
  scale: {
    name: 'Wordmarks Scale Plan (28 Credits/mo)',
    amount: '17.00',
    amountCents: 1700,
    credits: 28,
    kind: 'subscription',
  },
  byok_lifetime: {
    name: 'Wordmarks Lifetime Deal (BYOK)',
    amount: '19.00',
    amountCents: 1900,
    credits: 100,
    kind: 'lifetime',
  },
} as const;

export type PayPalProductKey = keyof typeof PAYPAL_PRODUCTS;

export interface BYOKStatus {
  salesCount: number;
  currentPrice: number;
  currentPriceStr: string;
  currentPriceCents: number;
  tier: number;
  slotsRemaining: number;
  nextPrice: number;
}

export async function getBYOKStatus(db: D1Database): Promise<BYOKStatus> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'byokSalesCount'").first<{ value: string }>();
  const salesCount = Math.max(0, parseInt(row?.value || '0', 10) || 0);
  const tierIndex = Math.floor(salesCount / 5);
  const currentPrice = 19 + tierIndex * 10;
  const nextPrice = currentPrice + 10;
  const slotsRemaining = 5 - (salesCount % 5);
  return {
    salesCount,
    currentPrice,
    currentPriceStr: `${currentPrice}.00`,
    currentPriceCents: currentPrice * 100,
    tier: tierIndex + 1,
    slotsRemaining,
    nextPrice,
  };
}

export async function getPayPalConfig(db: D1Database, env: unknown): Promise<PayPalConfig> {
  const envObj = (env || {}) as Record<string, unknown>;
  const rows = await db.prepare(
    "SELECT key, value FROM settings WHERE key IN ('paypalClientId', 'paypalClientSecret', 'paypalMode', 'paypalWebhookId')"
  ).all<{ key: string; value: string }>();

  const dbMap = new Map<string, string>();
  for (const row of rows.results || []) {
    dbMap.set(row.key, row.value);
  }

  const clientId = (dbMap.get('paypalClientId') || String(envObj.PAYPAL_CLIENT_ID || '')).trim();
  const clientSecret = (dbMap.get('paypalClientSecret') || String(envObj.PAYPAL_CLIENT_SECRET || '')).trim();
  const rawMode = (dbMap.get('paypalMode') || String(envObj.PAYPAL_MODE || '')).trim().toLowerCase();
  const mode: 'sandbox' | 'live' = rawMode === 'live' ? 'live' : 'sandbox';
  const webhookId = (dbMap.get('paypalWebhookId') || String(envObj.PAYPAL_WEBHOOK_ID || '')).trim() || undefined;

  return {
    clientId,
    clientSecret,
    mode,
    webhookId,
    configured: Boolean(clientId && clientSecret),
  };
}

export function getPayPalApiBase(mode: 'sandbox' | 'live'): string {
  return mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
}

export async function getPayPalAccessToken(clientId: string, clientSecret: string, mode: 'sandbox' | 'live'): Promise<string> {
  if (!clientId || !clientSecret) {
    throw new Error('PayPal Client ID and Secret Key are required');
  }

  const base = getPayPalApiBase(mode);
  const credentials = btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      'Accept-Language': 'en_US',
    },
    body: 'grant_type=client_credentials',
  });

  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok || !payload.access_token) {
    const errorDesc = String(payload.error_description || payload.message || payload.error || 'PayPal authentication failed');
    throw new Error(`PayPal auth error (${response.status}): ${errorDesc}`);
  }

  return String(payload.access_token);
}

export async function testPayPalCredentials(clientId: string, clientSecret: string, mode: 'sandbox' | 'live'): Promise<{ ok: boolean; mode: string; appId?: string; error?: string }> {
  try {
    const base = getPayPalApiBase(mode);
    const credentials = btoa(`${clientId}:${clientSecret}`);

    const response = await fetch(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: 'grant_type=client_credentials',
    });

    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok || !payload.access_token) {
      const errorDesc = String(payload.error_description || payload.message || payload.error || 'Failed to authenticate with PayPal');
      return { ok: false, mode, error: errorDesc };
    }

    return {
      ok: true,
      mode,
      appId: typeof payload.app_id === 'string' ? payload.app_id : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      mode,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

export interface CreateOrderParams {
  userId: string;
  userEmail: string;
  productKey: PayPalProductKey | string;
  origin: string;
  customCredits?: number;
}

export async function createPayPalOrder(
  db: D1Database,
  env: unknown,
  params: CreateOrderParams
): Promise<{ orderId: string; approveUrl: string; mode: string }> {
  const config = await getPayPalConfig(db, env);
  if (!config.configured) {
    throw new Error('PayPal is not configured. Please enter PayPal Client ID and Secret in Admin.');
  }

  let productName = 'Wordmarks Logo Credits';
  let amountStr = '25.00';
  let productKind: 'topup' | 'subscription' | 'lifetime' = 'topup';
  let creditsAwarded = 25;

  if (params.productKey === 'byok_lifetime') {
    const byok = await getBYOKStatus(db);
    productName = `Wordmarks Lifetime Deal (BYOK) - Early Bird Tier ${byok.tier}`;
    amountStr = byok.currentPriceStr;
    productKind = 'lifetime';
    creditsAwarded = 100;
  } else if (params.customCredits && params.customCredits >= 1) {
    creditsAwarded = Math.floor(params.customCredits);
    amountStr = `${creditsAwarded}.00`;
    productName = `Wordmarks ${creditsAwarded} Logo ${creditsAwarded === 1 ? 'Credit' : 'Credits'}`;
    productKind = 'topup';
  } else if (params.productKey in PAYPAL_PRODUCTS) {
    const p = PAYPAL_PRODUCTS[params.productKey as PayPalProductKey];
    productName = p.name;
    amountStr = p.amount;
    productKind = p.kind;
    creditsAwarded = p.credits;
  } else {
    throw new Error(`Invalid purchase product: ${params.productKey}`);
  }

  const accessToken = await getPayPalAccessToken(config.clientId, config.clientSecret, config.mode);
  const base = getPayPalApiBase(config.mode);

  const customId = `${params.userId}:${params.productKey}:${productKind}:${params.customCredits || ''}`;
  const returnUrl = `${params.origin}/account?paypal=success&product=${params.productKey}`;
  const cancelUrl = `${params.origin}/account?paypal=cancelled`;

  const orderPayload = {
    intent: 'CAPTURE',
    purchase_units: [
      {
        reference_id: `wordmarks-${params.userId.slice(0, 8)}-${Date.now()}`,
        description: productName,
        custom_id: customId,
        amount: {
          currency_code: 'USD',
          value: amountStr,
          breakdown: {
            item_total: {
              currency_code: 'USD',
              value: amountStr,
            },
          },
        },
        items: [
          {
            name: productName,
            unit_amount: {
              currency_code: 'USD',
              value: amountStr,
            },
            quantity: '1',
            category: 'DIGITAL_GOODS',
          },
        ],
      },
    ],
    application_context: {
      brand_name: 'Wordmarks.net',
      landing_page: 'NO_PREFERENCE',
      user_action: 'PAY_NOW',
      shipping_preference: 'NO_SHIPPING',
      return_url: returnUrl,
      cancel_url: cancelUrl,
    },
  };

  const response = await fetch(`${base}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'PayPal-Request-Id': `order-${params.userId}-${params.productKey}-${Math.floor(Date.now() / 1000)}`,
    },
    body: JSON.stringify(orderPayload),
  });

  const order = await response.json() as {
    id?: string;
    status?: string;
    links?: Array<{ href: string; rel: string; method: string }>;
    message?: string;
    details?: Array<{ issue: string; description: string; field?: string }>;
  };

  if (!response.ok || !order.id) {
    const firstDetail = order.details?.[0];
    const detail = firstDetail
      ? `${firstDetail.description || firstDetail.issue || 'Invalid request'}${firstDetail.field ? ` (${firstDetail.field})` : ''}`
      : order.message || 'Failed to create PayPal order';
    throw new Error(`PayPal Order Creation failed: ${detail}`);
  }

  const approveLink = order.links?.find((l) => l.rel === 'approve')?.href;
  if (!approveLink) {
    throw new Error('PayPal approve URL not found in order response');
  }

  return {
    orderId: order.id,
    approveUrl: approveLink,
    mode: config.mode,
  };
}

export interface CaptureResult {
  fulfilled: boolean;
  alreadyProcessed: boolean;
  orderId: string;
  creditsAdded: number;
  newCredits: number;
  productKey: string;
  kind: string;
  amount: number;
  currency: string;
  payerEmail?: string;
}

export async function capturePayPalOrder(
  db: D1Database,
  env: unknown,
  orderId: string,
  expectedUserId: string
): Promise<CaptureResult> {
  const config = await getPayPalConfig(db, env);
  if (!config.configured) {
    throw new Error('PayPal is not configured');
  }

  const reference = `paypal:${orderId}`;
  const existingTx = await db.prepare(
    'SELECT credits FROM payment_transactions WHERE stripe_checkout_id = ? AND status = ? LIMIT 1'
  ).bind(reference, 'paid').first<{ credits: number }>();

  if (existingTx) {
    const userRow = await db.prepare('SELECT credits FROM users WHERE id = ?').bind(expectedUserId).first<{ credits: number }>();
    return {
      fulfilled: true,
      alreadyProcessed: true,
      orderId,
      creditsAdded: existingTx.credits,
      newCredits: userRow?.credits || 0,
      productKey: 'existing',
      kind: 'topup',
      amount: 0,
      currency: 'USD',
    };
  }

  const accessToken = await getPayPalAccessToken(config.clientId, config.clientSecret, config.mode);
  const base = getPayPalApiBase(config.mode);

  // Capture the order
  const response = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'PayPal-Request-Id': `capture-${orderId}`,
    },
  });

  const captureData = await response.json() as Record<string, unknown>;

  // If already captured, fetch order details
  let orderData = captureData;

  if (!response.ok) {
    // If order was already captured, fetch the order details to verify
    const getOrderRes = await fetch(`${base}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    if (getOrderRes.ok) {
      orderData = await getOrderRes.json() as Record<string, unknown>;
    } else {
      const err = (captureData.message || captureData.error || 'Failed to capture PayPal order') as string;
      throw new Error(`PayPal capture failed: ${err}`);
    }
  }

  const finalStatus = String(orderData.status || '');
  if (finalStatus !== 'COMPLETED') {
    throw new Error(`PayPal order is not completed. Current status: ${finalStatus}`);
  }

  const purchaseUnits = (orderData.purchase_units as Array<Record<string, unknown>>) || [];
  const unit = purchaseUnits[0] || {};
  const customId = String(unit.custom_id || '');
  const [orderUserId, productKeyRaw, kindRaw, customCreditsRaw] = customId.split(':');

  if (orderUserId && orderUserId !== expectedUserId) {
    throw new Error('This PayPal transaction belongs to a different user account');
  }

  const productKey = productKeyRaw || 'topup';
  const customCreditsNum = customCreditsRaw ? parseInt(customCreditsRaw, 10) : 0;

  const payments = (unit.payments as Record<string, unknown>) || {};
  const captures = (payments.captures as Array<Record<string, unknown>>) || [];
  const primaryCapture = captures[0] || {};
  const captureId = String(primaryCapture.id || orderId);
  const amountObj = (primaryCapture.amount || unit.amount || {}) as Record<string, string>;
  const currency = String(amountObj.currency_code || 'USD').toUpperCase();
  const payer = (orderData.payer as Record<string, unknown>) || {};
  const payerEmail = typeof payer.email_address === 'string' ? payer.email_address : undefined;

  let credits = 25;
  let kind = 'topup';
  let amountCents = Math.round(parseFloat(amountObj.value || '25') * 100);

  if (productKey === 'byok_lifetime' || kindRaw === 'lifetime') {
    credits = 100;
    kind = 'lifetime';
  } else if (customCreditsNum >= 1) {
    credits = customCreditsNum;
    kind = 'topup';
    amountCents = customCreditsNum * 100;
  } else if (productKey in PAYPAL_PRODUCTS) {
    const p = PAYPAL_PRODUCTS[productKey as PayPalProductKey];
    credits = p.credits;
    kind = p.kind;
    amountCents = p.amountCents;
  }

  const reason = kind === 'lifetime'
    ? 'lifetime_byok_activation'
    : kind === 'subscription'
    ? 'subscription_activation'
    : 'credit_topup';

  const statements: D1PreparedStatement[] = [
    db.prepare('INSERT INTO credit_ledger(id, user_id, amount, reason, reference) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), expectedUserId, credits, reason, reference),
    db.prepare("UPDATE users SET credits = credits + ?, updated_at = datetime('now') WHERE id = ?").bind(credits, expectedUserId),
    db.prepare(`INSERT INTO payment_transactions
      (id, user_id, stripe_checkout_id, stripe_payment_intent_id, kind, amount, currency, credits, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'paid')`)
      .bind(crypto.randomUUID(), expectedUserId, reference, captureId, `paypal_${kind}`, amountCents, currency.toLowerCase(), credits),
  ];

  if (kind === 'lifetime') {
    statements.push(
      db.prepare("UPDATE users SET plan = 'byok_lifetime', updated_at = datetime('now') WHERE id = ?").bind(expectedUserId),
      db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('byokSalesCount', '1', datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = datetime('now')`)
    );
  } else if (kind === 'subscription') {
    statements.push(
      db.prepare("UPDATE users SET plan = ?, updated_at = datetime('now') WHERE id = ?").bind(productKey, expectedUserId),
      db.prepare(`INSERT INTO subscriptions(id, user_id, stripe_subscription_id, plan, status)
        VALUES(?, ?, ?, ?, 'active')
        ON CONFLICT(stripe_subscription_id) DO UPDATE SET plan = excluded.plan, status = 'active', updated_at = datetime('now')`)
        .bind(crypto.randomUUID(), expectedUserId, `paypal:${orderId}`, productKey)
    );
  }

  try {
    await db.batch(statements);
  } catch (err) {
    const checkDuplicate = await db.prepare('SELECT id FROM credit_ledger WHERE reference = ?').bind(reference).first();
    if (!checkDuplicate) throw err;
  }

  const updatedUser = await db.prepare('SELECT credits FROM users WHERE id = ?').bind(expectedUserId).first<{ credits: number }>();

  return {
    fulfilled: true,
    alreadyProcessed: false,
    orderId,
    creditsAdded: credits,
    newCredits: updatedUser?.credits ?? 0,
    productKey,
    kind,
    amount: amountCents,
    currency,
    payerEmail,
  };
}
