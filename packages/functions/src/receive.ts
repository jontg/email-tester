import type { SESHandler } from "aws-lambda";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import PostalMime from "postal-mime";
import { isValidToken, normalizeToken, buildSk, putMessage } from "@givemeyouremail/core";

const DOMAIN = "givemeyour.email";
const TTL_SECONDS = 86400;
const s3 = new S3Client({});
const BUCKET = process.env.EMAIL_BUCKET!;

async function fetchRawEmail(key: string): Promise<Buffer> {
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

    const toAddresses = mail.destination.filter((addr) =>
      addr.toLowerCase().endsWith(`@${DOMAIN}`)
    );

    // SES S3 action writes the raw email to: emails/<messageId>
    const s3Key = `emails/${mail.messageId}`;
    let parsed: Awaited<ReturnType<PostalMime["parse"]>> | null = null;

    try {
      const raw = await fetchRawEmail(s3Key);
      parsed = await new PostalMime().parse(raw);
    } catch (err) {
      console.error(`Failed to fetch/parse raw email ${s3Key}:`, err);
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
