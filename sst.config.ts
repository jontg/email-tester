import { SSTConfig } from "sst";
import { Api, Table, Function as SSTFunction } from "sst/constructs";

export default {
  config(_input) {
    return {
      name: "givemeyouremail",
      region: "us-east-1",
    };
  },
  stacks(app) {
    app.stack(function Site({ stack }) {
      const table = new Table(stack, "Messages", {
        fields: {
          token: "string",
          sk: "string",
        },
        primaryIndex: { partitionKey: "token", sortKey: "sk" },
        timeToLiveAttribute: "ttl",
      });

      // SES inbound receive function.
      // To wire up SES receipt rule after domain verification:
      //   1. Verify givemeyour.email in SES console (DNS + MX records)
      //   2. Create a receipt rule set and make it active
      //   3. Add a receipt rule: recipient = *@givemeyour.email, action = Lambda (receiveFunction.functionArn)
      //   4. Grant SES permission to invoke: receiveFunction.addPermission("ses", { principal: new ServicePrincipal("ses.amazonaws.com") })
      const receiveFunction = new SSTFunction(stack, "Receive", {
        handler: "packages/functions/src/receive.handler",
        bind: [table],
      });

      const api = new Api(stack, "Api", {
        routes: {
          "GET /inbox/{token}": "packages/functions/src/api.handler",
          "GET /inbox/{token}/{sk+}": "packages/functions/src/api.handler",
          "DELETE /inbox/{token}": "packages/functions/src/api.handler",
        },
        defaults: {
          function: { bind: [table] },
        },
      });

      stack.addOutputs({
        ApiEndpoint: api.url,
        ReceiveFunctionArn: receiveFunction.functionArn,
      });
    });
  },
} satisfies SSTConfig;
