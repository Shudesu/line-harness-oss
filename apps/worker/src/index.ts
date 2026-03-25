import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { LineClient } from '@line-crm/line-sdk';
import { processStepDeliveries } from './services/step-delivery.js';
import { processScheduledBroadcasts } from './services/broadcast.js';
import { processReminderDeliveries } from './services/reminder-delivery.js';
import { checkAccountHealth } from './services/ban-monitor.js';
import { refreshLineAccessTokens } from './services/token-refresh.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { webhook } from './routes/webhook.js';
import { friends } from './routes/friends.js';
import { tags } from './routes/tags.js';
import { scenarios } from './routes/scenarios.js';
import { broadcasts } from './routes/broadcasts.js';
import { users } from './routes/users.js';
import { lineAccounts } from './routes/line-accounts.js';
import { conversions } from './routes/conversions.js';
import { affiliates } from './routes/affiliates.js';
import { openapi } from './routes/openapi.js';
import { liffRoutes } from './routes/liff.js';
// Round 3 ルート
import { webhooks } from './routes/webhooks.js';
import { calendar } from './routes/calendar.js';
import { reminders } from './routes/reminders.js';
import { scoring } from './routes/scoring.js';
import { templates } from './routes/templates.js';
import { chats } from './routes/chats.js';
import { notifications } from './routes/notifications.js';
import { stripe } from './routes/stripe.js';
import { health } from './routes/health.js';
import { automations } from './routes/automations.js';
import { richMenus } from './routes/rich-menus.js';
import { trackedLinks } from './routes/tracked-links.js';
import { forms } from './routes/forms.js';
import { betaFeedback } from './routes/beta-feedback.js';
import { ai } from './routes/ai.js';

export type Env = {
  Bindings: {
    DB: D1Database;
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    API_KEY: string;
    LIFF_URL: string;
    LINE_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
    // Security: comma-separated list of allowed origins (e.g. "https://admin.example.com")
    // Leave empty to allow all origins (dev only)
    ALLOWED_ORIGINS: string;
    // Stealth mode: set to "true" to enable zero-width char insertion (default: disabled)
    ENABLE_STEALTH_MODE: string;
    // Beta feedback — GitHub Issue auto-creation
    // Set with: wrangler secret put GITHUB_TOKEN / GITHUB_REPO
    GITHUB_TOKEN: string;
    GITHUB_REPO: string; // e.g. "ShunsukeHayashi/line-harness-oss"
    // Claude AI integration
    ANTHROPIC_API_KEY: string;
  };
};

const app = new Hono<Env>();

// CORS — restrict to ALLOWED_ORIGINS env var (comma-separated list)
// Leave ALLOWED_ORIGINS empty for dev/local; set explicitly in production
app.use('*', (c, next) => {
  const allowedStr = c.env.ALLOWED_ORIGINS ?? '';
  const allowedList = allowedStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Empty list = allow all origins (dev mode); non-empty = strict whitelist
  const originConfig = allowedList.length > 0 ? allowedList : '*';
  return cors({
    origin: originConfig,
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
    credentials: allowedList.length > 0, // credentials only with explicit origins
  })(c, next);
});

// Auth middleware — skips /webhook and /docs automatically
app.use('*', authMiddleware);

// Rate limiting — protects high-risk endpoints from abuse
app.use(
  '/api/broadcasts/*',
  rateLimitMiddleware({ windowMs: 60_000, maxRequests: 10, keyPrefix: 'broadcast' }),
);
app.use(
  '/api/friends/*',
  rateLimitMiddleware({ windowMs: 60_000, maxRequests: 100, keyPrefix: 'friends' }),
);
app.use(
  '/api/liff/*',
  rateLimitMiddleware({ windowMs: 60_000, maxRequests: 60, keyPrefix: 'liff' }),
);

// Mount route groups — MVP & Round 2
app.route('/', webhook);
app.route('/', friends);
app.route('/', tags);
app.route('/', scenarios);
app.route('/', broadcasts);
app.route('/', users);
app.route('/', lineAccounts);
app.route('/', conversions);
app.route('/', affiliates);
app.route('/', openapi);
app.route('/', liffRoutes);

// Mount route groups — Round 3
app.route('/', webhooks);
app.route('/', calendar);
app.route('/', reminders);
app.route('/', scoring);
app.route('/', templates);
app.route('/', chats);
app.route('/', notifications);
app.route('/', stripe);
app.route('/', health);
app.route('/', automations);
app.route('/', richMenus);
app.route('/', trackedLinks);
app.route('/', forms);
app.route('/', betaFeedback);
app.route('/', ai);

// 404 fallback
app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

// Scheduled handler for cron triggers
async function scheduled(
  _event: ScheduledEvent,
  env: Env['Bindings'],
  _ctx: ExecutionContext,
): Promise<void> {
  const lineClient = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);

  await Promise.allSettled([
    processStepDeliveries(env.DB, lineClient),
    processScheduledBroadcasts(env.DB, lineClient),
    processReminderDeliveries(env.DB, lineClient),
    checkAccountHealth(env.DB),
    refreshLineAccessTokens(env.DB),
  ]);
}

export default {
  fetch: app.fetch,
  scheduled,
};
