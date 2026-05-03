import type { Context } from 'hono';
import {
  createUser,
  getFriendByLineUserId,
  getLineAccounts,
  getUserByEmail,
  linkFriendToUser,
} from '@line-crm/db';
import type { Env } from '../../index.js';
import {
  reservationTokenSecret,
  secondsFromNow,
  signReservationToken,
  verifyReservationToken,
} from '../../services/reservation-tokens.js';

export async function issueReservationSession(
  c: Context<Env>,
  input: { idToken?: string; displayName?: string | null },
) {
  if (!input.idToken) return { ok: false as const, status: 400, error: 'idToken is required' };

  const verified = await verifyLineIdToken(c.env.DB, input.idToken, c.env.LINE_LOGIN_CHANNEL_ID);
  if (!verified) return { ok: false as const, status: 401, error: 'Invalid idToken' };

  const friend = await getFriendByLineUserId(c.env.DB, verified.sub);
  if (!friend) return { ok: false as const, status: 404, error: 'Friend not found' };

  let userId = friend.user_id;
  if (!userId) {
    if (verified.email) {
      const existingUser = await getUserByEmail(c.env.DB, verified.email);
      userId = existingUser?.id ?? null;
    }
    if (!userId) {
      const user = await createUser(c.env.DB, {
        email: verified.email ?? null,
        displayName: input.displayName ?? verified.name ?? friend.display_name,
      });
      userId = user.id;
    }
    await linkFriendToUser(c.env.DB, friend.id, userId);
  }

  const token = await signReservationToken(
    {
      scope: 'reservations:read',
      lineUserId: verified.sub,
      friendId: friend.id,
      userId,
      lineAccountId: friend.line_account_id,
      exp: secondsFromNow(60 * 60),
    },
    reservationTokenSecret(c.env),
  );

  return {
    ok: true as const,
    data: {
      token,
      expiresIn: 60 * 60,
      friendId: friend.id,
      userId,
      lineAccountId: friend.line_account_id,
      lineUserId: verified.sub,
    },
  };
}

export async function requireReservationSession(c: Context<Env>) {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return null;
  return verifyReservationToken(
    authHeader.slice('Bearer '.length),
    reservationTokenSecret(c.env),
    'reservations:read',
  );
}

export async function verifyLineIdToken(
  db: D1Database,
  idToken: string,
  defaultLoginChannelId: string,
): Promise<{ sub: string; email?: string; name?: string } | null> {
  const loginChannelIds = [defaultLoginChannelId];
  const accounts = await getLineAccounts(db);
  for (const account of accounts) {
    if (account.login_channel_id && !loginChannelIds.includes(account.login_channel_id)) {
      loginChannelIds.push(account.login_channel_id);
    }
  }

  for (const channelId of loginChannelIds) {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (res.ok) return res.json<{ sub: string; email?: string; name?: string }>();
  }
  return null;
}
