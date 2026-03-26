import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  getProfileByFriendId,
  createProfile,
  updateProfile,
  getDocumentsByFriendId,
  createDocument,
  updateDocumentStatus,
  getAllPendingDocuments,
  getFavoritesByFriendId,
  addFavoriteNursery,
  removeFavoriteNursery,
} from '@line-crm/db';
import { assertOwnFriendId } from '../middleware/liff-auth.js';

const profiles = new Hono<Env>();

// ========== プロフィール取得（LIFF: 自分のデータのみ） ==========

profiles.get('/api/profiles/:friendId', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    // LIFF認証時は自分のデータのみアクセス可能
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
    const profile = await getProfileByFriendId(c.env.DB, friendId);
    const documents = await getDocumentsByFriendId(c.env.DB, friendId);
    return c.json({ success: true, data: { profile, documents } });
  } catch (err) {
    console.error('GET /api/profiles/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== プロフィール作成（公開: LIFF用） ==========

profiles.post('/api/profiles', async (c) => {
  try {
    const body = await c.req.json<{
      friendId: string;
      realName: string;
      realNameKana?: string;
      phone?: string;
      qualificationType?: string;
      dateOfBirth?: string;
      gender?: string;
      allergiesMedical?: string;
      experienceYears?: string;
      bacterialTestStatus?: string;
      healthNotes?: string;
      termsAgreedAt?: string;
    }>();

    if (!body.friendId || !body.realName) {
      return c.json({ success: false, error: 'friendId and realName are required' }, 400);
    }

    // LIFF認証時は自分のデータのみ作成可能
    if (c.get('liffFriendId') && !assertOwnFriendId(c, body.friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    // friendsテーブルに存在するか確認（FK制約対策）
    const friend = await c.env.DB
      .prepare('SELECT id FROM friends WHERE id = ?')
      .bind(body.friendId)
      .first<{ id: string }>();
    if (!friend) {
      return c.json({ success: false, error: 'ユーザー情報が見つかりません。LINEアプリから再度開いてください。' }, 400);
    }

    // 既存チェック
    const existing = await getProfileByFriendId(c.env.DB, body.friendId);
    if (existing) {
      // 既存がある場合は更新
      const updated = await updateProfile(c.env.DB, body.friendId, {
        realName: body.realName,
        realNameKana: body.realNameKana,
        phone: body.phone,
        qualificationType: body.qualificationType,
        dateOfBirth: body.dateOfBirth,
        gender: body.gender,
        allergiesMedical: body.allergiesMedical,
        experienceYears: body.experienceYears,
        bacterialTestStatus: body.bacterialTestStatus,
        healthNotes: body.healthNotes,
        termsAgreedAt: body.termsAgreedAt,
      });
      return c.json({ success: true, data: updated });
    }

    const profile = await createProfile(c.env.DB, body);
    return c.json({ success: true, data: profile }, 201);
  } catch (err) {
    console.error('POST /api/profiles error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== プロフィール更新（公開: LIFF用） ==========

profiles.put('/api/profiles/:friendId', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    // LIFF認証時は自分のデータのみ更新可能
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
    const body = await c.req.json<{
      realName?: string;
      realNameKana?: string;
      phone?: string;
      qualificationType?: string;
      dateOfBirth?: string;
      gender?: string;
      allergiesMedical?: string;
      experienceYears?: string;
      bacterialTestStatus?: string;
      healthNotes?: string;
      termsAgreedAt?: string;
    }>();

    const updated = await updateProfile(c.env.DB, friendId, body);
    if (!updated) return c.json({ success: false, error: 'Profile not found' }, 404);
    return c.json({ success: true, data: updated });
  } catch (err) {
    console.error('PUT /api/profiles/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 書類アップロード（公開: LIFF用 → R2保存） ==========

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
const MIME_TO_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_DOC_TYPES = ['id_card', 'qualification_cert'] as const;

profiles.post('/api/documents/upload', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';

    if (contentType.includes('application/json')) {
      // Base64 JSON upload
      const body = await c.req.json<{
        friendId: string;
        docType: string;
        fileName?: string;
        image: string; // base64
        contentType?: string;
      }>();

      if (!body.friendId || !body.docType || !body.image) {
        return c.json({ success: false, error: 'friendId, docType, and image are required' }, 400);
      }

      // LIFF認証時は自分のデータのみアップロード可能
      if (c.get('liffFriendId') && !assertOwnFriendId(c, body.friendId)) {
        return c.json({ success: false, error: 'Access denied' }, 403);
      }

      // Validate docType
      if (!ALLOWED_DOC_TYPES.includes(body.docType as typeof ALLOWED_DOC_TYPES[number])) {
        return c.json({ success: false, error: 'Invalid docType. Must be id_card or qualification_cert' }, 400);
      }

      // Validate MIME type
      const fileMime = body.contentType || 'image/jpeg';
      if (!ALLOWED_MIME_TYPES.includes(fileMime as typeof ALLOWED_MIME_TYPES[number])) {
        return c.json({ success: false, error: 'Invalid file type. Allowed: JPEG, PNG, PDF' }, 400);
      }

      // Validate file size (base64 is ~4/3 of binary size)
      const base64Data = body.image.replace(/^data:[^;]+;base64,/, '');
      const estimatedSize = Math.ceil(base64Data.length * 3 / 4);
      if (estimatedSize > MAX_FILE_SIZE) {
        return c.json({ success: false, error: 'File too large. Maximum 5MB' }, 400);
      }

      const ext = MIME_TO_EXT[fileMime] || 'jpg';
      const r2Key = `documents/${body.friendId}/${body.docType}_${Date.now()}.${ext}`;

      // R2 upload (if available)
      const r2 = (c.env as unknown as { DOCUMENTS?: R2Bucket }).DOCUMENTS;
      if (r2) {
        const binaryData = Uint8Array.from(atob(base64Data), (ch) => ch.charCodeAt(0));
        await r2.put(r2Key, binaryData, {
          httpMetadata: { contentType: fileMime },
        });
      }
      // R2未設定時はメタデータのみ保存（テスト環境用）

      const doc = await createDocument(c.env.DB, {
        friendId: body.friendId,
        docType: body.docType,
        r2Key,
        fileName: body.fileName,
      });

      return c.json({ success: true, data: doc }, 201);
    }

    // Multipart upload
    const formData = await c.req.formData();
    const friendId = formData.get('friendId') as string;
    const docType = formData.get('docType') as string;
    const file = formData.get('file') as File;

    if (!friendId || !docType || !file) {
      return c.json({ success: false, error: 'friendId, docType, and file are required' }, 400);
    }

    // LIFF認証時は自分のデータのみアップロード可能
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    // Validate docType
    if (!ALLOWED_DOC_TYPES.includes(docType as typeof ALLOWED_DOC_TYPES[number])) {
      return c.json({ success: false, error: 'Invalid docType. Must be id_card or qualification_cert' }, 400);
    }

    // Validate MIME type
    const fileMime = file.type || 'image/jpeg';
    if (!ALLOWED_MIME_TYPES.includes(fileMime as typeof ALLOWED_MIME_TYPES[number])) {
      return c.json({ success: false, error: 'Invalid file type. Allowed: JPEG, PNG, PDF' }, 400);
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return c.json({ success: false, error: 'File too large. Maximum 5MB' }, 400);
    }

    const ext = MIME_TO_EXT[fileMime] || 'jpg';
    const r2Key = `documents/${friendId}/${docType}_${Date.now()}.${ext}`;

    const r2 = (c.env as unknown as { DOCUMENTS?: R2Bucket }).DOCUMENTS;
    if (r2) {
      await r2.put(r2Key, await file.arrayBuffer(), {
        httpMetadata: { contentType: fileMime },
      });
    }

    const doc = await createDocument(c.env.DB, {
      friendId,
      docType,
      r2Key,
      fileName: file.name,
    });

    return c.json({ success: true, data: doc }, 201);
  } catch (err) {
    console.error('POST /api/documents/upload error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 書類一覧取得 ==========

profiles.get('/api/documents/:friendId', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    // LIFF認証時は自分のデータのみ
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
    const docs = await getDocumentsByFriendId(c.env.DB, friendId);
    return c.json({ success: true, data: docs });
  } catch (err) {
    console.error('GET /api/documents/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 書類管理（管理者向け・認証必須） ==========

// 全書類一覧（ステータス別）
profiles.get('/api/documents', async (c) => {
  try {
    const docs = await getAllPendingDocuments(c.env.DB);
    return c.json({ success: true, data: docs });
  } catch (err) {
    console.error('GET /api/documents error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 書類ステータス更新（verified / rejected）
profiles.put('/api/documents/:docId/status', async (c) => {
  try {
    const docId = c.req.param('docId');
    const body = await c.req.json<{ status: string }>();
    if (!body.status || !['verified', 'rejected'].includes(body.status)) {
      return c.json({ success: false, error: 'status must be verified or rejected' }, 400);
    }
    const doc = await updateDocumentStatus(c.env.DB, docId, body.status as 'verified' | 'rejected');
    if (!doc) return c.json({ success: false, error: 'Document not found' }, 404);
    return c.json({ success: true, data: doc });
  } catch (err) {
    console.error('PUT /api/documents/:docId/status error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 書類画像取得（R2から署名付きで返却）
profiles.get('/api/documents/file/:docId', async (c) => {
  try {
    const docId = c.req.param('docId');
    const doc = await c.env.DB.prepare('SELECT * FROM user_documents WHERE id = ?').bind(docId).first<{ r2_key: string }>();
    if (!doc) return c.json({ success: false, error: 'Document not found' }, 404);

    const r2 = (c.env as unknown as { DOCUMENTS?: R2Bucket }).DOCUMENTS;
    if (!r2) {
      return c.json({ success: false, error: 'R2 not configured. Enable R2 for document viewing.' }, 503);
    }

    const obj = await r2.get(doc.r2_key);
    if (!obj) return c.json({ success: false, error: 'File not found in storage' }, 404);

    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType || 'image/jpeg');
    headers.set('Cache-Control', 'private, max-age=300');
    return new Response(obj.body, { headers });
  } catch (err) {
    console.error('GET /api/documents/file/:docId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== お気に入り園 ==========

profiles.get('/api/favorites/:friendId', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
    const favorites = await getFavoritesByFriendId(c.env.DB, friendId);
    return c.json({ success: true, data: favorites });
  } catch (err) {
    console.error('GET /api/favorites/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

profiles.post('/api/favorites', async (c) => {
  try {
    const body = await c.req.json<{ friendId: string; nurseryName: string }>();
    if (!body.friendId || !body.nurseryName) {
      return c.json({ success: false, error: 'friendId and nurseryName are required' }, 400);
    }
    if (c.get('liffFriendId') && !assertOwnFriendId(c, body.friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
    const fav = await addFavoriteNursery(c.env.DB, body.friendId, body.nurseryName);
    return c.json({ success: true, data: fav }, 201);
  } catch (err) {
    console.error('POST /api/favorites error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

profiles.delete('/api/favorites/:friendId/:nurseryName', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
    const nurseryName = decodeURIComponent(c.req.param('nurseryName'));
    await removeFavoriteNursery(c.env.DB, friendId, nurseryName);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/favorites error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { profiles };
