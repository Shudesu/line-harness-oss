import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../index.js';

const SECRET_SENTINEL = 'p0-secret-must-not-appear';

const dbMocks = {
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
};

const groupedMocks = {
  computeUsersGrouped: vi.fn(),
};

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('../services/users-grouped.js', () => groupedMocks);

const { authMiddleware } = await import('../middleware/auth.js');
const { users } = await import('./users.js');
const { usersGrouped } = await import('./users-grouped.js');

type Role = 'owner' | 'admin' | 'staff';

const identities: Record<string, { id: string; name: string; role: Role }> = {
  'owner-key': { id: 'owner-1', name: 'Owner One', role: 'owner' },
  'admin-key': { id: 'admin-1', name: 'Admin One', role: 'admin' },
  'staff-key': { id: 'staff-1', name: 'Staff One', role: 'staff' },
};

const fakeUser = {
  id: 'user-1',
  email: 'user@example.test',
  phone: '09000000000',
  external_id: 'external-1',
  display_name: 'Test User',
  created_at: '2026-07-30T00:00:00.000Z',
  updated_at: '2026-07-30T00:00:00.000Z',
};

const routeDbMocks = [
  dbMocks.getUsers,
  dbMocks.getUserById,
  dbMocks.createUser,
  dbMocks.updateUser,
  dbMocks.deleteUser,
  dbMocks.linkFriendToUser,
  dbMocks.getUserFriends,
  dbMocks.getUserByEmail,
  dbMocks.getUserByPhone,
  groupedMocks.computeUsersGrouped,
];

function bindings(): Env['Bindings'] {
  return {
    DB: {} as D1Database,
    IMAGES: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    LINE_CHANNEL_SECRET: SECRET_SENTINEL,
    LINE_CHANNEL_ACCESS_TOKEN: SECRET_SENTINEL,
    API_KEY: 'env-owner-key',
    LIFF_URL: 'https://liff.example.test',
    LINE_CHANNEL_ID: 'line-channel',
    LINE_LOGIN_CHANNEL_ID: 'login-channel',
    LINE_LOGIN_CHANNEL_SECRET: SECRET_SENTINEL,
    WORKER_URL: 'https://worker.example.test',
  };
}

function setupApp() {
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', users);
  app.route('/', usersGrouped);
  return app;
}

type RouteCase = {
  name: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
  successStatus: number;
};

const routeCases: RouteCase[] = [
  { name: 'list users', method: 'GET', path: '/api/users', successStatus: 200 },
  {
    name: 'create user',
    method: 'POST',
    path: '/api/users',
    body: { email: 'new@example.test', displayName: 'New User' },
    successStatus: 201,
  },
  { name: 'read user', method: 'GET', path: '/api/users/user-1', successStatus: 200 },
  {
    name: 'update user',
    method: 'PUT',
    path: '/api/users/user-1',
    body: { displayName: 'Updated User' },
    successStatus: 200,
  },
  { name: 'delete user', method: 'DELETE', path: '/api/users/user-1', successStatus: 200 },
  {
    name: 'link friend',
    method: 'POST',
    path: '/api/users/user-1/link',
    body: { friendId: 'friend-1' },
    successStatus: 200,
  },
  {
    name: 'list linked accounts',
    method: 'GET',
    path: '/api/users/user-1/accounts',
    successStatus: 200,
  },
  {
    name: 'match user PII',
    method: 'POST',
    path: '/api/users/match',
    body: { email: 'user@example.test' },
    successStatus: 200,
  },
  {
    name: 'group users across LINE accounts',
    method: 'GET',
    path: '/api/users-grouped',
    successStatus: 200,
  },
];

const mutationCases = routeCases.filter(({ method }) => method !== 'GET');

function requestInit(
  route: RouteCase,
  authorization?: string,
  cookieCsrf: 'none' | 'missing' | 'valid' = 'none',
): RequestInit {
  const headers: Record<string, string> = {};
  if (authorization) headers.Authorization = authorization;
  if (route.body) headers['Content-Type'] = 'application/json';
  if (cookieCsrf !== 'none') {
    headers.Cookie = 'lh_admin_session=owner-key; lh_csrf=csrf-token';
    if (cookieCsrf === 'valid') headers['X-CSRF-Token'] = 'csrf-token';
  }
  return {
    method: route.method,
    headers,
    body: route.body ? JSON.stringify(route.body) : undefined,
  };
}

beforeEach(() => {
  for (const mock of [...Object.values(dbMocks), ...Object.values(groupedMocks)]) {
    mock.mockReset();
  }

  dbMocks.getStaffByApiKey.mockImplementation(async (_db: unknown, token: string) => {
    return identities[token] ?? null;
  });
  dbMocks.getUsers.mockResolvedValue([fakeUser]);
  dbMocks.getUserById.mockResolvedValue(fakeUser);
  dbMocks.createUser.mockResolvedValue(fakeUser);
  dbMocks.updateUser.mockResolvedValue(fakeUser);
  dbMocks.deleteUser.mockResolvedValue(undefined);
  dbMocks.linkFriendToUser.mockResolvedValue(undefined);
  dbMocks.getUserFriends.mockResolvedValue([
    {
      id: 'friend-1',
      line_user_id: 'line-user-1',
      display_name: 'Test Friend',
      is_following: 1,
    },
  ]);
  dbMocks.getUserByEmail.mockResolvedValue(fakeUser);
  dbMocks.getUserByPhone.mockResolvedValue(null);
  groupedMocks.computeUsersGrouped.mockResolvedValue({
    total: 0,
    page: 1,
    pageSize: 50,
    rows: [],
    computedAt: '2026-07-30T00:00:00.000Z',
  });
});

describe('users API temporary role containment', () => {
  test.each(routeCases)('$name rejects unauthenticated requests with 401', async (route) => {
    const response = await setupApp().request(
      route.path,
      requestInit(route),
      bindings(),
    );

    expect(response.status).toBe(401);
    expect(routeDbMocks.every((mock) => mock.mock.calls.length === 0)).toBe(true);
  });

  test.each(routeCases)('$name rejects Staff with 403 before reading or changing PII', async (route) => {
    const response = await setupApp().request(
      route.path,
      requestInit(route, 'Bearer staff-key'),
      bindings(),
    );

    expect(response.status).toBe(403);
    expect(routeDbMocks.every((mock) => mock.mock.calls.length === 0)).toBe(true);
    expect(await response.text()).not.toContain(SECRET_SENTINEL);
  });

  test.each(['owner', 'admin'] as const)('%s keeps access to all users routes', async (role) => {
    for (const route of routeCases) {
      const response = await setupApp().request(
        route.path,
        requestInit(route, `Bearer ${role}-key`),
        bindings(),
      );

      expect(response.status, `${role} ${route.method} ${route.path}`).toBe(route.successStatus);
      expect(await response.text()).not.toContain(SECRET_SENTINEL);
    }
  });
});

describe('users API cookie CSRF enforcement', () => {
  test.each(mutationCases)('$name rejects an authenticated cookie without CSRF', async (route) => {
    const response = await setupApp().request(
      route.path,
      requestInit(route, undefined, 'missing'),
      bindings(),
    );

    expect(response.status).toBe(403);
    expect((await response.json() as { error: string }).error).toMatch(/csrf/i);
    expect(routeDbMocks.every((mock) => mock.mock.calls.length === 0)).toBe(true);
  });

  test.each(mutationCases)('$name accepts a matching double-submit CSRF token for Owner', async (route) => {
    const response = await setupApp().request(
      route.path,
      requestInit(route, undefined, 'valid'),
      bindings(),
    );

    expect(response.status).toBe(route.successStatus);
    expect(await response.text()).not.toContain(SECRET_SENTINEL);
  });
});

describe('users API secret-safe failures', () => {
  test('does not include raw DB errors or credentials in the users response or log', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    dbMocks.getUsers.mockRejectedValueOnce(new Error(`database failure: ${SECRET_SENTINEL}`));

    const response = await setupApp().request(
      '/api/users',
      { headers: { Authorization: 'Bearer owner-key' } },
      bindings(),
    );
    const responseText = await response.text();
    const logText = errorSpy.mock.calls.flat().map(String).join(' ');

    expect(response.status).toBe(500);
    expect(responseText).not.toContain(SECRET_SENTINEL);
    expect(logText).not.toContain(SECRET_SENTINEL);
    errorSpy.mockRestore();
  });

  test('does not include raw grouped-user errors or credentials in the response or log', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    groupedMocks.computeUsersGrouped.mockRejectedValueOnce(
      new Error(`grouping failure: ${SECRET_SENTINEL}`),
    );

    const response = await setupApp().request(
      '/api/users-grouped',
      { headers: { Authorization: 'Bearer admin-key' } },
      bindings(),
    );
    const responseText = await response.text();
    const logText = errorSpy.mock.calls.flat().map(String).join(' ');

    expect(response.status).toBe(500);
    expect(responseText).not.toContain(SECRET_SENTINEL);
    expect(logText).not.toContain(SECRET_SENTINEL);
    errorSpy.mockRestore();
  });
});
