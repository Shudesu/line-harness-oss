import {
  getFriendById,
  getLineAccountById,
  getLineAccountByChannelId,
  resolveDefaultLineAccount,
} from '@line-crm/db';

/** Internal, per-dispatch state. Never serialize this into event payloads. */
export interface TagAutomationDispatch {
  effects: Set<string>;
  events: Set<string>;
}

export const MAX_TAG_CHANGES_PER_DISPATCH = 64;

/** Distinguishes a suppressed mutating cycle from an ordinary idempotent no-op. */
export class TagAutomationCycleError extends Error {
  constructor() {
    super('Tag automation cycle detected: repeated side effects were skipped');
    this.name = 'TagAutomationCycleError';
  }
}

export function createTagAutomationDispatch(): TagAutomationDispatch {
  return { effects: new Set(), events: new Set() };
}

export function tagChangeKey(friendId: string, tagId: string, action: string): string {
  return JSON.stringify([friendId, tagId, action]);
}

/** A remove/add loop may mutate the tag again, but must not repeat its effects. */
export function assertTagChangeBudget(dispatch: TagAutomationDispatch, key: string): void {
  if (!dispatch.effects.has(key) && dispatch.effects.size >= MAX_TAG_CHANGES_PER_DISPATCH) {
    throw new Error('Tag automation chain limit reached');
  }
}

export function claimTagEffects(dispatch: TagAutomationDispatch, key: string): boolean {
  if (dispatch.effects.has(key)) return false;
  assertTagChangeBudget(dispatch, key);
  dispatch.effects.add(key);
  return true;
}

/**
 * A tag event belongs to the friend whose tag changed. Resolve credentials from
 * that account's current DB row, never from an unrelated env/default token.
 * Unassigned legacy friends can use an explicit account or the sole active
 * account. Ambiguous/missing credentials leave LINE actions to fail visibly.
 */
export async function resolveTagEventAccount(
  db: D1Database,
  friendId: string,
  requestedAccountId?: string | null,
  fallbackChannelId?: string | null,
): Promise<{ accountId: string | null; accessToken?: string }> {
  const friend = await getFriendById(db, friendId);
  if (!friend) throw new Error('Tag event friend not found');
  if (friend.line_account_id && requestedAccountId && friend.line_account_id !== requestedAccountId) {
    throw new Error('Tag event account does not match the target friend');
  }
  const accountId = friend.line_account_id ?? requestedAccountId ?? null;
  const account = accountId
    ? await getLineAccountById(db, accountId)
    : fallbackChannelId
      ? await getLineAccountByChannelId(db, fallbackChannelId)
      : await resolveDefaultLineAccount(db);
  if (!accountId && fallbackChannelId && !account) {
    throw new Error('Tag event account channel not found');
  }
  return {
    accountId: accountId ?? account?.id ?? null,
    accessToken: account?.is_active && account.channel_access_token?.trim()
      ? account.channel_access_token
      : undefined,
  };
}
