import { randomUUID } from "crypto";

export type StoredMessage = {
  token: string;
  sk: string;
  from: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  receivedAt: string;
  ttl: number;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function generateToken(): string {
  return randomUUID();
}

export function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(/[^0-9a-f-]/g, "");
}

export function isValidToken(s: string): boolean {
  return UUID_RE.test(s);
}

export function buildSk(messageId: string): string {
  return `${new Date().toISOString()}#${messageId}`;
}
