# Wordmarks.net

AI-powered logo and wordmark generator. Users enter a brand name and description; the system generates logo concepts via OpenAI, reviews them, and iterates until a result is accepted.

## Architecture

```
Browser / AI Agents
        |
        | HTTPS
        v
wordmarks.net (static site)          api.wordmarks.net (Cloudflare Pages Functions)
   Next.js static export                  /api/v1/*
   Cloudflare Pages                       |
                                          +-- Auth (WORDMARKS_MCP_TOKEN / CF Access JWT)
                                          +-- Rate limiting (KV-backed)
                                          +-- Provider allowlist + retry
                                          +-- D1 database (providers, settings, KB, jobs, audit)
                                          +-- R2 storage (knowledge-base images, generated logos)
                                          +-- OpenAI API (proxied, key never exposed to client)
```

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | Next.js 15 (static export) | Deployed to Cloudflare Pages project `wordmarks-v2` |
| Backend API | Cloudflare Pages Functions | `functions/api/v1/*` |
| Database | Cloudflare D1 | `wordmarks-db` |
| KV Cache | Cloudflare KV | `WORDMARKS_KV` (rate limiting) |
| Object Storage | Cloudflare R2 | `wordmarks-kb` + `wordmarks-generated` |
| Auth | Cloudflare Access + Bearer token | Self-hosted apps on admin routes |
| AI Provider | OpenAI API | Key stored as Cloudflare Pages secret |

## Quick Start

```bash
# Install dependencies
npm install

# Run development server (requires wrangler for Functions)
npm run dev

# Build static export
npm run build        # output goes to out/

# Deploy to Cloudflare Pages
CLOUDFLARE_ACCOUNT_ID=<account-id> wrangler pages deploy out --project-name=wordmarks-v2 --branch=main
```

## Environment and Secrets

Secrets are stored as Cloudflare Pages secrets. **Never commit values to the repo.**

| Secret Name | Purpose | How to set |
|-------------|---------|------------|
| `OPENAI_API_KEY` | OpenAI API access | `wrangler pages secret put OPENAI_API_KEY --project-name=wordmarks-v2` |
| `WORDMARKS_MCP_TOKEN` | Auth token for API/MCP agents | `wrangler pages secret put WORDMARKS_MCP_TOKEN --project-name=wordmarks-v2` |
| `STRIPE_SECRET_KEY` | Stripe server API key | Cloudflare Pages secret |
| `STRIPE_WEBHOOK_SECRET` | Signature verification for `/api/v1/billing/webhook` | Cloudflare Pages secret |
| `STRIPE_PRICE_INITIAL_25` | One-time $25 credit pack Price ID | Cloudflare Pages secret |
| `STRIPE_PRICE_LITE` | $1/month recurring Price ID | Cloudflare Pages secret |
| `STRIPE_PRICE_GROWTH` | $3/month recurring Price ID | Cloudflare Pages secret |
| `STRIPE_PRICE_PRO` | $7/month recurring Price ID | Cloudflare Pages secret |
| `STRIPE_PRICE_SCALE` | $17/month recurring Price ID | Cloudflare Pages secret |

Local `.env.local` contains only reference config (model names, defaults) -- no API keys.

## API Usage

Canonical API hostname: `https://api.wordmarks.net`

## MCP for Claude Code and AI Agents

The production MCP endpoint is:

```text
https://wordmarks-v2-dz1.pages.dev/mcp
```

Set a dedicated token once in Cloudflare (do not commit the value):

```bash
npx wrangler pages secret put WORDMARKS_MCP_TOKEN --project-name=wordmarks-v2
```

Connect Claude Code:

```bash
claude mcp add --transport http wordmarks https://wordmarks-v2-dz1.pages.dev/mcp \
  --header "Authorization: Bearer YOUR_WORDMARKS_MCP_TOKEN"
```

The server exposes `generate_wordmark_logo`. Example agent instruction:

```text
Use generate_wordmark_logo to create a bold horizontal blue wordmark for Acme,
a payment platform for small businesses.
```

Any MCP client that supports Streamable HTTP can use the same endpoint and Bearer header.

### Health Check

```bash
curl -s https://api.wordmarks.net/api/v1/health
# {"ok":true,"database":"up","kv":"up","r2_kb":"up","r2_generated":"up"}
```

### Generate a Logo

```bash
curl -s -X POST https://api.wordmarks.net/api/v1/generate-logo \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WORDMARKS_MCP_TOKEN" \
  -d '{"brandName":"Acme","description":"Modern tech startup"}'
```

### Review / Iterate

```bash
# Review
curl -s -X POST https://api.wordmarks.net/api/v1/review \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WORDMARKS_MCP_TOKEN" \
  -d '{"jobId":"<job-id>","imageData":"<base64>"}'

# Iterate
curl -s -X POST https://api.wordmarks.net/api/v1/iterate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $WORDMARKS_MCP_TOKEN" \
  -d '{"jobId":"<job-id>","feedback":"Make it bolder"}'
```

### Admin Endpoints

All admin routes require authentication (401 unauthenticated).

```bash
curl -s https://api.wordmarks.net/api/v1/admin/stats \
  -H "Authorization: Bearer $WORDMARKS_MCP_TOKEN"
```

Admin UI is available at `https://wordmarks.net/admin/*` (protected by Cloudflare Access).

## Resource Inventory

| Resource | Name | ID | Binding |
|----------|------|----|---------|
| Pages Project | wordmarks-v2 | `6bf68e48-a2af-4307-983d-efff898e769b` | -- |
| D1 Database | wordmarks-db | `9c354852-9b71-4f13-abaf-c9a1a0bbd6e4` | DB |
| KV Namespace | WORDMARKS_KV | `625572dce3d948ea8ebf927de238e718` | WORDMARKS_KV |
| R2 Bucket | wordmarks-kb | -- | KB_BUCKET |
| R2 Bucket | wordmarks-generated | -- | GENERATED_BUCKET |

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/v1/health` | GET | None | Service health (D1, KV, R2 status) |
| `/api/v1/research` | POST | Optional | Brand research |
| `/api/v1/generate-logo` | POST | Optional | Generate logo concepts |
| `/api/v1/review` | POST | Optional | Review generated logo |
| `/api/v1/iterate` | POST | Optional | Iterate on feedback |
| `/api/v1/admin/stats` | GET | Required | Dashboard stats |
| `/api/v1/admin/providers` | GET/POST | Required | Provider CRUD |
| `/api/v1/admin/settings` | GET/POST | Required | Settings management |
| `/api/v1/admin/knowledge-base` | GET/POST/DELETE | Required | Knowledge base CRUD |
| `/api/v1/admin/export` | GET | Required | Redacted data export |
| `/api/v1/db/migrate` | POST | Required | Run D1 schema migration |

## Documentation

| Document | Description |
|----------|-------------|
| [INFRA.md](INFRA.md) | Infrastructure details, DNS, Cloudflare resources |
| [SECURITY.md](SECURITY.md) | Secrets, auth, rate limiting, compromised keys |
| [RUNBOOK.md](RUNBOOK.md) | Health checks, common issues, rollback procedures |
| [CHANGELOG-INFRA.md](CHANGELOG-INFRA.md) | Infrastructure change history |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture overview and decisions |
| [coldstart/coldstart.md](coldstart/coldstart.md) | Current state and session history |

## Production

- **Site**: https://wordmarks.net
- **API**: https://api.wordmarks.net
- **Latest deployment**: `e89b8bcc` on main branch
- **Stack**: Cloudflare Pages + D1 + KV + R2 + Pages Functions

## License

MIT
