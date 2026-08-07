import type { SESHandler } from "aws-lambda";
import { GetObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import PostalMime from "postal-mime";
import { isValidToken, normalizeToken, buildSk, putMessage } from "@givemeyouremail/core";

const DOMAIN = "givemeyour.email";
const TTL_SECONDS = 86400;
const MAX_EMAIL_BYTES = 1_048_576; // 1 MB
const s3 = new S3Client({});
const BUCKET = process.env.EMAIL_BUCKET!;

async function fetchRawEmail(key: string): Promise<Buffer | null> {
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  if ((head.ContentLength ?? 0) > MAX_EMAIL_BYTES) {
    return null;
  }
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const chunks: Uint8Array[] = [];
  for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const handler: SESHandler = async (event) => {
  for (const record of event.Records) {
    const { mail, receipt } = record.ses;

    if (
      receipt.spamVerdict.status === "FAIL" ||
      receipt.virusVerdict.status === "FAIL"
    ) {
      console.log(
        `Dropping message ${mail.messageId}: spam=${receipt.spamVerdict.status} virus=${receipt.virusVerdict.status}`
      );
      continue;
    }

    // receipt.recipients is the SMTP envelope — more reliable than mail.destination
    // (mail.destination reflects To: header only, misses BCC)
    const toAddresses = receipt.recipients.filter((addr) =>
      addr.toLowerCase().endsWith(`@${DOMAIN}`)
    );

    // Use the key SES actually wrote, falling back to the conventional prefix
    const s3Key =
      receipt.action.type === "S3"
        ? receipt.action.objectKey
        : `emails/${mail.messageId}`;
    let parsed: Awaited<ReturnType<PostalMime["parse"]>> | null = null;

    try {
      const raw = await fetchRawEmail(s3Key);
      if (raw === null) {
        console.log(`Dropping message ${mail.messageId}: exceeds ${MAX_EMAIL_BYTES} byte limit`);
        continue;
      }
      parsed = await new PostalMime().parse(raw);
    } catch (err) {
      console.error(`Failed to fetch/parse raw email ${s3Key}:`, err);
      continue;
    }

    for (const toAddr of toAddresses) {
      const localPart = toAddr.split("@")[0].toLowerCase();
      const token = normalizeToken(localPart);

      if (!isValidToken(token)) {
        console.log(`Skipping invalid token: ${localPart}`);
        continue;
      }

      const subject = parsed?.subject ?? mail.commonHeaders.subject ?? "(no subject)";
      const from = parsed?.from?.address
        ? `${parsed.from.name ?? ""} <${parsed.from.address}>`.trim()
        : (mail.commonHeaders.from?.[0] ?? mail.source);

      await putMessage({
        token,
        sk: buildSk(mail.messageId),
        from,
        subject,
        bodyText: parsed?.text ?? "",
        bodyHtml: parsed?.html ?? "",
        receivedAt: new Date(mail.timestamp).toISOString(),
        ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
      });

      console.log(`Stored message for token ${token}: ${subject}`);
    }
  }
};
