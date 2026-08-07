# givemeyour.email

Disposable email inboxes for end-to-end testing email flows. Any email sent to `<uuid>@givemeyour.email` is stored for 24h and retrievable via API.

## Architecture

- **SES inbound** → Lambda (`receive`) → DynamoDB
- **API Gateway v2** → Lambda (`api`) → DynamoDB
- **SST v3** for infra, pnpm workspaces, TypeScript strict

## Token-based addressing

The local-part of each address IS the inbox ID and auth credential: `abc123-...-uuid@givemeyour.email`. Only someone who knows the token can poll the inbox — no enumeration possible. Generate tokens with `generateToken()` from `@givemeyouremail/core`.

## Monorepo layout

```
packages/core/      - shared types, DynamoDB helpers, token utils
packages/functions/ - Lambda handlers (receive + api)
sst.config.ts       - SST infrastructure definition
```

## DynamoDB schema

Table: `Messages` (created by SST, name from `MESSAGES_TABLE` env var)

| Attribute   | Type   | Notes                                    |
|-------------|--------|------------------------------------------|
| token       | string | PK — UUID inbox identifier               |
| sk          | string | SK — `${ISO timestamp}#${messageId}`     |
| from        | string |                                          |
| subject     | string |                                          |
| bodyText    | string |                                          |
| bodyHtml    | string |                                          |
| receivedAt  | string | ISO 8601                                 |
| ttl         | number | Epoch seconds, 24h TTL (auto-deleted)    |

## API

```
GET    /inbox/{token}        List messages. ?since=ISO&limit=50
GET    /inbox/{token}/{sk}   Get one message (sk is URL-encoded)
DELETE /inbox/{token}        Delete all messages for inbox
```

All routes return `application/json`. 400 on invalid token, 404 on not found.

## Deploy

```bash
pnpm install
pnpm --filter @givemeyouremail/core build
sst deploy --stage production
```

## Pre-deploy checklist (one-time)

- [ ] Verify `givemeyour.email` domain in SES (DNS TXT + MX records)
- [ ] Set MX record: `10 inbound-smtp.us-east-1.amazonaws.com`
- [ ] Create SES receipt rule set, make it active
- [ ] Add receipt rule: `*@givemeyour.email` → Lambda action → `ReceiveFunction` ARN (from SST outputs)
- [ ] Grant SES permission to invoke Lambda (see comment in `sst.config.ts`)

## Known limitations / TODOs

- `receive.ts` currently only stores headers (subject, from). Full body parsing requires the SES → S3 → Lambda pattern: configure the receipt rule to save raw email to S3, then fetch + parse with `postal-mime` in the Lambda.
- Rate limiting: add WAF to API Gateway for IP-based rate limiting
- Payment flow: TBD — free tier = 1 inbox, 24h TTL; paid = more inboxes, longer TTL, webhooks
