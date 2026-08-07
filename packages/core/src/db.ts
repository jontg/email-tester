import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import type { StoredMessage } from "./email.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.MESSAGES_TABLE!;

export async function putMessage(msg: StoredMessage): Promise<void> {
  await client.send(new PutCommand({ TableName: TABLE, Item: msg }));
}

export async function listMessages(
  token: string,
  opts: { since?: string; limit?: number } = {}
): Promise<StoredMessage[]> {
  const { since, limit = 50 } = opts;
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: since
        ? "token = :t AND sk > :s"
        : "token = :t",
      ExpressionAttributeValues: since
        ? { ":t": token, ":s": since }
        : { ":t": token },
      Limit: limit,
      ScanIndexForward: false,
    })
  );
  return (result.Items ?? []) as StoredMessage[];
}

export async function getMessage(
  token: string,
  sk: string
): Promise<StoredMessage | null> {
  const result = await client.send(
    new GetCommand({ TableName: TABLE, Key: { token, sk } })
  );
  return (result.Item as StoredMessage) ?? null;
}

export async function deleteInbox(token: string): Promise<void> {
  const result = await client.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "token = :t",
      ExpressionAttributeValues: { ":t": token },
      ProjectionExpression: "sk",
    })
  );
  const items = result.Items ?? [];
  await Promise.all(
    items.map((item) =>
      client.send(
        new DeleteCommand({ TableName: TABLE, Key: { token, sk: item.sk } })
      )
    )
  );
}
