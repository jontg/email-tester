import type { APIGatewayProxyHandlerV2 } from "aws-lambda";
import {
  isValidToken,
  listMessages,
  getMessage,
  deleteInbox,
} from "@givemeyouremail/core";

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const { routeKey, pathParameters, queryStringParameters } = event;
  const token = pathParameters?.token ?? "";

  if (!isValidToken(token)) {
    return json(400, { error: "Invalid inbox token" });
  }

  if (routeKey === "GET /inbox/{token}") {
    const since = queryStringParameters?.since;
    const limit = queryStringParameters?.limit
      ? parseInt(queryStringParameters.limit, 10)
      : 50;
    const messages = await listMessages(token, { since, limit });
    return json(200, { messages });
  }

  if (routeKey === "GET /inbox/{token}/{sk+}") {
    const sk = decodeURIComponent(pathParameters?.sk ?? "");
    if (!sk) return json(400, { error: "Missing message id" });
    const message = await getMessage(token, sk);
    if (!message) return json(404, { error: "Message not found" });
    return json(200, { message });
  }

  if (routeKey === "DELETE /inbox/{token}") {
    await deleteInbox(token);
    return { statusCode: 204, body: "" };
  }

  return json(404, { error: "Not found" });
};
