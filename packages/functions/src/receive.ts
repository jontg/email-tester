import type { SESHandler } from "aws-lambda";
import PostalMime from "postal-mime";
import { isValidToken, normalizeToken, buildSk, putMessage } from "@givemeyouremail/core";

const DOMAIN = "givemeyour.email";
const TTL_SECONDS = 86400;

export const handler: SESHandler = async (event) => {
  for (const record of event.Records) {
    const { mail, receipt } = record.ses;

    const toAddresses = mail.destination.filter((addr) =>
      addr.toLowerCase().endsWith(`@${DOMAIN}`)
    );

    for (const toAddr of toAddresses) {
      const localPart = toAddr.split("@")[0].toLowerCase();
      const token = normalizeToken(localPart);

      if (!isValidToken(token)) {
        console.log(`Skipping invalid token: ${localPart}`);
        continue;
      }

      let bodyText = "";
      let bodyHtml = "";

      // postal-mime needs the raw email content; SES provides it via S3 or as the content field
      // When using the Lambda action (not S3), the raw content isn't directly available in the event.
      // For now, parse what we can from the mail headers; wire up S3 action for full body parsing.
      // TODO: configure SES receipt rule to store raw email in S3, then fetch + parse here.
      const subject = mail.commonHeaders.subject ?? "(no subject)";
      const from = mail.commonHeaders.from?.[0] ?? mail.source;

      await putMessage({
        token,
        sk: buildSk(mail.messageId),
        from,
        subject,
        bodyText,
        bodyHtml,
        receivedAt: new Date(mail.timestamp).toISOString(),
        ttl: Math.floor(Date.now() / 1000) + TTL_SECONDS,
      });

      console.log(`Stored message for token ${token}: ${subject}`);
    }
  }
};
