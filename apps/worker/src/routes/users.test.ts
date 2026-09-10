import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { authMiddleware } from '../middleware/auth.js';
import { users } from './users.js';
import { usersGrouped } from './users-grouped.js';

const dbMocks = vi.hoisted(() => ({
  getStaffByApiKey: vi.fn(),
  getUsers: vi.fn(),
  getUserById: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
  linkFriendToUser: vi.fn(),
  getUserFriends: vi.fn(),
  getUserByEmail: vi.fn(),
  getUserByPhone: vi.fn(),
}));
const groupedMocks = vi.hoisted(() => ({ computeUsersGrouped: vi.fn() }));
vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/users-grouped.js', () => groupedMocks);

const userRow = {
  id: 'user-1', email: 'user@example.test', phone: '09012345678',
  external_id: 'external-1', display_name: 'Test User',
  created_at: '2026-09-01T00:00:00+09:00', updated_at: '2026-09-10T00:00:00+09:00',
};
const userData = {
  id: userRow.id, email: userRow.email, phone: userRow.phone,
  externalId: userRow.external_id, displayName: userRow.display_name,
  createdAt: userRow.created_at, updatedAt: userRow.updated_at,
};
const userInput = {
  email: userRow.email, phone: userRow.phone,
  externalId: userRow.external_id, displayName: userRow.display_name,
};
const groupedData = { rows: [], total: 0, page: 2, pageSize: 10, computedAt: userRow.updated_at };
const env = { DB: {} as D1Database, API_KEY: 'env-owner-key' } as Env['Bindings'];

const routes: Array<{
  method: string;
  path: string;
  body?: Record<string, unknown>;
  operation: ReturnType<typeof vi.fn>;
  args: unknown[];
  data: unknown;
  status?: number;
}> = [
  { method: 'GET', path: '/api/users', operation: dbMocks.getUsers, args: [], data: [userData] },
  { method: 'GET', path: '/api/users/user-1', operation: dbMocks.getUserById, args: ['user-1'], data: userData },
  {
    method: 'POST', path: '/api/users', body: userInput,
    operation: dbMocks.createUser, args: [userInput], data: userData, status: 201,
  },
  {
    method: 'PUT', path: '/api/users/user-1', body: userInput,
    operation: dbMocks.updateUser,
    args: ['user-1', {
      email: userRow.email, phone: userRow.phone,
      external_id: userRow.external_id, display_name: userRow.display_name,
    }],
    data: userData,
  },
  { method: 'DELETE', path: '/api/users/user-1', operation: dbMocks.deleteUser, args: ['user-1'], data: null },
  {
    method: 'POST', path: '/api/users/user-1/link', body: { friendId: 'friend-1' },
    operation: dbMocks.linkFriendToUser, args: ['friend-1', 'user-1'], data: null,
  },
  {
    method: 'GET', path: '/api/users/user-1/accounts', operation: dbMocks.getUserFriends,
    args: ['user-1'], data: [{ id: 'friend-1', lineUserId: 'U1', displayName: 'Friend', isFollowing: true }],
  },
  {
    method: 'POST', path: '/api/users/match', body: { email: userRow.email },
    operation: dbMocks.getUserByEmail, args: [userRow.email], data: userData,
  },
  {
    method: 'GET', path: '/api/users-grouped?q=Test&onlyDups=1&account=account-1&page=2&pageSize=10&refresh=1',
    operation: groupedMocks.computeUsersGrouped,
    args: [{ q: 'Test', onlyDups: true, account: 'account-1', page: 2, pageSize: 10, forceRefresh: true }],
    data: groupedData,
  },
];

function app() {
  const instance = new Hono<Env>();
  // Exercise the same authentication -> route role guard order as index.ts.
  instance.use('*', authMiddleware);
  instance.route('/', users);
  instance.route('/', usersGrouped);
  return instance;
}

function request(route: typeof routes[number], headers: Record<string, string>) {
  return app().request(route.path, {
    method: route.method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: route.body ? JSON.stringify(route.body) : undefined,
  }, env);
}

function expectNoUserDataAccess() {
  // Authentication may look up a staff key; user reads, writes and grouped
  // aggregation must all remain untouched when access is denied.
  for (const [name, mock] of Object.entries(dbMocks)) {
    if (name !== 'getStaffByApiKey') expect(mock).not.toHaveBeenCalled();
  }
  expect(groupedMocks.computeUsersGrouped).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  dbMocks.getStaffByApiKey.mockImplementation(async (_db, token) => {
    for (const role of ['owner', 'admin', 'staff'] as const) {
      if (token === `${role}-key`) return { id: `${role}-1`, name: role, role };
    }
    return null;
  });
  dbMocks.getUsers.mockResolvedValue([userRow]);
  dbMocks.getUserById.mockResolvedValue(userRow);
  dbMocks.createUser.mockResolvedValue(userRow);
  dbMocks.updateUser.mockResolvedValue(userRow);
  dbMocks.getUserByEmail.mockResolvedValue(userRow);
  dbMocks.getUserFriends.mockResolvedValue([
    { id: 'friend-1', line_user_id: 'U1', display_name: 'Friend', is_following: 1 },
  ]);
  groupedMocks.computeUsersGrouped.mockResolvedValue(groupedData);
});

const allowedCredentials: Array<[string, Record<string, string>]> = [
  ['owner API key', { Authorization: 'Bearer owner-key' }],
  ['admin API key', { Authorization: 'Bearer admin-key' }],
  ['environment owner API key', { Authorization: 'Bearer env-owner-key' }],
  ['admin session cookie', { Cookie: 'lh_admin_session=admin-key; lh_csrf=csrf-1', 'X-CSRF-Token': 'csrf-1' }],
];
const deniedCredentials: Array<[string, Record<string, string>, number]> = [
  ['staff API key', { Authorization: 'Bearer staff-key' }, 403],
  ['staff session cookie', { Cookie: 'lh_admin_session=staff-key; lh_csrf=csrf-1', 'X-CSRF-Token': 'csrf-1' }, 403],
  ['no credentials', {}, 401],
];

describe.each(routes)('$method $path permissions', (route) => {
  test.each(allowedCredentials)('allows %s', async (_name, headers) => {
    const response = await request(route, headers);

    expect(response.status).toBe(route.status ?? 200);
    expect(await response.json()).toEqual({ success: true, data: route.data });
    expect(route.operation).toHaveBeenCalledTimes(1);
    expect(route.operation).toHaveBeenCalledWith(env.DB, ...route.args);
  });

  test.each(deniedCredentials)('rejects %s before accessing user data', async (_name, headers, status) => {
    const response = await request(route, headers);

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      success: false,
      error: status === 401 ? 'Unauthorized' : 'この操作にはowner権限が必要です',
    });
    expectNoUserDataAccess();
  });
});
