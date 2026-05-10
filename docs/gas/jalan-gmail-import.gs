/**
 * Jalan Gmail importer for LINE Harness reservations.
 *
 * Setup:
 * 1. Open Google Apps Script attached to the Gmail account that receives Jalan mail.
 * 2. Paste this file.
 * 3. Run setupJalanImporterProperties() once and fill Script Properties.
 * 4. Run importJalanReservationMails() manually, then add a time-driven trigger.
 *
 * Required Script Properties:
 * - WORKER_URL: https://your-worker.example.workers.dev
 * - WORKER_API_KEY: Worker admin API key
 *
 * Optional Script Properties:
 * - DEFAULT_RESOURCE_ID: fallback reservation resource id
 * - DEFAULT_MENU_ID: fallback reservation menu id
 * - ROUTING_RULES_JSON: JSON array of { name, resourceId, menuId, keywords }
 * - GMAIL_QUERY: Gmail search query
 * - PROCESSED_LABEL: label for imported messages
 * - REVIEW_LABEL: label for needs_review messages
 * - MAX_THREADS: max Gmail threads per run
 * - DRY_RUN: true to log payloads without posting
 */

function setupJalanImporterProperties() {
  const props = PropertiesService.getScriptProperties();
  props.setProperties(
    {
      WORKER_URL: 'https://your-worker.example.workers.dev',
      WORKER_API_KEY: 'replace-with-worker-api-key',
      DEFAULT_RESOURCE_ID: '',
      DEFAULT_MENU_ID: '',
      ROUTING_RULES_JSON: JSON.stringify([
        {
          name: 'blueberry-60',
          resourceId: 'res_blueberry',
          menuId: 'menu_picking_60',
          keywords: ['ブルーベリー', '食べ放題60分'],
        },
      ]),
      GMAIL_QUERY: 'from:(jalan_active_support@r.recruit.co.jp) newer_than:30d',
      PROCESSED_LABEL: 'line-harness/jalan-imported',
      REVIEW_LABEL: 'line-harness/jalan-needs-review',
      MAX_THREADS: '20',
      DRY_RUN: 'true',
    },
    false,
  );
}

function importJalanReservationMails() {
  const config = getJalanImporterConfig_();
  logJalanCatalog_(config);
  const processedLabel = getOrCreateLabel_(config.processedLabel);
  const reviewLabel = getOrCreateLabel_(config.reviewLabel);
  const query = `${config.gmailQuery} -label:"${config.processedLabel}" -label:"${config.reviewLabel}"`;
  const threads = GmailApp.search(query, 0, config.maxThreads);

  for (const thread of threads) {
    for (const message of thread.getMessages()) {
      const payload = buildJalanPayload_(message, config);
      if (!payload.rawText) continue;

      if (config.dryRun) {
        console.log(JSON.stringify({ dryRun: true, payload }, null, 2));
        continue;
      }

      const result = postJalanPayload_(payload, config);
      if (result.ok && result.status === 'needs_review') {
        message.getThread().addLabel(reviewLabel);
      } else if (result.ok) {
        message.getThread().addLabel(processedLabel);
      } else {
        console.error(JSON.stringify({ messageId: payload.gmailMessageId, error: result }, null, 2));
      }
    }
  }
}

function getJalanImporterConfig_() {
  const props = PropertiesService.getScriptProperties();
  const workerUrl = requiredProperty_(props, 'WORKER_URL').replace(/\/+$/, '');
  const workerApiKey = requiredProperty_(props, 'WORKER_API_KEY');
  return {
    workerUrl,
    workerApiKey,
    defaultResourceId: props.getProperty('DEFAULT_RESOURCE_ID') || props.getProperty('RESOURCE_ID') || '',
    defaultMenuId: props.getProperty('DEFAULT_MENU_ID') || props.getProperty('MENU_ID') || '',
    routingRules: parseRoutingRules_(props.getProperty('ROUTING_RULES_JSON') || '[]'),
    gmailQuery: props.getProperty('GMAIL_QUERY') || 'from:(jalan_active_support@r.recruit.co.jp) newer_than:30d',
    processedLabel: props.getProperty('PROCESSED_LABEL') || 'line-harness/jalan-imported',
    reviewLabel: props.getProperty('REVIEW_LABEL') || 'line-harness/jalan-needs-review',
    maxThreads: Math.max(1, Math.min(Number(props.getProperty('MAX_THREADS') || '20'), 100)),
    dryRun: (props.getProperty('DRY_RUN') || 'false').toLowerCase() === 'true',
  };
}

function requiredProperty_(props, key) {
  const value = props.getProperty(key);
  if (!value || value === 'replace-with-worker-api-key') {
    throw new Error(`Script Property ${key} is required`);
  }
  return value;
}

function buildJalanPayload_(message, config) {
  const rawText = message.getPlainBody();
  const route = resolveJalanRoute_(rawText, config);
  return {
    gmailMessageId: message.getId(),
    receivedAt: message.getDate().toISOString(),
    rawText,
    resourceId: route.resourceId || undefined,
    menuId: route.menuId || undefined,
    routeName: route.name || null,
    routeKeyword: route.keyword || null,
  };
}

function parseRoutingRules_(value) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((rule) => ({
        name: String(rule.name || ''),
        resourceId: String(rule.resourceId || ''),
        menuId: String(rule.menuId || ''),
        keywords: Array.isArray(rule.keywords) ? rule.keywords.map(String).filter(Boolean) : [],
      }))
      .filter((rule) => rule.resourceId && rule.menuId && rule.keywords.length > 0);
  } catch (err) {
    throw new Error(`ROUTING_RULES_JSON is invalid JSON: ${err.message}`);
  }
}

function resolveJalanRoute_(rawText, config) {
  const normalized = normalizeRouteText_(rawText);
  for (const rule of config.routingRules) {
    const keyword = rule.keywords.find((item) => normalized.indexOf(normalizeRouteText_(item)) !== -1);
    if (keyword) {
      return {
        name: rule.name,
        keyword,
        resourceId: rule.resourceId,
        menuId: rule.menuId,
      };
    }
  }

  return {
    name: 'default',
    keyword: null,
    resourceId: config.defaultResourceId,
    menuId: config.defaultMenuId,
  };
}

function normalizeRouteText_(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function logJalanCatalog_(config) {
  if (!config.dryRun) return;
  const response = UrlFetchApp.fetch(`${config.workerUrl}/api/integrations/jalan/catalog`, {
    method: 'get',
    headers: {
      Authorization: `Bearer ${config.workerApiKey}`,
    },
    muteHttpExceptions: true,
  });
  console.log(response.getContentText());
}

function postJalanPayload_(payload, config) {
  const response = UrlFetchApp.fetch(`${config.workerUrl}/api/integrations/jalan/gmail/import`, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${config.workerApiKey}`,
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  const bodyText = response.getContentText();
  let body;
  try {
    body = JSON.parse(bodyText);
  } catch (err) {
    return { ok: false, statusCode, error: bodyText };
  }

  if (statusCode < 200 || statusCode >= 300 || !body.success) {
    return {
      ok: false,
      statusCode,
      error: body.error || 'worker_error',
      code: body.code || null,
    };
  }

  return {
    ok: true,
    statusCode,
    status: body.data && body.data.status,
    data: body.data,
  };
}

function getOrCreateLabel_(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}
