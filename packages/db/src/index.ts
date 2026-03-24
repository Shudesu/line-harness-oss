export { jstNow, toJstString, isTimeBefore } from './utils';
export * from './friends';
export * from './tags';
export * from './scenarios';
export * from './broadcasts';
export * from './users';
export * from './line-accounts';
export * from './conversions';
export * from './affiliates';
export * from './webhooks';
export * from './calendar';
export * from './reminders';
export * from './scoring';
export * from './templates';
export * from './chats';
export * from './notifications';
export * from './stripe';
export * from './subscriptions';
export * from './health';
export * from './automations';
export * from './entry-routes';
export * from './tracked-links';
export * from './forms';

/**
 * Thin wrapper around D1Database.
 * Pass the result of createDb() into any query helper in this package.
 */
export function createDb(d1: D1Database): D1Database {
  return d1;
}
