# Kuchikomi Robo™ integration

This integration is backend-only for now. It does not add dashboard UI. LINE
Harness can deliver a review-request payload to a Kuchikomi Robo™ webhook/API
endpoint, and automations can trigger that delivery with a dedicated action.

Public Kuchikomi Robo™ API documentation was not available when this adapter
was added, so the adapter is intentionally small and configuration-driven:
replace the endpoint/credentials without changing the admin login model or the
generic webhook foundation.

## Environment variables

Set these on the Worker:

| Variable | Required | Purpose |
|----------|----------|---------|
| `KUCHIKOMI_ROBO_WEBHOOK_URL` | yes | HTTPS endpoint that receives review-request payloads. |
| `KUCHIKOMI_ROBO_API_KEY` | no | Sent as `Authorization: Bearer <token>` when configured. |
| `KUCHIKOMI_ROBO_SHARED_SECRET` | no | HMAC-SHA256 signing key. Adds `X-Webhook-Signature` and `X-Line-Harness-Signature`. |
| `KUCHIKOMI_ROBO_STORE_ID` | no | Default store/location identifier. |

Keep these separate from `API_KEY`. The admin dashboard login remains
email/password + HttpOnly Cookie; API keys are still for machine callers only.

## Authenticated API

`POST /api/integrations/kuchikomi-robo/review-request`

This endpoint is protected by the existing `/api/*` auth middleware, so callers
must use a Bearer token or an authenticated admin cookie session.

Request body:

```json
{
  "friendId": "friend_uuid",
  "storeId": "optional-store-override",
  "trigger": "booking_completed",
  "visitAt": "2026-06-22T13:00:00+09:00",
  "reviewUrl": "https://g.page/r/example/review",
  "metadata": {
    "bookingId": "booking_uuid"
  }
}
```

You may also send a direct customer object instead of `friendId`:

```json
{
  "customer": {
    "lineUserId": "Uxxxxxxxx",
    "displayName": "山田 太郎",
    "phone": "09000000000",
    "email": "customer@example.com"
  },
  "trigger": "manual"
}
```

Delivery payload sent to Kuchikomi Robo™:

```json
{
  "source": "line-harness",
  "event": "review_request",
  "timestamp": "2026-06-22T13:00:00.000+09:00",
  "storeId": "store-id",
  "customer": {
    "friendId": "friend_uuid",
    "lineUserId": "Uxxxxxxxx",
    "displayName": "山田 太郎",
    "phone": "09000000000",
    "email": "customer@example.com"
  },
  "context": {
    "trigger": "booking_completed",
    "visitAt": "2026-06-22T13:00:00+09:00",
    "reviewUrl": "https://g.page/r/example/review",
    "lineAccountId": "line_account_uuid",
    "metadata": {
      "bookingId": "booking_uuid"
    }
  }
}
```

## Automation action

Automations can trigger the same adapter without adding UI by storing an action
of type `send_kuchikomi_robo`:

```json
[
  {
    "type": "send_kuchikomi_robo",
    "params": {
      "trigger": "booking_completed",
      "storeId": "optional-store-override",
      "reviewUrl": "https://g.page/r/example/review"
    }
  }
]
```

The action uses Worker environment variables for credentials. Do not store API
keys or HMAC secrets in automation JSON.

## Status check

`GET /api/integrations/kuchikomi-robo/status`

Returns booleans for configured credentials without exposing secret values.

