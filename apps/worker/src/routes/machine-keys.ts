import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { requireRole } from '../middleware/role-guard.js';
import {
  createMachineKey,
  listMachineKeys,
  revokeMachineKey,
  parseMachineScopes,
} from '@line-crm/db';
import type { Env } from '../index.js';
const app = createAuthorizedRouter<Env>();
app.use('/api/machine-keys/*', requireRole('owner', 'admin'));
app.use('/api/machine-keys', requireRole('owner', 'admin'));
app.get('/api/machine-keys', async (c) =>
  c.json({
    success: true,
    data: await listMachineKeys(
      c.env.DB,
      50,
      Number(c.req.query('offset') || 0) || 0,
    ),
  }),
);
app.post('/api/machine-keys', async (c) => {
  if(c.env.SECURITY_MIGRATION_STAGE==='compat')return c.json({error:'Key issuance not active during compatibility rollout'},503);
  const body = await c.req.json().catch(() => null);
  const scopes = parseMachineScopes(body?.scopes);
  const now = Math.floor(Date.now() / 1000);
  const expiresAt =
    body?.expiresAt === undefined ? now + 90 * 86400 : body.expiresAt;
  if (
    typeof body?.name !== 'string' ||
    !body.name.trim() ||
    body.name.length > 100 ||
    !scopes ||
    (expiresAt !== null &&
      (!Number.isSafeInteger(expiresAt) || expiresAt <= now))
  )
    return c.json(
      { success: false, error: 'Invalid name, scopes or expiry' },
      400,
    );
  const staff = c.get('staff');
  const result = await createMachineKey(c.env.DB, {
    name: body.name,
    scopes,
    expiresAt,
    createdBy: staff.id === 'env-owner' ? null : staff.id,
  });
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data: result }, 201);
});
app.delete('/api/machine-keys/:id', async (c) => {
  await revokeMachineKey(c.env.DB, c.req.param('id'));
  return c.json({ success: true });
});
export default app;
