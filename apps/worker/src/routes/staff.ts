import { Hono } from 'hono';
import {
  getStaffMembers,
  getStaffById,
  createStaffMember,
  updateStaffMember,
  deleteStaffMember,
  regenerateStaffApiKey,
  countActiveStaffByRole,
} from '@line-crm/db';
import type { StaffMember } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const staff = new Hono<Env>();

function maskApiKey(key: string): string {
  return `lh_****${key.slice(-4)}`;
}

function serializeStaff(row: StaffMember, masked = true) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    apiKey: masked ? maskApiKey(row.api_key) : row.api_key,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/staff/me — any authenticated user (MUST be before /:id)
staff.get('/api/staff/me', async (c) => {
  try {
    const currentStaff = c.get('staff');

    // env-owner: return minimal info
    if (currentStaff.id === 'env-owner') {
      return c.json({
        success: true,
        data: {
          id: 'env-owner',
          name: 'Owner',
          role: 'owner',
          email: null,
        },
      });
    }

    const member = await getStaffById(c.env.DB, currentStaff.id);
    if (!member) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }

    return c.json({
      success: true,
      data: {
        id: member.id,
        name: member.name,
        role: member.role,
        email: member.email,
      },
    });
  } catch (err) {
    console.error('GET /api/staff/me error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/staff — owner only. List all staff with masked API keys.
staff.get('/api/staff', requireRole('owner'), async (c) => {
  try {
    const members = await getStaffMembers(c.env.DB);
    return c.json({ success: true, data: members.map((m) => serializeStaff(m, true)) });
  } catch (err) {
    console.error('GET /api/staff error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/staff/:id — owner only. Get staff detail with masked key.
staff.get('/api/staff/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const member = await getStaffById(c.env.DB, id);
    if (!member) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }
    return c.json({ success: true, data: serializeStaff(member, true) });
  } catch (err) {
    console.error('GET /api/staff/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/staff — owner only. Create staff. Returns full API key (one-time visible).
staff.post('/api/staff', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{ name: string; email?: string; role: string }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const validRoles = ['owner', 'admin', 'staff'] as const;
    if (!body.role || !validRoles.includes(body.role as (typeof validRoles)[number])) {
      return c.json({ success: false, error: 'role must be owner, admin, or staff' }, 400);
    }

    const member = await createStaffMember(c.env.DB, {
      name: body.name,
      email: body.email ?? null,
      role: body.role as 'owner' | 'admin' | 'staff',
    });

    // Return full (unmasked) API key one-time
    return c.json({ success: true, data: serializeStaff(member, false) }, 201);
  } catch (err) {
    console.error('POST /api/staff error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/staff/:id — owner only. Update staff.
staff.patch('/api/staff/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{
      name?: string;
      email?: string | null;
      role?: string;
      isActive?: boolean;
    }>();

    const validRoles = ['owner', 'admin', 'staff'] as const;
    if (body.role !== undefined && !validRoles.includes(body.role as (typeof validRoles)[number])) {
      return c.json({ success: false, error: 'role must be owner, admin, or staff' }, 400);
    }

    // Prevent removing the last active owner
    const target = await getStaffById(c.env.DB, id);
    if (!target) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }
    if (target.role === 'owner' && target.is_active === 1) {
      const willLoseOwner =
        (body.role !== undefined && body.role !== 'owner') ||
        body.isActive === false;
      if (willLoseOwner) {
        const ownerCount = await countActiveStaffByRole(c.env.DB, 'owner');
        if (ownerCount <= 1) {
          return c.json({ success: false, error: 'オーナーは最低1人必要です' }, 400);
        }
      }
    }

    const updated = await updateStaffMember(c.env.DB, id, {
      name: body.name,
      email: body.email,
      role: body.role as 'owner' | 'admin' | 'staff' | undefined,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }

    return c.json({ success: true, data: serializeStaff(updated, true) });
  } catch (err) {
    console.error('PATCH /api/staff/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/staff/:id — owner only. Cannot delete self. Must keep at least 1 owner.
staff.delete('/api/staff/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const currentStaff = c.get('staff');

    if (id === currentStaff.id) {
      return c.json({ success: false, error: '自分自身は削除できません' }, 400);
    }

    const target = await getStaffById(c.env.DB, id);
    if (!target) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }

    if (target.role === 'owner' && target.is_active === 1) {
      const ownerCount = await countActiveStaffByRole(c.env.DB, 'owner');
      if (ownerCount <= 1) {
        return c.json({ success: false, error: 'オーナーは最低1人必要です' }, 400);
      }
    }

    await deleteStaffMember(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/staff/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/staff/:id/regenerate-key — owner only. Return new API key.
staff.post('/api/staff/:id/regenerate-key', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const exists = await getStaffById(c.env.DB, id);
    if (!exists) {
      return c.json({ success: false, error: 'Staff member not found' }, 404);
    }
    const newKey = await regenerateStaffApiKey(c.env.DB, id);
    return c.json({ success: true, data: { apiKey: newKey } });
  } catch (err) {
    console.error('POST /api/staff/:id/regenerate-key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { staff };
