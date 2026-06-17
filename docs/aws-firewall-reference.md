# AWS Firewall Configuration Reference

Quick reference for every security control configured in this lab.
For step-by-step setup instructions see [lab-guide.md](lab-guide.md).

---

## Security Group Rules

### sg-web (Web Tier)

**Inbound**

| Direction | Protocol | Port Range | Source          | Description                      |
|-----------|----------|------------|-----------------|----------------------------------|
| Inbound   | TCP      | 80         | `0.0.0.0/0`    | HTTP from internet               |
| Inbound   | TCP      | 443        | `0.0.0.0/0`    | HTTPS from internet              |
| Inbound   | TCP      | 22         | `YOUR_IP/32`   | SSH — restricted to one address  |

**Outbound**

| Direction | Protocol | Port Range | Destination     | Description                      |
|-----------|----------|------------|-----------------|----------------------------------|
| Outbound  | All      | All        | `0.0.0.0/0`    | Unrestricted (default)           |

Tightened outbound (production hardening, optional):

| Direction | Protocol | Port Range | Destination     | Description                      |
|-----------|----------|------------|-----------------|----------------------------------|
| Outbound  | TCP      | 3000       | `sg-app`       | Reach app tier API               |
| Outbound  | TCP      | 443        | `0.0.0.0/0`    | Package downloads / AWS APIs     |
| Outbound  | TCP      | 80         | `0.0.0.0/0`    | Package downloads (fallback)     |

---

### sg-app (App Tier)

**Inbound**

| Direction | Protocol | Port Range | Source          | Description                                  |
|-----------|----------|------------|-----------------|----------------------------------------------|
| Inbound   | TCP      | 3000       | `sg-web`       | API — from web tier instances **only**       |
| Inbound   | TCP      | 22         | `YOUR_IP/32`   | SSH — restricted to one address              |

> Port 3000 source is a **security group reference**, not a CIDR.  
> Only instances carrying `sg-web` can connect — IP address is irrelevant.

**Outbound**

| Direction | Protocol | Port Range | Destination     | Description                      |
|-----------|----------|------------|-----------------|----------------------------------|
| Outbound  | All      | All        | `0.0.0.0/0`    | Unrestricted (default)           |

---

## IAM Configuration

### cit270-lab-ec2-role

**Trust policy** — who can assume this role:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "ec2.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

**Attached managed policy:**

| Policy | Why attached |
|--------|-------------|
| `AmazonSSMManagedInstanceCore` | Enables Session Manager shell access without SSH |

**Inline policy permissions:**

| Action | Resource | Effect | Purpose |
|--------|----------|--------|---------|
| `ssm:UpdateInstanceInformation` | `*` | Allow | SSM heartbeat |
| `ssmmessages:Create*`, `ssmmessages:Open*` | `*` | Allow | Session Manager channels |
| `logs:CreateLogGroup` | `/cit270-lab/*` | Allow | Create scoped log group |
| `logs:CreateLogStream` | `/cit270-lab/*` | Allow | Create log stream |
| `logs:PutLogEvents` | `/cit270-lab/*` | Allow | Write log events |
| `logs:DescribeLogStreams` | `/cit270-lab/*` | Allow | List streams |
| `ec2:*` | — | **Not granted** | Instance cannot control other instances |
| `s3:*` | — | **Not granted** | No object storage access |
| `iam:*` | — | **Not granted** | Cannot escalate privileges |

---

### lab-student-policy (applied to IAM user, not the EC2 role)

**Allow block summary:**

| Action group | Scope |
|-------------|-------|
| `ec2:Describe*` | `*` (read-only, any region) |
| `ec2:RunInstances`, `ec2:Start/Stop/Terminate` | `us-east-1` only (Condition: `aws:RequestedRegion`) |
| `ec2:CreateSecurityGroup`, `ec2:Authorize/Revoke*` | `*` |
| `ec2:CreateKeyPair`, `ec2:DescribeKeyPairs` | `*` |
| `iam:PassRole` | `arn:aws:iam::*:role/cit270-lab-ec2-role` only, and only to EC2 service |
| `iam:GetRole`, `iam:ListRoles`, `iam:GetPolicy` | `*` (read-only) |

**Explicit Deny block (overrides any Allow):**

| Denied action | Why |
|---------------|-----|
| `iam:CreateUser` | Prevents creating a new user to bypass policy restrictions |
| `iam:AttachUserPolicy` | Prevents attaching admin policies to existing users |
| `iam:CreateAccessKey` | Prevents generating persistent credentials for another user |
| `iam:UpdateAssumeRolePolicy` | Prevents modifying a role's trust policy to add new principals |
| `iam:PutRolePolicy` | Prevents injecting permissions into existing roles |
| `iam:CreateRole` | Prevents creating a new role with elevated permissions |

---

## VPC and Network Configuration

### Address space

| Resource | CIDR | Notes |
|----------|------|-------|
| `cit270-vpc` | `10.0.0.0/16` | 65,534 usable host addresses |
| `cit270-public` subnet | `10.0.1.0/24` | 251 usable (AWS reserves 5 per subnet) |
| `cit270-private` subnet | `10.0.2.0/24` | 251 usable |

### Route tables

**cit270-public-rt** (associated with `cit270-public`):

| Destination | Target | Effect |
|-------------|--------|--------|
| `10.0.0.0/16` | `local` | All intra-VPC traffic routed locally |
| `0.0.0.0/0` | `cit270-igw` | All other traffic goes to the internet |

**Default route table** (associated with `cit270-private`):

| Destination | Target | Effect |
|-------------|--------|--------|
| `10.0.0.0/16` | `local` | Intra-VPC traffic only — no internet route |

Instances in `cit270-private` can communicate with instances in `cit270-public`
via the `local` route, but cannot be reached from or reach the internet.

### Internet Gateway

| Property | Value |
|----------|-------|
| Name | `cit270-igw` |
| Attached VPC | `cit270-vpc` |
| Purpose | Translates public IPs for instances in the public subnet, enables inbound/outbound internet traffic |

Without the IGW, no traffic crosses the VPC boundary even if a subnet has a public IP assigned.

---

## EC2 Instance Security Settings

| Setting | Web Tier | App Tier | Why |
|---------|----------|----------|-----|
| Subnet | `cit270-public` | `cit270-public`* | Both public for lab simplicity |
| Security group | `sg-web` | `sg-app` | Separate firewall profiles |
| Auto-assign public IP | Yes | Yes* | Lab requires SSH; prod: No for app tier |
| IAM instance profile | `cit270-lab-ec2-role` | `cit270-lab-ec2-role` | Same minimal role |
| Key pair | Your key pair | Your key pair | EC2 key-based auth |
| IMDSv2 | `HttpTokens=required` | `HttpTokens=required` | Blocks SSRF credential theft |

*In production the app tier belongs in `cit270-private` with no public IP and no auto-assign.

---

## Firewall Traffic Matrix

This table shows every possible traffic direction and whether it is allowed.

| Source | Destination | Port | Allowed? | Controlling rule |
|--------|-------------|------|----------|-----------------|
| Internet | Web tier | 80 | **Yes** | `sg-web` inbound: 80 from `0.0.0.0/0` |
| Internet | Web tier | 443 | **Yes** | `sg-web` inbound: 443 from `0.0.0.0/0` |
| YOUR_IP | Web tier | 22 | **Yes** | `sg-web` inbound: 22 from `YOUR_IP/32` |
| Other IP | Web tier | 22 | **No** | No matching rule in `sg-web` |
| Internet | App tier | 3000 | **No** | No rule allows 3000 from `0.0.0.0/0` in `sg-app` |
| Internet | App tier | 80 | **No** | No rule allows 80 in `sg-app` |
| YOUR_IP | App tier | 22 | **Yes** | `sg-app` inbound: 22 from `YOUR_IP/32` |
| Web tier | App tier | 3000 | **Yes** | `sg-app` inbound: 3000 from `sg-web` |
| Web tier | App tier | 22 | **No** | `sg-web` is not `YOUR_IP/32` |
| App tier | Internet | Any | **Yes** | Default outbound allow-all on `sg-app` |
| Web tier | Internet | Any | **Yes** | Default outbound allow-all on `sg-web` |

---

## Common Misconfigurations and Their Impact

| Misconfiguration | Impact | How to detect |
|-----------------|--------|---------------|
| Port 3000 open to `0.0.0.0/0` on `sg-app` | App API directly reachable from internet | `curl http://<app-public-ip>:3000` succeeds from your laptop |
| SSH open to `0.0.0.0/0` on any SG | Brute-force surface for all internet scanners | AWS Security Hub / Trusted Advisor flags this |
| No IAM role on the instance | Instance cannot use SSM; any app bug that tries to call AWS APIs will fail open (no credentials = no access) | `curl 169.254.169.254/.../iam/info` returns 404 |
| IMDSv1 not disabled | SSRF in the app can fetch IAM credentials with a single HTTP GET | Test: `curl http://169.254.169.254/latest/meta-data/iam/security-credentials/` without a token — should fail with IMDSv2 |
| App tier in public subnet with no SG restriction | Redundant public IP assigned; one misconfigured SG rule exposes the tier | Use private subnet + NAT in production |
| Overly broad IAM role (`ec2:*` or `*`) | Compromised instance can control the entire AWS account | Review role policies in IAM console or AWS Config |
