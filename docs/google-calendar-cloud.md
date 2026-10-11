# Google Calendar connections

Self-hosted installations can continue using their own `GOOGLE_OAUTH_CLIENT_ID`
and `GOOGLE_OAUTH_CLIENT_SECRET`, or their existing service-account configuration.
The direct OAuth configuration takes priority when both direct and managed
configuration are supplied.

Managed deployments can instead configure `GOOGLE_CALENDAR_BROKER_URL`,
`GOOGLE_CALENDAR_TENANT_ID`, and the tenant-specific secret
`GOOGLE_CALENDAR_BROKER_SECRET`. These are operator settings; customers connect
by granting Google consent and do not need to obtain or send a private key.
A broker must implement the authenticated `/calendar/oauth/tenant/{status,start,token}`
protocol. This repository supplies the tenant client, not a standalone broker server.

Managed callbacks require signed state, a short-lived browser-bound cookie, and
one-time ticket redemption. Access-token refresh and revocation go through the
broker. Redirect responses are rejected without forwarding credentials; the
transport uses the `manual` redirect mode supported by Cloudflare Workers.
If managed configuration is unavailable, the console directs customers to the
operator instead of requesting a service-account key.

After connecting, save weekly working hours. Confirm a test reservation, verify
its event in Google Calendar, and verify that overlapping times disappear from
availability. A failed calendar availability request must not offer unchecked
slots. These checks are distinct from merely completing the Google consent page.
