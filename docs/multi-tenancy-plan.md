# Multi-tenancy & billing architecture plan

> Status: parked — not yet implemented. Pick this up when starting paid tier work.

## Goals

- Organizations own and manage multiple inboxes
- Per-org quota enforcement at receive time
- Metering and billing via Stripe usage-based billing
- Per-inbox spam policy (replaces the current binary drop-on-FAIL behavior)

## Core entities

### Org
The billable unit. One Stripe customer per org.

| Field            | Type   | Notes                              |
|------------------|--------|------------------------------------|
| org_id           | string | PK — UUID                          |
| name             | string |                                    |
| plan             | string | `free` \| `pro` \| `enterprise`    |
| stripe_customer  | string | Stripe customer ID                 |
| inbox_quota      | number | Max active inboxes allowed         |
| msg_quota        | number | Max messages/month                 |
| created_at       | string | ISO 8601                           |

### Inbox
Owned by an org. The token is the PK — the receive Lambda looks this up to get org_id and policies.

| Field        | Type   | Notes                                      |
|--------------|--------|--------------------------------------------|
| token        | string | PK — UUID (same token used in email address) |
| org_id       | string | FK → Org                                   |
| label        | string | Human-readable name (optional)             |
| spam_policy  | string | `strict` (drop FAIL) \| `allow` (store FAIL with metadata) |
| ttl_override | number | Custom TTL in seconds (paid tier override) |
| created_at   | string | ISO 8601                                   |
| expires_at   | string | ISO 8601 — inbox itself expires            |

### Message (updated)
Add `org_id` to the existing schema for metering queries.

| Field      | Notes                                  |
|------------|----------------------------------------|
| org_id     | Added — enables GSI for org-level queries |
| spam_verdicts | Added (optional) — stored when `spam_policy = "allow"`: `{spam, virus, spf, dkim, dmarc}` statuses |

### GSI: MessagesByOrg
- PK: `org_id`
- SK: `receivedAt`
- Use: "all messages for org X in last 30 days" — for metering and billing reconciliation

### Usage (counters)
DynamoDB atomic counters for real-time quota enforcement (not billing source of truth — Stripe is).

| Field        | Notes                              |
|--------------|------------------------------------|
| pk           | `USAGE#{org_id}#{YYYY-MM}`         |
| msg_count    | Atomic counter, incremented on store |
| inbox_count  | Maintained on inbox create/delete  |

## Updated receive path

```
inbound email → SES receipt rule
  → S3 (raw)
  → Lambda receive.handler
      → lookup token in Inboxes table
          → not found: drop (closes "store mail for any UUID" gap)
          → found: get org_id + spam_policy
      → check spam/virus verdicts against spam_policy
          → strict (default): drop on FAIL
          → allow: store with spam_verdicts metadata
      → check org quota (Usage table)
          → over limit: drop, log
      → store message (with org_id)
      → increment Usage counter
      → push Stripe meter event (org's stripe_customer, quantity=1)
```

## Stripe metering

Push one meter event per stored message at receive time:

```ts
await stripe.billing.meterEvents.create({
  event_name: 'email_received',
  payload: { stripe_customer_id: org.stripe_customer, value: '1' },
});
```

Stripe is the billing source of truth. DynamoDB Usage counters are for quota enforcement only (cheaper/faster than querying Stripe at receive time).

## API changes needed

- `POST /orgs` — create org, returns `org_id`
- `POST /orgs/{org_id}/inboxes` — create inbox (registered, not caller-generated UUID)
- `GET  /orgs/{org_id}/inboxes` — list inboxes with message counts
- `DELETE /orgs/{org_id}/inboxes/{token}` — delete inbox + all messages

The existing `/inbox/{token}` message API is unchanged — still token-authenticated.

## Per-inbox spam opt-in (parked alongside this)

With the Inboxes registry, spam policy is a field (`spam_policy`) rather than a token naming convention. Free tier = `strict` only. Paid tiers can set `allow` per inbox to receive spam with verdict metadata attached.

## Migration from current state

The current schema has no Inboxes table and no org_id on messages. Migration path:

1. Add Inboxes table and Orgs table (no data migration needed — new infra)
2. Update receive Lambda to do token lookup; add a `LEGACY_BYPASS` env flag for rollback safety
3. Add org_id to new messages going forward (old messages stay as-is, TTL clears them in 24h anyway)
4. Add API endpoints for org/inbox management
5. Wire Stripe
