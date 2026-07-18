import { j as jstNow, g as getFriendById, a as getTemplateById, b as getMergedMetadataByUserId, c as getLineAccountById, d as getFriendsByTag, e as getTrafficPoolBySlug, f as createTrafficPool, h as addPoolAccount, i as getPoolAccounts, k as getScenarios, l as enrollFriendInScenario, m as getScenarioSteps, n as computeNextDeliveryAt, r as resolveStepContent, o as addTagToFriend, s as setFriendFirstTrackedLinkIfNull, p as getScenarioById, q as advanceFriendScenario, t as completeFriendScenario, u as applyScoring, v as getTrackedLinkById, w as getMessageTemplateById, x as recoverStuckDeliveries, y as recoverStalledBroadcasts } from "./worker-entry-uEp0SFfO.js";
import { A, F, z, B, C, D, E, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z, _, $, a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, aa, ab, ac, ad, ae, af, ag, ah, ai, aj, ak, al, am, an, ao, ap, aq, ar, as, at, au, av, aw, ax, ay, az, aA, aB, aC, aD, aE, aF, aG, aH, aI, aJ, aK, aL, aM, aN, aO, aP, aQ, aR, aS, aT, aU, aV, aW, aX, aY, aZ, a_, a$, b0, b1, b2, b3, b4, b5, b6, b7, b8, b9, ba, bb, bc, bd, be, bf, bg, bh, bi, bj, bk, bl, bm, bn, bo, bp, bq, br, bs, bt, bu, bv, bw, bx, by, bz, bA, bB, bC, bD, bE, bF, bG, bH, bI, bJ, bK, bL, bM, bN, bO, bP, bQ, bR, bS, bT, bU, bV, bW, bX, bY, bZ, b_, b$, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, ca, cb, cc, cd, ce, cf, cg, ch, ci, cj, ck, cl, cm, cn, co, cp, cq, cr, cs, ct, cu, cv, cw, cx, cy, cz, cA, cB, cC, cD, cE, cF, cG, cH, cI, cJ, cK, cL, cM, cN, cO, cP, cQ, cR, cS, cT, cU, cV, cW, cX, cY, cZ, c_, c$, d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, da, db, dc, dd, de, df, dg, dh, di, dj, dk, dl, dm, dn, dp } from "./worker-entry-uEp0SFfO.js";
import "node:events";
import "node:stream";
import "node:crypto";
import "node:zlib";
import "events";
async function getNotificationRules(db2) {
  const result = await db2.prepare(`SELECT * FROM notification_rules ORDER BY created_at DESC`).all();
  return result.results;
}
async function getNotificationRuleById(db2, id) {
  return db2.prepare(`SELECT * FROM notification_rules WHERE id = ?`).bind(id).first();
}
async function createNotificationRule(db2, input) {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db2.prepare(`INSERT INTO notification_rules (id, name, event_type, conditions, channels, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, input.name, input.eventType, JSON.stringify(input.conditions ?? {}), JSON.stringify(input.channels ?? ["dashboard"]), now, now).run();
  return await getNotificationRuleById(db2, id);
}
async function updateNotificationRule(db2, id, updates) {
  const sets = [];
  const values = [];
  if (updates.name !== void 0) {
    sets.push("name = ?");
    values.push(updates.name);
  }
  if (updates.eventType !== void 0) {
    sets.push("event_type = ?");
    values.push(updates.eventType);
  }
  if (updates.conditions !== void 0) {
    sets.push("conditions = ?");
    values.push(JSON.stringify(updates.conditions));
  }
  if (updates.channels !== void 0) {
    sets.push("channels = ?");
    values.push(JSON.stringify(updates.channels));
  }
  if (updates.isActive !== void 0) {
    sets.push("is_active = ?");
    values.push(updates.isActive ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push("updated_at = ?");
  values.push(jstNow());
  values.push(id);
  await db2.prepare(`UPDATE notification_rules SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
}
async function deleteNotificationRule(db2, id) {
  await db2.prepare(`DELETE FROM notification_rules WHERE id = ?`).bind(id).run();
}
async function getNotifications(db2, opts = {}) {
  const limit = opts.limit ?? 100;
  if (opts.status) {
    const result2 = await db2.prepare(`SELECT * FROM notifications WHERE status = ? ORDER BY created_at DESC LIMIT ?`).bind(opts.status, limit).all();
    return result2.results;
  }
  const result = await db2.prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`).bind(limit).all();
  return result.results;
}
async function createNotification(db2, input) {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db2.prepare(`INSERT INTO notifications (id, rule_id, event_type, title, body, channel, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, input.ruleId ?? null, input.eventType, input.title, input.body, input.channel, input.metadata ?? null, now).run();
  return await db2.prepare(`SELECT * FROM notifications WHERE id = ?`).bind(id).first();
}
async function updateNotificationStatus(db2, id, status) {
  await db2.prepare(`UPDATE notifications SET status = ? WHERE id = ?`).bind(status, id).run();
}
async function getActiveNotificationRulesByEvent(db2, eventType) {
  const result = await db2.prepare(`SELECT * FROM notification_rules WHERE event_type = ? AND is_active = 1`).bind(eventType).all();
  return result.results;
}
function createDb(d12) {
  return d12;
}
export {
  A as ATTRIBUTION_WINDOW_DAYS,
  F as FRIEND_ADD_WINNER_SUBQUERY,
  z as acquirePublishLock,
  addPoolAccount,
  B as addScore,
  addTagToFriend,
  advanceFriendScenario,
  applyScoring,
  C as buildRichMenuAliasId,
  D as cancelFriendReminder,
  E as claimFriendScenarioForDelivery,
  completeFriendScenario,
  G as completeReminderIfDone,
  computeNextDeliveryAt,
  H as countActiveStaffByRole,
  I as countAffiliateLinks,
  J as countStaffByRole,
  K as createAccountHealthLog,
  L as createAccountMigration,
  M as createAdPlatform,
  N as createAffiliate,
  O as createAffiliateLink,
  P as createAffiliateOffer,
  Q as createAffiliateWithRandomCode,
  R as createAutoReply,
  S as createAutomation,
  T as createAutomationLog,
  U as createBroadcast,
  V as createBroadcastInsight,
  W as createCalendarBooking,
  X as createCalendarConnection,
  Y as createChat,
  Z as createConversionPoint,
  createDb,
  _ as createEntryRoute,
  $ as createForm,
  a0 as createFormSubmission,
  a1 as createIncomingWebhook,
  a2 as createLineAccount,
  a3 as createMessageTemplate,
  createNotification,
  createNotificationRule,
  a4 as createOperator,
  a5 as createOutgoingWebhook,
  a6 as createReminder,
  a7 as createReminderStep,
  a8 as createRichMenuGroup,
  a9 as createScenario,
  aa as createScenarioStep,
  ab as createScoringRule,
  ac as createStaffMember,
  ad as createStripeEvent,
  ae as createTag,
  af as createTemplate,
  ag as createTrackedLink,
  createTrafficPool,
  ah as createUser,
  ai as deleteAdPlatform,
  aj as deleteAffiliate,
  ak as deleteAutoReply,
  al as deleteAutomation,
  am as deleteBroadcast,
  an as deleteCalendarConnection,
  ao as deleteConversionPoint,
  ap as deleteEntryRoute,
  aq as deleteForm,
  ar as deleteIncomingWebhook,
  as as deleteLineAccount,
  at as deleteMessageTemplate,
  deleteNotificationRule,
  au as deleteOperator,
  av as deleteOutgoingWebhook,
  aw as deleteReminder,
  ax as deleteReminderStep,
  ay as deleteRichMenuGroup,
  az as deleteScenario,
  aA as deleteScenarioStep,
  aB as deleteScoringRule,
  aC as deleteStaffMember,
  aD as deleteTag,
  aE as deleteTemplate,
  aF as deleteTrackedLink,
  aG as deleteTrafficPool,
  aH as deleteUser,
  aI as enrollAffiliateInOffer,
  aJ as enrollFriendInReminder,
  enrollFriendInScenario,
  aK as generateRefSlug,
  aL as getAccountHealthLogs,
  aM as getAccountMigrationById,
  aN as getAccountMigrations,
  aO as getAccountSetting,
  aP as getActiveAdPlatforms,
  aQ as getActiveAutomationsByEvent,
  getActiveNotificationRulesByEvent,
  aR as getActiveOutgoingWebhooksByEvent,
  aS as getActiveRulesByEvent,
  aT as getAdConversionLogs,
  aU as getAdPlatformById,
  aV as getAdPlatformByName,
  aW as getAdPlatforms,
  aX as getAffiliateByCode,
  aY as getAffiliateByFriendId,
  aZ as getAffiliateById,
  a_ as getAffiliateJourneys,
  a$ as getAffiliateLinkByRefCode,
  b0 as getAffiliateLinkStats,
  b1 as getAffiliateOfferById,
  b2 as getAffiliateReport,
  b3 as getAffiliateReportV2,
  b4 as getAffiliates,
  b5 as getAutoReplies,
  b6 as getAutoReplyById,
  b7 as getAutomationById,
  b8 as getAutomationLogs,
  b9 as getAutomations,
  ba as getBookingsInRange,
  bb as getBroadcastById,
  bc as getBroadcasts,
  bd as getCalendarBookingById,
  be as getCalendarBookings,
  bf as getCalendarConnectionById,
  bg as getCalendarConnections,
  bh as getChatByFriendId,
  bi as getChatById,
  bj as getChats,
  bk as getConversionApprovalNotifyInfo,
  bl as getConversionApprovalQueue,
  bm as getConversionEvents,
  bn as getConversionPointById,
  bo as getConversionPoints,
  bp as getConversionReport,
  bq as getDueReminderDeliveries,
  br as getEntryRouteById,
  bs as getEntryRouteByRefCode,
  bt as getEntryRouteFunnel,
  bu as getEntryRoutes,
  bv as getFollowingLineUserIdsByTag,
  bw as getFormById,
  bx as getFormSubmissions,
  by as getForms,
  bz as getFormsWithStats,
  getFriendById,
  bA as getFriendByLineUserId,
  bB as getFriendCount,
  bC as getFriendJourney,
  bD as getFriendReminders,
  bE as getFriendScenariosDueForDelivery,
  bF as getFriendScore,
  bG as getFriendScoreHistory,
  bH as getFriendTags,
  bI as getFriends,
  getFriendsByTag,
  bJ as getIncomingWebhookById,
  bK as getIncomingWebhooks,
  bL as getLatestRiskLevel,
  bM as getLineAccountByChannelId,
  getLineAccountById,
  bN as getLineAccounts,
  bO as getLinkBaseUrl,
  bP as getLinkClicks,
  getMergedMetadataByUserId,
  getMessageTemplateById,
  getNotificationRuleById,
  getNotificationRules,
  getNotifications,
  bQ as getOperatorById,
  bR as getOperators,
  bS as getOutgoingWebhookById,
  bT as getOutgoingWebhooks,
  bU as getPendingInsights,
  getPoolAccounts,
  bV as getQueuedBroadcasts,
  bW as getRandomPoolAccount,
  bX as getRefTrackingByFriend,
  bY as getRefTrackingStats,
  bZ as getRefTrackingWithClickIds,
  b_ as getReminderById,
  b$ as getReminderSteps,
  c0 as getReminders,
  c1 as getRichMenuGroupById,
  c2 as getRichMenuGroupWithPages,
  c3 as getRichMenuGroups,
  getScenarioById,
  getScenarioSteps,
  getScenarios,
  c4 as getScoringRuleById,
  c5 as getScoringRules,
  c6 as getStaffByApiKey,
  c7 as getStaffById,
  c8 as getStaffMembers,
  c9 as getStripeEventByStripeId,
  ca as getStripeEvents,
  cb as getTags,
  getTemplateById,
  cc as getTemplateUsage,
  cd as getTemplates,
  ce as getTemplatesWithUsageCount,
  getTrackedLinkById,
  cf as getTrackedLinks,
  cg as getTrafficPoolById,
  getTrafficPoolBySlug,
  ch as getTrafficPools,
  ci as getUserByEmail,
  cj as getUserById,
  ck as getUserByPhone,
  cl as getUserFriends,
  cm as getUsers,
  cn as incrementAffiliateLinkClick,
  co as isTimeBefore,
  jstNow,
  cp as linkFriendToUser,
  cq as listAffiliateLinks,
  cr as listAffiliateOffers,
  cs as listMessageTemplates,
  ct as logAdConversion,
  cu as markInsightFailed,
  cv as markReminderStepDelivered,
  cw as markRichMenuGroupPublished,
  cx as markRichMenuGroupUnpublished,
  cy as pageBelongsToGroup,
  cz as recordAffiliateClick,
  cA as recordLinkClick,
  cB as recordRefTracking,
  recoverStalledBroadcasts,
  recoverStuckDeliveries,
  cC as regenerateStaffApiKey,
  cD as releasePublishLock,
  cE as removePoolAccount,
  cF as removeTagFromFriend,
  cG as replaceRichMenuPages,
  cH as resolveAffiliateAttribution,
  resolveStepContent,
  cI as setAccountSetting,
  cJ as setConversionApproval,
  setFriendFirstTrackedLinkIfNull,
  cK as setLinkBaseUrl,
  cL as setPageRichMenuId,
  cM as setRichMenuPageImage,
  cN as toJstString,
  cO as togglePoolAccount,
  cP as trackConversion,
  cQ as updateAccountMigration,
  cR as updateAdPlatform,
  cS as updateAffiliate,
  cT as updateAffiliateOffer,
  cU as updateAutoReply,
  cV as updateAutomation,
  cW as updateBroadcast,
  cX as updateBroadcastBatchProgress,
  cY as updateBroadcastFailedAccountIds,
  cZ as updateBroadcastLineRequestId,
  c_ as updateBroadcastStatus,
  c$ as updateCalendarBookingEventId,
  d0 as updateCalendarBookingStatus,
  d1 as updateChat,
  d2 as updateEntryRoute,
  d3 as updateForm,
  d4 as updateFriendFollowStatus,
  d5 as updateIncomingWebhook,
  d6 as updateInsightResult,
  d7 as updateLineAccount,
  d8 as updateLineAccountFields,
  d9 as updateLineAccountOrder,
  da as updateMessageTemplate,
  updateNotificationRule,
  updateNotificationStatus,
  db as updateOperator,
  dc as updateOutgoingWebhook,
  dd as updateReminder,
  de as updateRichMenuGroupMeta,
  df as updateScenario,
  dg as updateScenarioStep,
  dh as updateScoringRule,
  di as updateStaffMember,
  dj as updateTemplate,
  dk as updateTrackedLink,
  dl as updateTrafficPool,
  dm as updateUser,
  dn as upsertChatOnMessage,
  dp as upsertFriend
};
