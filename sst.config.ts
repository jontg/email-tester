import { SSTConfig } from "sst";
import { Api, Bucket, Table, Function as SSTFunction } from "sst/constructs";
import { Duration } from "aws-cdk-lib";

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

      // SES writes raw email to this bucket before invoking the Lambda.
      // Lifecycle rule auto-deletes objects after 2 days (messages expire from DynamoDB after 24h).
      const emailBucket = new Bucket(stack, "Emails", {
        cdk: {
          bucket: {
            lifecycleRules: [{ expiration: Duration.days(2), id: "expire-raw-email" }],
          },
        },
      });

      // SES inbound receive function.
      // Pre-deploy checklist (one-time, after domain verification):
      //   1. Verify givemeyour.email in SES (DNS TXT + MX → inbound-smtp.us-east-1.amazonaws.com)
      //   2. Create a receipt rule set and make it active
      //   3. Add a receipt rule for *@givemeyour.email with TWO ordered actions:
      //        a. S3 action  → bucket: EmailsBucket (from stack outputs), prefix: "emails/"
      //        b. Lambda action → function: ReceiveFunction ARN (from stack outputs)
      //   4. SES needs permission to write to the bucket — add a bucket policy:
      //        Principal: ses.amazonaws.com, Action: s3:PutObject, Condition: aws:SourceAccount = <account id>
      const receiveFunction = new SSTFunction(stack, "Receive", {
        handler: "packages/functions/src/receive.handler",
        bind: [table, emailBucket],
        environment: {
          EMAIL_BUCKET: emailBucket.bucketName,
          MESSAGES_TABLE: table.tableName,
        },
      });

      const api = new Api(stack, "Api", {
        routes: {
          "GET /inbox/{token}": "packages/functions/src/api.handler",
          "GET /inbox/{token}/{sk+}": "packages/functions/src/api.handler",
          "DELETE /inbox/{token}": "packages/functions/src/api.handler",
        },
        defaults: {
          function: {
            bind: [table],
            environment: {
              MESSAGES_TABLE: table.tableName,
            },
          },
        },
      });

      stack.addOutputs({
        ApiEndpoint: api.url,
        EmailsBucket: emailBucket.bucketName,
        ReceiveFunctionArn: receiveFunction.functionArn,
      });
    });
  },
} satisfies SSTConfig;
