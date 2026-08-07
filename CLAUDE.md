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
- [ ] Create SES receipt rule set and make it active
- [ ] Add receipt rule for `*@givemeyour.email` with two ordered actions:
  1. *S3 action* → bucket: `EmailsBucket` (from `sst deploy` outputs), prefix: `emails/`
  2. *Lambda action* → `ReceiveFunction` ARN (from `sst deploy` outputs)
- [ ] Add S3 bucket policy allowing SES to `s3:PutObject` (Principal: `ses.amazonaws.com`, Condition: `aws:SourceAccount = <your account id>`)
- [ ] SES auto-grants Lambda invoke permission when you add the Lambda action in the rule

## Flow

```
Email → SES receipt rule
  → S3 (raw email at emails/<messageId>)
  → Lambda receive.handler
      → fetches raw from S3
      → parses with postal-mime (subject, from, bodyText, bodyHtml)
      → writes to DynamoDB (TTL 24h)
  → S3 objects auto-deleted after 2 days (lifecycle rule)
```

## Known limitations / TODOs

- Rate limiting: add WAF to API Gateway for IP-based rate limiting
- Attachments: `postal-mime` parses them but `StoredMessage` doesn't store them yet — add if needed
- Payment flow: TBD — free tier = 1 inbox, 24h TTL; paid = more inboxes, longer TTL, webhooks
