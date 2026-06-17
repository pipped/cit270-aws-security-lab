# Serverless Visitor Counter — Lambda, DynamoDB, API Gateway, CloudWatch

This extension adds a serverless visitor counter to the CIT 270 lab. It demonstrates
how AWS managed services can replace EC2 for event-driven workloads — no OS to patch,
no server to provision, and the account is only billed when requests actually run.

---

## Architecture

```
Browser
   │  GET /visitors
   ▼
┌──────────────────────────┐
│  API Gateway REST API    │  cit270-visitor-api (REGIONAL endpoint)
│  Stage: prod             │  Route: GET /visitors → Lambda Proxy Integration
└──────────┬───────────────┘
           │  event (JSON with httpMethod, headers, etc.)
           ▼
┌──────────────────────────┐
│  Lambda Function         │  cit270-visitor-counter (Python 3.12, 128 MB)
│  visitor_counter.handler │  Execution role: cit270-lambda-execution-role
└──────────┬───────────────┘
           │  UpdateItem (atomic ADD)
           ▼
┌──────────────────────────┐
│  DynamoDB Table          │  cit270-visitor-counter
│  pk = "visitor_count"    │  Billing: PAY_PER_REQUEST (on-demand)
│  visit_count (Number)    │
└──────────────────────────┘

All invocations → CloudWatch Logs (/aws/lambda/cit270-visitor-counter)
Errors → CloudWatch Alarm (cit270-lambda-errors)
```

---

## AWS Lambda

Lambda runs code in response to events without managing servers. AWS provisions
compute capacity on demand, executes the function, and releases it. You pay per
invocation and per 100 ms of compute time — a function that never runs costs nothing.

**How this lab uses it:**

The function `visitor_counter.handler` is invoked by API Gateway every time a
client hits `GET /visitors`. It receives the HTTP event as a Python dict, calls
DynamoDB, and returns a JSON response. API Gateway forwards that response directly
to the browser.

```python
def handler(event, context):
    result = table.update_item(
        Key={'pk': 'visitor_count'},
        UpdateExpression='ADD visit_count :inc',
        ExpressionAttributeValues={':inc': 1},
        ReturnValues='UPDATED_NEW'
    )
    count = int(result['Attributes']['visit_count'])
    return _response(200, {'count': count})
```

**Key security settings:**

| Setting | Value | Why |
|---------|-------|-----|
| Execution role | `cit270-lambda-execution-role` | Scoped IAM role — only DynamoDB UpdateItem and CloudWatch Logs |
| Source ARN on permission | `arn:aws:execute-api:.../${VisitorApi}/*` | Only this API Gateway can invoke the function |
| Environment variable | `TABLE_NAME` from CloudFormation | Avoids hardcoding the table name |

The execution role is the Lambda equivalent of an EC2 instance profile. Without it,
the function cannot call any AWS service. The principle is the same as the EC2 lab:
grant only the actions the workload needs, scoped to the specific resource.

**IAM policy for the Lambda role** (`aws/iam/lambda-execution-role-policy.json`):

```json
{
  "Statement": [
    {
      "Sid": "AllowDynamoDBVisitorTable",
      "Effect": "Allow",
      "Action": ["dynamodb:GetItem", "dynamodb:UpdateItem"],
      "Resource": "arn:aws:dynamodb:*:*:table/cit270-visitor-counter"
    },
    {
      "Sid": "AllowCloudWatchLogs",
      "Effect": "Allow",
      "Action": ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
      "Resource": "arn:aws:logs:*:*:log-group:/aws/lambda/cit270-visitor-counter*"
    }
  ]
}
```

Note: `dynamodb:Scan`, `dynamodb:DeleteItem`, and `dynamodb:PutItem` are all absent.
The function only needs to increment one field — granting more would violate least privilege.

**Test manually with the AWS CLI:**

```bash
aws lambda invoke \
  --function-name cit270-visitor-counter \
  --cli-binary-format raw-in-base64-out \
  --payload '{"httpMethod": "GET"}' \
  response.json && cat response.json
```

Expected output: `{"statusCode": 200, "body": "{\"count\": 1}"}`

---

## AWS DynamoDB

DynamoDB is a fully managed NoSQL key-value and document database. There are no
servers to provision — you define a table, choose a billing mode, and DynamoDB
handles storage, replication, and scaling automatically.

**Table design for the visitor counter:**

| Attribute | Type | Role |
|-----------|------|------|
| `pk` | String | Partition key — the only required attribute |
| `visit_count` | Number | Incremented atomically with `ADD` |

The table has a single item: `{"pk": "visitor_count", "visit_count": N}`. This is
an intentionally minimal single-table design — one item, one counter.

**Why `PAY_PER_REQUEST` billing?**

DynamoDB has two billing modes:
- **Provisioned**: you reserve read/write capacity units per second and pay for the reservation whether or not you use it.
- **PAY_PER_REQUEST** (on-demand): you pay per read/write operation, no reservation needed.

For a lab with unpredictable traffic, on-demand is safer — no idle capacity costs,
no `ProvisionedThroughputExceededException` errors when the table is first hit.

**Atomic increment with `ADD`:**

```python
table.update_item(
    Key={'pk': 'visitor_count'},
    UpdateExpression='ADD visit_count :inc',
    ExpressionAttributeValues={':inc': 1},
    ReturnValues='UPDATED_NEW'
)
```

`UpdateExpression: 'ADD visit_count :inc'` tells DynamoDB to atomically add 1 to
`visit_count`. If the attribute doesn't exist yet, DynamoDB creates it starting at 0
then adds 1. Two simultaneous requests cannot produce the same count — DynamoDB
serializes `ADD` operations at the item level. A standard read-modify-write in
application code would require a transaction or a condition expression to be safe.

**Inspect the table:**

```bash
# Read the current item
aws dynamodb get-item \
  --table-name cit270-visitor-counter \
  --key '{"pk": {"S": "visitor_count"}}'

# Reset the counter for testing
aws dynamodb put-item \
  --table-name cit270-visitor-counter \
  --item '{"pk": {"S": "visitor_count"}, "visit_count": {"N": "0"}}'
```

---

## AWS API Gateway

API Gateway is a managed service that accepts HTTP requests, routes them to a
backend (Lambda, EC2, or any HTTP endpoint), and returns the response. It handles
TLS termination, request throttling, access logging, and CORS — without any server.

**This lab uses a REST API with Lambda Proxy Integration.**

In proxy integration, API Gateway passes the full HTTP request to Lambda as a JSON
event object and returns Lambda's response verbatim to the client. The function
controls the status code, headers, and body.

```
Client → API Gateway → Lambda → DynamoDB → Lambda → API Gateway → Client
         (routes GET /visitors)            (returns {statusCode, headers, body})
```

**Why REST API instead of HTTP API?**

API Gateway offers two products:
- **HTTP API**: newer, cheaper, faster. Missing some features (usage plans, WAF integration, per-method logging).
- **REST API**: older, more configuration options. This lab uses REST API because it exposes more settings worth understanding — stages, deployments, method-level logging.

**Stages and Deployments:**

A deployment is a snapshot of the API configuration. A stage is a named pointer to
a deployment (like a DNS alias). Changes to routes or integrations don't go live
until a new deployment is created and the stage is updated.

```
                REST API (cit270-visitor-api)
                        │
              ┌─────────┴─────────┐
          Deployment A        Deployment B  ← new config snapshot
              │
         Stage: prod  ← points to Deployment A until updated
```

To deploy a change:

```bash
# After modifying a method or integration:
aws apigateway create-deployment \
  --rest-api-id <api-id> \
  --stage-name prod \
  --description "Updated CORS headers"
```

**Test the endpoint:**

```bash
# Get the endpoint URL from CloudFormation outputs
ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name cit270-serverless \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiEndpoint`].OutputValue' \
  --output text)

# Hit it
curl -s "$ENDPOINT" | python3 -m json.tool
```

Expected: `{"count": 1}` (increments on each call)

**CORS:**

The OPTIONS method uses a MOCK integration — no Lambda invocation needed. API Gateway
returns the CORS preflight headers directly, saving a round-trip to Lambda.

---

## AWS CloudWatch

CloudWatch is AWS's observability service. It collects logs, metrics, and traces,
and lets you set alarms that fire when a threshold is crossed.

**Logs — automatic from Lambda:**

Every `print()` statement in the Lambda function goes to CloudWatch Logs under the
log group `/aws/lambda/cit270-visitor-counter`. Each Lambda invocation creates a log
stream. The log group is configured with a 7-day retention to keep student account
costs near zero.

```bash
# Tail recent Lambda logs
aws logs tail /aws/lambda/cit270-visitor-counter --follow

# Search for errors in the last hour
aws logs filter-log-events \
  --log-group-name /aws/lambda/cit270-visitor-counter \
  --filter-pattern "ERROR" \
  --start-time $(($(date +%s) - 3600))000
```

**Metrics — automatic from Lambda and API Gateway:**

AWS publishes metrics to CloudWatch automatically for Lambda and API Gateway.
No instrumentation needed in the function code.

Key Lambda metrics:

| Metric | What it counts |
|--------|---------------|
| `Invocations` | Number of times the function was called |
| `Errors` | Invocations that threw an unhandled exception |
| `Duration` | How long each invocation ran (ms) |
| `Throttles` | Invocations rejected because concurrency limit was hit |
| `ConcurrentExecutions` | Functions running simultaneously |

Key API Gateway metrics:

| Metric | What it counts |
|--------|---------------|
| `Count` | Total requests to the stage |
| `4XXError` | Client errors (bad request, not found, unauthorized) |
| `5XXError` | Server errors (Lambda failed, integration error) |
| `Latency` | Time from request to response at the API layer |

**Alarms:**

This lab provisions two CloudWatch alarms:

`cit270-lambda-errors` — fires immediately if the Lambda function throws any errors:
```
Metric:    AWS/Lambda > Errors (FunctionName=cit270-visitor-counter)
Threshold: >= 1 in a 60-second window
Action:    ALARM state (visible in CloudWatch console)
```

`cit270-apigw-4xx` — fires if client error rate exceeds 10% over 5 minutes:
```
Metric:    AWS/ApiGateway > 4XXError (ApiName=cit270-visitor-api, Stage=prod)
Threshold: >= 0.10 (10%) over 300 seconds
Action:    ALARM state
```

**View alarm state:**

```bash
aws cloudwatch describe-alarms \
  --alarm-names cit270-lambda-errors cit270-apigw-4xx \
  --query 'MetricAlarms[*].[AlarmName, StateValue, StateReason]' \
  --output table
```

**Force an alarm (for testing):**

```bash
aws cloudwatch set-alarm-state \
  --alarm-name cit270-lambda-errors \
  --state-value ALARM \
  --state-reason "Manual test"

# Reset it
aws cloudwatch set-alarm-state \
  --alarm-name cit270-lambda-errors \
  --state-value OK \
  --state-reason "Reset after test"
```

---

## Deploy

```bash
aws cloudformation deploy \
  --template-file aws/cloudformation/serverless-stack.yaml \
  --stack-name cit270-serverless \
  --capabilities CAPABILITY_IAM

# Get the API endpoint
aws cloudformation describe-stacks \
  --stack-name cit270-serverless \
  --query 'Stacks[0].Outputs' \
  --output table
```

---

## Cleanup

```bash
aws cloudformation delete-stack --stack-name cit270-serverless
```

DynamoDB, Lambda, API Gateway, CloudWatch log groups, and the IAM role are all
deleted by the stack. There are no EC2 instances or persistent storage to clean up
separately.
