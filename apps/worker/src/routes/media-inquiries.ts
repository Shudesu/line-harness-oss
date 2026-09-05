import { Hono } from 'hono';
import type { Env } from '../index.js';

const mediaInquiries = new Hono<Env>();

const ALLOWED_ORIGINS = new Set([
  'https://the-harness.com',
  'https://www.the-harness.com',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
]);

type InquiryInput = {
  inquiryType?: string;
  companyName?: string;
  contactName?: string;
  department?: string;
  position?: string;
  decisionRole?: string;
  email?: string;
  phone?: string;
  companySize?: string;
  currentTools?: string;
  lineFriendCount?: string;
  budget?: string;
  timeframe?: string;
  challenge?: string;
  desiredOutcome?: string;
  preferredContact?: string;
  sourceArticle?: string;
  sourceUrl?: string;
  referrer?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  website?: string;
  consent?: boolean;
};

const text = (value: unknown, max = 1000): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

mediaInquiries.post('/api/public/media-inquiries', async (c) => {
  const origin = c.req.header('origin') || '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    return c.json({ success: false, error: 'Origin not allowed' }, 403);
  }

  let body: InquiryInput;
  try {
    body = await c.req.json<InquiryInput>();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }

  // Honeypot: acknowledge bots without writing or notifying.
  if (text(body.website, 200)) {
    return c.json({ success: true, data: { id: crypto.randomUUID() } }, 201);
  }

  const inquiryType = text(body.inquiryType, 80);
  const companyName = text(body.companyName, 200);
  const contactName = text(body.contactName, 120);
  const email = text(body.email, 254).toLowerCase();
  const challenge = text(body.challenge, 4000);

  if (!inquiryType || !companyName || !contactName || !emailPattern.test(email) || !challenge || body.consent !== true) {
    return c.json({ success: false, error: 'Required fields are missing or invalid' }, 400);
  }

  const id = crypto.randomUUID();
  const values = {
    department: text(body.department, 120),
    position: text(body.position, 120),
    decisionRole: text(body.decisionRole, 80),
    phone: text(body.phone, 50),
    companySize: text(body.companySize, 80),
    currentTools: text(body.currentTools, 500),
    lineFriendCount: text(body.lineFriendCount, 80),
    budget: text(body.budget, 80),
    timeframe: text(body.timeframe, 80),
    desiredOutcome: text(body.desiredOutcome, 3000),
    preferredContact: text(body.preferredContact, 80),
    sourceArticle: text(body.sourceArticle, 500),
    sourceUrl: text(body.sourceUrl, 1000),
    referrer: text(body.referrer, 1000),
    utmSource: text(body.utmSource, 200),
    utmMedium: text(body.utmMedium, 200),
    utmCampaign: text(body.utmCampaign, 200),
  };

  await c.env.DB.prepare(
    `INSERT INTO media_inquiries (
      id, inquiry_type, company_name, contact_name, department, position,
      decision_role, email, phone, company_size, current_tools,
      line_friend_count, budget, timeframe, challenge, desired_outcome,
      preferred_contact, source_article, source_url, referrer,
      utm_source, utm_medium, utm_campaign, country, cf_ray,
      mail_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`,
  ).bind(
    id, inquiryType, companyName, contactName, values.department, values.position,
    values.decisionRole, email, values.phone, values.companySize, values.currentTools,
    values.lineFriendCount, values.budget, values.timeframe, challenge, values.desiredOutcome,
    values.preferredContact, values.sourceArticle, values.sourceUrl, values.referrer,
    values.utmSource, values.utmMedium, values.utmCampaign,
    c.req.header('cf-ipcountry') || '', c.req.header('cf-ray') || '',
  ).run();

  let mailStatus = 'pending';
  let mailError = '';
  try {
    const form = new FormData();
    form.set('_subject', `【The Harness法人問い合わせ】${companyName}｜${inquiryType}`);
    form.set('_template', 'table');
    form.set('_replyto', email);
    form.set('受付ID', id);
    form.set('問い合わせ種別', inquiryType);
    form.set('会社名', companyName);
    form.set('担当者名', contactName);
    form.set('部署・役職', [values.department, values.position].filter(Boolean).join(' / '));
    form.set('決裁への関与', values.decisionRole);
    form.set('メール', email);
    form.set('電話', values.phone);
    form.set('従業員規模', values.companySize);
    form.set('現在のツール', values.currentTools);
    form.set('LINE友だち数', values.lineFriendCount);
    form.set('予算', values.budget);
    form.set('希望時期', values.timeframe);
    form.set('相談内容', challenge);
    form.set('実現したい状態', values.desiredOutcome);
    form.set('希望連絡方法', values.preferredContact);
    form.set('流入記事', values.sourceArticle);
    form.set('流入URL', values.sourceUrl);

    const response = await fetch('https://formsubmit.co/ajax/info@aiagent-inc.com', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Origin: 'https://the-harness.com',
        Referer: 'https://the-harness.com/contact/',
      },
      body: form,
    });
    const responseBody = await response.json().catch(() => null) as {
      success?: boolean | string;
      message?: string;
    } | null;
    const providerAccepted = responseBody?.success === true || responseBody?.success === 'true';
    const activationRequired = /activation/i.test(responseBody?.message || '');
    if (response.ok && providerAccepted) {
      mailStatus = 'accepted';
    } else if (response.ok && activationRequired) {
      mailStatus = 'activation_required';
      mailError = text(responseBody?.message, 500);
    } else {
      mailStatus = 'failed';
      mailError = response.ok
        ? text(responseBody?.message, 500) || 'Notification provider rejected the request'
        : `HTTP ${response.status}`;
    }
  } catch (error) {
    mailStatus = 'failed';
    mailError = error instanceof Error ? error.message.slice(0, 500) : 'Unknown notification error';
  }

  await c.env.DB.prepare(
    `UPDATE media_inquiries SET mail_status = ?, mail_error = ?, updated_at = datetime('now') WHERE id = ?`,
  ).bind(mailStatus, mailError || null, id).run();

  return c.json({
    success: true,
    data: {
      id,
      notification: mailStatus,
      fallbackEmail: 'info@aiagent-inc.com',
    },
  }, 201);
});

export { mediaInquiries };
