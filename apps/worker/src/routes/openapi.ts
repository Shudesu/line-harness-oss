import { Hono } from 'hono';
import type { Env } from '../index.js';

const openapi = new Hono<Env>();

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'LINE OSS CRM API',
    version: '0.2.0',
    description: 'Open-source LINE Official Account CRM/marketing automation API. API-first design for Claude Code / AI agent integration.',
    license: { name: 'MIT' },
  },
  servers: [{ url: '/', description: 'Current server' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description: 'API Key passed as Bearer token',
      },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {},
          error: { type: 'string' },
        },
      },
      Friend: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          lineUserId: { type: 'string' },
          displayName: { type: 'string', nullable: true },
          pictureUrl: { type: 'string', nullable: true },
          statusMessage: { type: 'string', nullable: true },
          isFollowing: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          tags: { type: 'array', items: { $ref: '#/components/schemas/Tag' } },
        },
      },
      Tag: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          color: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Scenario: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string', nullable: true },
          triggerType: { type: 'string', enum: ['friend_add', 'tag_added', 'manual'] },
          triggerTagId: { type: 'string', nullable: true },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ScenarioStep: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          scenarioId: { type: 'string' },
          stepOrder: { type: 'integer' },
          delayMinutes: { type: 'integer' },
          messageType: { type: 'string', enum: ['text', 'image', 'flex'] },
          messageContent: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Broadcast: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          messageType: { type: 'string', enum: ['text', 'image', 'flex'] },
          messageContent: { type: 'string' },
          targetType: { type: 'string', enum: ['all', 'tag'] },
          targetTagId: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['draft', 'scheduled', 'sending', 'sent'] },
          scheduledAt: { type: 'string', nullable: true },
          sentAt: { type: 'string', nullable: true },
          totalCount: { type: 'integer' },
          successCount: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', nullable: true },
          phone: { type: 'string', nullable: true },
          externalId: { type: 'string', nullable: true },
          displayName: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      LineAccount: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          channelId: { type: 'string' },
          name: { type: 'string' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ConversionPoint: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          eventType: { type: 'string' },
          value: { type: 'number', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ConversionEvent: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          conversionPointId: { type: 'string' },
          friendId: { type: 'string' },
          userId: { type: 'string', nullable: true },
          affiliateCode: { type: 'string', nullable: true },
          metadata: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Affiliate: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          code: { type: 'string' },
          commissionRate: { type: 'number' },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      AffiliateReport: {
        type: 'object',
        properties: {
          affiliateId: { type: 'string' },
          affiliateName: { type: 'string' },
          code: { type: 'string' },
          commissionRate: { type: 'number' },
          totalClicks: { type: 'integer' },
          totalConversions: { type: 'integer' },
          totalRevenue: { type: 'number' },
        },
      },
      ReservationApiError: {
        type: 'object',
        properties: {
          success: { type: 'boolean', const: false },
          error: { type: 'string' },
          code: {
            type: 'string',
            enum: [
              'bad_request',
              'unauthorized',
              'forbidden',
              'not_found',
              'slot_not_available',
              'invalid_slot',
              'invalid_people',
              'invalid_state_transition',
              'missing_dedupe_key',
              'internal_error',
            ],
          },
          details: { type: 'object', additionalProperties: { type: 'array', items: { type: 'string' } } },
        },
        required: ['success', 'error', 'code'],
      },
      Reservation: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          lineAccountId: { type: 'string', nullable: true },
          userId: { type: 'string', nullable: true },
          friendId: { type: 'string', nullable: true },
          slotId: { type: 'string' },
          source: { type: 'string', enum: ['line', 'jalan', 'phone', 'gmail', 'admin', 'mcp'] },
          capacityChannel: { type: 'string', enum: ['line', 'external', 'manual'] },
          title: { type: 'string' },
          reservationDate: { type: 'string' },
          startAt: { type: 'string', format: 'date-time' },
          endAt: { type: 'string', format: 'date-time' },
          status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'] },
          adultCount: { type: 'integer' },
          childCount: { type: 'integer' },
          infantCount: { type: 'integer' },
          underThreeCount: { type: 'integer' },
          totalPeople: { type: 'integer' },
          capacityPeople: { type: 'integer' },
          customerName: { type: 'string', nullable: true },
          customerPhone: { type: 'string', nullable: true },
          customerEmail: { type: 'string', nullable: true },
          cancelReason: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      ReservationCreateRequest: {
        type: 'object',
        properties: {
          resourceId: { type: 'string' },
          menuId: { type: 'string' },
          slotId: { type: 'string' },
          source: { type: 'string', enum: ['line', 'jalan', 'phone', 'gmail', 'admin', 'mcp'] },
          capacityChannel: { type: 'string', enum: ['line', 'external', 'manual'] },
          adultCount: { type: 'integer', minimum: 0 },
          childCount: { type: 'integer', minimum: 0 },
          infantCount: { type: 'integer', minimum: 0 },
          underThreeCount: { type: 'integer', minimum: 0 },
          customer: {
            type: 'object',
            properties: {
              name: { type: 'string', nullable: true },
              phone: { type: 'string', nullable: true },
              email: { type: 'string', nullable: true },
            },
          },
          formData: { type: 'object' },
          metadata: { type: 'object' },
        },
        required: ['resourceId', 'menuId', 'slotId'],
      },
      ReservationStatusUpdateRequest: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'] },
          reason: { type: 'string', nullable: true },
        },
        required: ['status'],
      },
      JalanReservationImportRequest: {
        type: 'object',
        properties: {
          eventType: { type: 'string', enum: ['created', 'updated', 'cancelled', 'unknown'] },
          externalId: { type: 'string', nullable: true },
          dedupeKey: { type: 'string', nullable: true },
          gmailMessageId: { type: 'string', nullable: true },
          receivedAt: { type: 'string', format: 'date-time', nullable: true },
          rawText: { type: 'string', nullable: true },
          parsedPayload: { type: 'string' },
          resourceId: { type: 'string' },
          menuId: { type: 'string' },
          slotId: { type: 'string' },
          adultCount: { type: 'integer', minimum: 0 },
          childCount: { type: 'integer', minimum: 0 },
          infantCount: { type: 'integer', minimum: 0 },
          underThreeCount: { type: 'integer', minimum: 0 },
          customerName: { type: 'string', nullable: true },
          customerPhone: { type: 'string', nullable: true },
          customerEmail: { type: 'string', nullable: true },
        },
        required: ['eventType'],
      },
      JalanGmailImportRequest: {
        type: 'object',
        properties: {
          gmailMessageId: { type: 'string' },
          receivedAt: { type: 'string', format: 'date-time', nullable: true },
          rawText: { type: 'string' },
          resourceId: { type: 'string' },
          menuId: { type: 'string' },
          slotId: { type: 'string' },
        },
        required: ['gmailMessageId', 'rawText'],
      },
    },
  },
  paths: {
    // ── Friends ─────────────────────────────────────────────────────────────
    '/api/friends': {
      get: {
        tags: ['Friends'],
        summary: '友だち一覧取得',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
          { name: 'tagId', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Paginated friends list' } },
      },
    },
    '/api/friends/count': {
      get: { tags: ['Friends'], summary: '友だち数取得', responses: { '200': { description: 'Count' } } },
    },
    '/api/friends/{id}': {
      get: {
        tags: ['Friends'],
        summary: '友だち詳細取得',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Friend with tags' }, '404': { description: 'Not found' } },
      },
    },
    '/api/friends/{id}/tags': {
      post: {
        tags: ['Friends'],
        summary: '友だちにタグ追加',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { tagId: { type: 'string' } }, required: ['tagId'] } } } },
        responses: { '201': { description: 'Tag added' } },
      },
    },
    '/api/friends/{id}/tags/{tagId}': {
      delete: {
        tags: ['Friends'],
        summary: '友だちからタグ削除',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'tagId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Tag removed' } },
      },
    },
    // ── Tags ────────────────────────────────────────────────────────────────
    '/api/tags': {
      get: { tags: ['Tags'], summary: 'タグ一覧取得', responses: { '200': { description: 'All tags' } } },
      post: {
        tags: ['Tags'],
        summary: 'タグ作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, color: { type: 'string' } }, required: ['name'] } } } },
        responses: { '201': { description: 'Tag created' } },
      },
    },
    '/api/tags/{id}': {
      delete: {
        tags: ['Tags'],
        summary: 'タグ削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Tag deleted' } },
      },
    },
    // ── Scenarios ────────────────────────────────────────────────────────────
    '/api/scenarios': {
      get: { tags: ['Scenarios'], summary: 'シナリオ一覧取得', responses: { '200': { description: 'All scenarios' } } },
      post: {
        tags: ['Scenarios'],
        summary: 'シナリオ作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, triggerType: { type: 'string' }, description: { type: 'string' }, triggerTagId: { type: 'string' }, isActive: { type: 'boolean' } }, required: ['name', 'triggerType'] } } } },
        responses: { '201': { description: 'Scenario created' } },
      },
    },
    '/api/scenarios/{id}': {
      get: {
        tags: ['Scenarios'],
        summary: 'シナリオ詳細取得 (ステップ含む)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Scenario with steps' } },
      },
      put: {
        tags: ['Scenarios'],
        summary: 'シナリオ更新',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Scenarios'],
        summary: 'シナリオ削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/scenarios/{id}/steps': {
      post: {
        tags: ['Scenarios'],
        summary: 'ステップ追加',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Step created' } },
      },
    },
    '/api/scenarios/{id}/steps/{stepId}': {
      put: {
        tags: ['Scenarios'],
        summary: 'ステップ更新',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'stepId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Scenarios'],
        summary: 'ステップ削除',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'stepId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/scenarios/{id}/enroll/{friendId}': {
      post: {
        tags: ['Scenarios'],
        summary: '手動エンロール',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'friendId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '201': { description: 'Enrolled' } },
      },
    },
    // ── Broadcasts ───────────────────────────────────────────────────────────
    '/api/broadcasts': {
      get: { tags: ['Broadcasts'], summary: '配信一覧取得', responses: { '200': { description: 'All broadcasts' } } },
      post: {
        tags: ['Broadcasts'],
        summary: '配信作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { title: { type: 'string' }, messageType: { type: 'string' }, messageContent: { type: 'string' }, targetType: { type: 'string' }, targetTagId: { type: 'string' }, scheduledAt: { type: 'string' } }, required: ['title', 'messageType', 'messageContent', 'targetType'] } } } },
        responses: { '201': { description: 'Broadcast created' } },
      },
    },
    '/api/broadcasts/{id}': {
      get: {
        tags: ['Broadcasts'],
        summary: '配信詳細取得',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Broadcast' } },
      },
      put: { tags: ['Broadcasts'], summary: '配信更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Broadcasts'], summary: '配信削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/broadcasts/{id}/send': {
      post: {
        tags: ['Broadcasts'],
        summary: '即時配信',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Sent' } },
      },
    },
    // ── Users (UUID Cross-Account) ──────────────────────────────────────────
    '/api/users': {
      get: { tags: ['Users'], summary: '内部ユーザー一覧取得', responses: { '200': { description: 'All users' } } },
      post: {
        tags: ['Users'],
        summary: '内部ユーザー作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, phone: { type: 'string' }, externalId: { type: 'string' }, displayName: { type: 'string' } } } } } },
        responses: { '201': { description: 'User created' } },
      },
    },
    '/api/users/match': {
      post: {
        tags: ['Users'],
        summary: 'メール/電話でユーザー検索',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { email: { type: 'string' }, phone: { type: 'string' } } } } } },
        responses: { '200': { description: 'Matched user' }, '404': { description: 'Not found' } },
      },
    },
    '/api/users/{id}': {
      get: { tags: ['Users'], summary: 'ユーザー詳細取得', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'User' } } },
      put: { tags: ['Users'], summary: 'ユーザー更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Users'], summary: 'ユーザー削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/users/{id}/link': {
      post: {
        tags: ['Users'],
        summary: '友だちをUUIDにリンク',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { friendId: { type: 'string' } }, required: ['friendId'] } } } },
        responses: { '200': { description: 'Linked' } },
      },
    },
    '/api/users/{id}/accounts': {
      get: {
        tags: ['Users'],
        summary: 'UUID紐付き友だち一覧',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Linked friends/accounts' } },
      },
    },
    // ── LINE Accounts ───────────────────────────────────────────────────────
    '/api/line-accounts': {
      get: { tags: ['LINE Accounts'], summary: 'LINEアカウント一覧', responses: { '200': { description: 'All LINE accounts' } } },
      post: {
        tags: ['LINE Accounts'],
        summary: 'LINEアカウント登録',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { channelId: { type: 'string' }, name: { type: 'string' }, channelAccessToken: { type: 'string' }, channelSecret: { type: 'string' } }, required: ['channelId', 'name', 'channelAccessToken', 'channelSecret'] } } } },
        responses: { '201': { description: 'Account created' } },
      },
    },
    '/api/line-accounts/{id}': {
      get: { tags: ['LINE Accounts'], summary: 'LINEアカウント詳細', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Account' } } },
      put: { tags: ['LINE Accounts'], summary: 'LINEアカウント更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['LINE Accounts'], summary: 'LINEアカウント削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    // ── Conversions ─────────────────────────────────────────────────────────
    '/api/conversions/points': {
      get: { tags: ['Conversions'], summary: 'CV ポイント一覧', responses: { '200': { description: 'All conversion points' } } },
      post: {
        tags: ['Conversions'],
        summary: 'CV ポイント作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, eventType: { type: 'string' }, value: { type: 'number' } }, required: ['name', 'eventType'] } } } },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/conversions/points/{id}': {
      delete: {
        tags: ['Conversions'],
        summary: 'CV ポイント削除',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/conversions/track': {
      post: {
        tags: ['Conversions'],
        summary: 'コンバージョン記録',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { conversionPointId: { type: 'string' }, friendId: { type: 'string' }, userId: { type: 'string' }, affiliateCode: { type: 'string' }, metadata: { type: 'object' } }, required: ['conversionPointId', 'friendId'] } } } },
        responses: { '201': { description: 'Tracked' } },
      },
    },
    '/api/conversions/events': {
      get: {
        tags: ['Conversions'],
        summary: 'CV イベント一覧',
        parameters: [
          { name: 'conversionPointId', in: 'query', schema: { type: 'string' } },
          { name: 'friendId', in: 'query', schema: { type: 'string' } },
          { name: 'affiliateCode', in: 'query', schema: { type: 'string' } },
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Events' } },
      },
    },
    '/api/conversions/report': {
      get: {
        tags: ['Conversions'],
        summary: 'CV レポート',
        parameters: [
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Aggregated report' } },
      },
    },
    // ── Affiliates ──────────────────────────────────────────────────────────
    '/api/affiliates': {
      get: { tags: ['Affiliates'], summary: 'アフィリエイト一覧', responses: { '200': { description: 'All affiliates' } } },
      post: {
        tags: ['Affiliates'],
        summary: 'アフィリエイト作成',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' }, code: { type: 'string' }, commissionRate: { type: 'number' } }, required: ['name', 'code'] } } } },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/affiliates/{id}': {
      get: { tags: ['Affiliates'], summary: 'アフィリエイト詳細', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Affiliate' } } },
      put: { tags: ['Affiliates'], summary: 'アフィリエイト更新', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Updated' } } },
      delete: { tags: ['Affiliates'], summary: 'アフィリエイト削除', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { '200': { description: 'Deleted' } } },
    },
    '/api/affiliates/{id}/report': {
      get: {
        tags: ['Affiliates'],
        summary: 'アフィリエイトレポート',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'startDate', in: 'query', schema: { type: 'string' } },
          { name: 'endDate', in: 'query', schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Report' } },
      },
    },
    '/api/affiliates/click': {
      post: {
        tags: ['Affiliates'],
        summary: 'クリック記録',
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { code: { type: 'string' }, url: { type: 'string' } }, required: ['code'] } } } },
        responses: { '201': { description: 'Recorded' } },
      },
    },
    // ── Reservations ───────────────────────────────────────────────────────
    '/api/public/reservation-session': {
      post: {
        tags: ['Reservations'],
        summary: 'LIFF ID tokenから予約用セッショントークンを発行',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  idToken: { type: 'string' },
                  displayName: { type: 'string', nullable: true },
                },
                required: ['idToken'],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Session token issued' },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
          '401': { description: 'Invalid LINE ID token', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
        },
      },
    },
    '/api/public/reservation-resources/{resourceId}/slots': {
      get: {
        tags: ['Reservations'],
        summary: '公開予約枠一覧',
        security: [],
        parameters: [
          { name: 'resourceId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'date', in: 'query', required: true, schema: { type: 'string', format: 'date' } },
          { name: 'people', in: 'query', schema: { type: 'integer', default: 1 } },
        ],
        responses: {
          '200': { description: 'Available slots' },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
        },
      },
    },
    '/api/public/reservations': {
      post: {
        tags: ['Reservations'],
        summary: '公開予約作成',
        description: 'Authorization: Bearer LIFF_SESSION_TOKEN が必要。lineUserId直指定は信用しない。',
        security: [],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationCreateRequest' } } } },
        responses: {
          '201': { description: 'Created reservation with detailToken/cancelToken' },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
          '409': { description: 'Slot not available', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
        },
      },
    },
    '/api/public/reservations/{id}/tokens': {
      post: {
        tags: ['Reservations'],
        summary: '公開予約の詳細/キャンセルtoken再発行',
        description: 'Authorization: Bearer LIFF_SESSION_TOKEN が必要。本人の予約だけに detailToken / cancelToken を再発行する。',
        security: [],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Re-issued detailToken/cancelToken' },
          '401': { description: 'Unauthorized', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
          '403': { description: 'Forbidden', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
          '404': { description: 'Reservation not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
        },
      },
    },
    '/api/reservations': {
      get: {
        tags: ['Reservations'],
        summary: '管理者向け予約一覧',
        parameters: [
          { name: 'date', in: 'query', schema: { type: 'string', format: 'date' } },
          { name: 'slotId', in: 'query', schema: { type: 'string' } },
          { name: 'userId', in: 'query', schema: { type: 'string' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'] } },
          { name: 'source', in: 'query', schema: { type: 'string', enum: ['line', 'jalan', 'phone', 'gmail', 'admin', 'mcp'] } },
        ],
        responses: { '200': { description: 'Reservations list' } },
      },
      post: {
        tags: ['Reservations'],
        summary: '管理者向け予約作成',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationCreateRequest' } } } },
        responses: {
          '201': { description: 'Created reservation' },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
          '409': { description: 'Slot not available', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
        },
      },
    },
    '/api/reservations/{id}/status': {
      put: {
        tags: ['Reservations'],
        summary: '予約状態変更',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationStatusUpdateRequest' } } } },
        responses: {
          '200': { description: 'Updated reservation status' },
          '404': { description: 'Not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
          '409': { description: 'Invalid state transition', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
        },
      },
    },
	    '/api/integrations/jalan/reservations/import': {
      post: {
        tags: ['Reservations'],
        summary: 'じゃらん/Gmail予約メール取り込み',
        description: 'createdは冪等作成、updatedは自動反映せずneeds_review、cancelledは状態遷移表に従ってキャンセルする。',
        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/JalanReservationImportRequest' } } } },
        responses: {
          '200': { description: 'Imported, duplicate, or cancelled' },
          '202': { description: 'Needs manual review' },
          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
          '409': { description: 'Slot not available', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
	    },
	    '/api/integrations/jalan/gmail/import': {
	      post: {
	        tags: ['Reservations'],
	        summary: 'Gmail raw本文からじゃらん予約メールを取り込み',
	        description: 'GASからgmailMessageIdとrawTextを受け取り、Worker側で本文を解析する。createdはslot/menuが揃う場合だけ予約作成し、updatedはneeds_reviewにする。',
	        requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/JalanGmailImportRequest' } } } },
	        responses: {
	          '200': { description: 'Imported, duplicate, or cancelled' },
	          '202': { description: 'Needs manual review' },
	          '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
	          '409': { description: 'Slot not available', content: { 'application/json': { schema: { $ref: '#/components/schemas/ReservationApiError' } } } },
	        },
	      },
	    },
      },
    },
    // ── Webhook ─────────────────────────────────────────────────────────────
    '/webhook': {
      post: {
        tags: ['Webhook'],
        summary: 'LINE Messaging API Webhook',
        description: 'LINE プラットフォームからのWebhookイベントを受信。署名検証あり、常に200を返す。',
        security: [],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  tags: [
    { name: 'Friends', description: '友だち管理' },
    { name: 'Tags', description: 'タグ管理' },
    { name: 'Scenarios', description: 'ステップ配信シナリオ' },
    { name: 'Broadcasts', description: '一斉配信' },
    { name: 'Users', description: 'UUID Cross-Account ユーザー管理' },
    { name: 'LINE Accounts', description: 'マルチLINEアカウント管理' },
    { name: 'Conversions', description: 'コンバージョン計測' },
    { name: 'Affiliates', description: 'アフィリエイト管理' },
    { name: 'Reservations', description: '予約DB、LIFF予約、外部予約取り込み' },
    { name: 'Webhook', description: 'LINE Webhook' },
  ],
};

// GET /openapi.json - raw spec
openapi.get('/openapi.json', (c) => {
  return c.json(spec);
});

// GET /docs - Swagger UI
openapi.get('/docs', (c) => {
  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LINE CRM API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/openapi.json',
      dom_id: '#swagger-ui',
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
    });
  </script>
</body>
</html>`;
  return c.html(html);
});

export { openapi };
