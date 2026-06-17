# S3 Bucket Security

S3 is one of the most commonly misconfigured AWS services. Unlike EC2 where traffic
is gated by security groups, S3 uses its own access control model — and the defaults
have changed over time, so it's worth understanding each layer independently.

---

## Access Control Layers

S3 has four separate mechanisms that all have to allow a request before it succeeds.
A Deny at any layer blocks access regardless of what the others say.

```
Request arrives
       │
       ▼
1. Block Public Access (account or bucket level)
       │  If enabled, overrides any policy that would make the bucket public
       ▼
2. Bucket Policy (resource-based, JSON)
       │  Who can do what to this bucket and its objects
       ▼
3. IAM Policy (identity-based)
       │  What this user/role is allowed to do in S3
       ▼
4. Object ACL (legacy, mostly disabled now)
       │  Per-object ownership and access grants
       ▼
Access granted or denied
```

In practice you work with **Block Public Access + Bucket Policy + IAM**. ACLs are
disabled by default on new buckets since April 2023 and should stay that way.

---

## Block Public Access

This is the first and bluntest control. It sits above all policies and overrides them.

| Setting | What it blocks |
|---------|----------------|
| `BlockPublicAcls` | Prevents adding ACLs that grant public access |
| `IgnorePublicAcls` | Ignores any existing public ACLs — effectively removes them |
| `BlockPublicPolicy` | Prevents adding a bucket policy that grants public access |
| `RestrictPublicBuckets` | Makes the bucket private even if a public policy already exists |

All four are enabled by default at the **account level** since 2023. If you need a
genuinely public bucket (e.g., static website hosting), you must explicitly turn them off.

**Enable via CLI:**
```bash
aws s3api put-public-access-block \
  --bucket your-bucket-name \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,\
    BlockPublicPolicy=true,RestrictPublicBuckets=true
```

> **Why this matters:** In 2019–2021, thousands of S3 buckets were exposed because
> developers set bucket policies to allow public reads for testing and forgot to revert them.
> Block Public Access exists to be a hard stop — a policy mistake can't accidentally
> make a bucket public if this setting is on at the account level.

---

## Bucket Policies

A bucket policy is a JSON document attached directly to the bucket. It uses the same
IAM policy language but the principal can be any AWS account, user, role, or `*` (everyone).

### Deny all access unless from a specific VPC endpoint

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyNonVPCAccess",
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ],
      "Condition": {
        "StringNotEquals": {
          "aws:SourceVpc": "vpc-xxxxxxxx"
        }
      }
    }
  ]
}
```

This policy means: even if someone has valid IAM credentials, they can only access this
bucket from inside a specific VPC. Calls made from the internet (including the AWS Console)
are denied. Used when the bucket should only be reachable by your EC2 instances.

### Allow read-only access to a specific IAM role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEC2RoleReadOnly",
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/cit270-lab-ec2-role"
      },
      "Action": [
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}
```

This gives the EC2 instance role read access only — it cannot upload, delete, or modify
objects. Combined with the IAM role policy, both have to allow the action for it to succeed.

### Common mistake — overly broad principal

```json
"Principal": "*"
"Action": "s3:GetObject"
```

This makes every object in the bucket publicly readable from the internet with no
authentication. If Block Public Access is off, this is a data breach waiting to happen.
AWS will flag this in Security Hub under the `S3.2` control.

---

## IAM Policies for S3

The bucket policy controls what can access the bucket. The IAM policy controls what
the identity is allowed to do. Both must allow the action.

### Scoped read-only policy for the lab EC2 role

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListLabBucket",
      "Effect": "Allow",
      "Action": "s3:ListBucket",
      "Resource": "arn:aws:s3:::cit270-lab-bucket",
      "Condition": {
        "StringLike": {
          "s3:prefix": ["logs/*", "config/*"]
        }
      }
    },
    {
      "Sid": "ReadLabObjects",
      "Effect": "Allow",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::cit270-lab-bucket/logs/*"
    }
  ]
}
```

The `s3:prefix` condition on `ListBucket` limits what prefixes the role can enumerate —
it can see `logs/` and `config/` but not list the entire bucket. `GetObject` is further
scoped to `logs/*` only. This is how you give an EC2 instance access to its own logs
without letting it read every file in the bucket.

---

## Encryption

S3 encrypts all objects by default since January 2023 (SSE-S3). There are three options:

| Type | Key managed by | Use case |
|------|---------------|---------|
| SSE-S3 | AWS (automatic) | Default — no extra cost or config |
| SSE-KMS | AWS KMS (you control the key policy) | Audit trail per-request in CloudTrail; cross-account access control |
| SSE-C | You (send key with every request) | When you can't trust AWS to hold the key |

**When SSE-KMS matters:**  
With SSE-KMS, every decrypt call generates a CloudTrail event. You can see exactly which
IAM identity accessed which object and when. With SSE-S3 you see the S3 API call but not
the KMS decrypt. For compliance use cases (PCI, HIPAA), SSE-KMS gives you the audit trail.

**Enforce encryption in transit with a bucket policy:**

```json
{
  "Sid": "DenyHTTP",
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:*",
  "Resource": [
    "arn:aws:s3:::your-bucket-name",
    "arn:aws:s3:::your-bucket-name/*"
  ],
  "Condition": {
    "Bool": { "aws:SecureTransport": "false" }
  }
}
```

This denies any request made over HTTP (not HTTPS). Without it, an SDK misconfigured
with `http://` endpoints would send data unencrypted.

---

## Versioning and Accidental Deletion

Versioning keeps a full history of every object version. Once enabled, a `DELETE` request
doesn't remove the object — it adds a delete marker. The previous version is still there
and recoverable.

```bash
aws s3api put-bucket-versioning \
  --bucket your-bucket-name \
  --versioning-configuration Status=Enabled
```

**MFA Delete** adds a second factor requirement before deleting a version or disabling
versioning. Useful when the bucket holds backups or compliance data.

---

## S3 Server Access Logging

S3 can write an access log for every request to the bucket into a second (target) bucket.
This is separate from CloudTrail — it captures the full request details including HTTP
method, key, response code, bytes transferred, and requester IP.

```bash
aws s3api put-bucket-logging \
  --bucket your-bucket-name \
  --bucket-logging-status '{
    "LoggingEnabled": {
      "TargetBucket": "your-log-bucket",
      "TargetPrefix": "s3-access-logs/"
    }
  }'
```

The target bucket needs a policy granting the S3 log delivery service write access.
Don't log a bucket to itself — it creates a feedback loop.

---

## Pre-Signed URLs

A pre-signed URL grants temporary access to a private S3 object without making the
bucket public. The URL encodes the IAM credentials and an expiry timestamp.

```bash
aws s3 presign s3://your-bucket-name/private-file.pdf --expires-in 3600
```

The URL is valid for 3600 seconds (1 hour). Anyone with the URL can download the file
during that window — no AWS account needed. After expiry the URL stops working.

**Security considerations:**
- Use the shortest expiry that satisfies the use case
- Pre-signed URLs inherit the permissions of the IAM identity that created them — if
  that role is later restricted, existing unexpired URLs still work
- Delivered over HTTPS — the signature is in the query string and the request is encrypted in transit

---

## Common S3 Security Mistakes

| Mistake | Impact | Fix |
|---------|--------|-----|
| Block Public Access off + `Principal: *` policy | Bucket and all objects publicly readable | Enable all four Block Public Access settings |
| No encryption in transit policy | SDK misconfigs can send data over HTTP | Add `aws:SecureTransport: false` deny condition |
| Versioning off | A `DELETE` or `PUT` overwrites data permanently | Enable versioning before storing anything important |
| No access logging | Impossible to audit who accessed what | Enable server access logging to a separate log bucket |
| `s3:*` in an IAM policy | Full read/write/delete on all buckets | Scope to specific bucket ARN and specific actions |
| Logging bucket in same account with no restrictions | Malicious insider can delete logs before an audit | Log to a separate account; enable MFA Delete on the log bucket |
