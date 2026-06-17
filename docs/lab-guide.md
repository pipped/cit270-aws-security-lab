# Lab Guide — AWS Security Configuration

Estimated time: 45–60 minutes  
Focus: IAM, VPC, Security Groups, and firewall verification

---

## Overview

This lab builds a two-tier architecture where a **web tier** EC2 is reachable from the
internet and an **app tier** EC2 is not — enforced entirely by AWS security controls,
not by application logic. You configure the controls, observe them working, then
deliberately break and restore rules to understand what each one does.

```
Internet
   │  allowed: 80, 443
   ▼
[sg-web] ── cit270-web-ec2 (public IP)
   │  allowed: port 3000 (sg-web source only)
   ▼
[sg-app] ── cit270-app-ec2 (private IP only)
             blocked: port 3000 from internet
```

---

## Part 1 — IAM Configuration

IAM controls what AWS services each EC2 instance can call. The goal is **least privilege**:
grant only the permissions the workload actually needs and nothing more.

### 1.1 Create the EC2 trust policy

The trust policy defines which AWS service can assume the role.
The file `aws/iam/ec2-trust-policy.json` already contains:

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

`Principal: ec2.amazonaws.com` means only the EC2 service can assume this role —
no other AWS service, IAM user, or external account can use it to call AWS APIs.

### 1.2 Create the IAM role

1. **IAM → Roles → Create role**
2. Trusted entity type: **AWS service**
3. Use case: **EC2** — this auto-populates the trust policy above
4. Click **Next**

### 1.3 Attach permissions

**Managed policy (AWS-provided):**  
Search for and attach `AmazonSSMManagedInstanceCore`.  
This allows Session Manager shell access — so you can connect to the instance
without opening SSH to the internet.

**Inline policy (custom, least-privilege):**  
After creating the role, go to the role → **Add permissions → Create inline policy → JSON tab**.  
Paste the contents of `aws/iam/ec2-instance-role-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowSSMSessionManager",
      "Effect": "Allow",
      "Action": [
        "ssm:UpdateInstanceInformation",
        "ssmmessages:CreateControlChannel",
        "ssmmessages:CreateDataChannel",
        "ssmmessages:OpenControlChannel",
        "ssmmessages:OpenDataChannel"
      ],
      "Resource": "*"
    },
    {
      "Sid": "AllowCloudWatchLogs",
      "Effect": "Allow",
      "Action": [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
        "logs:DescribeLogStreams"
      ],
      "Resource": "arn:aws:logs:*:*:log-group:/cit270-lab/*"
    }
  ]
}
```

Note the CloudWatch resource ARN ends in `/cit270-lab/*` — the instance can only write
to log groups with that prefix. It cannot read, delete, or write to other accounts' logs.

5. Name the role: `cit270-lab-ec2-role`
6. Click **Create role**

### 1.4 Create an instance profile

AWS attaches roles to EC2 via an **instance profile** (a container for the role).
The console creates one automatically with the same name as the role when you use
the EC2 launch wizard — but if using the CLI:

```bash
aws iam create-instance-profile --instance-profile-name cit270-lab-ec2-profile
aws iam add-role-to-instance-profile \
  --instance-profile-name cit270-lab-ec2-profile \
  --role-name cit270-lab-ec2-role
```

### 1.5 (Optional) Apply the student lab policy

If you're in a shared AWS account, apply `aws/iam/lab-student-policy.json` to your IAM user.
The key section is the explicit `Deny`:

```json
{
  "Sid": "DenyIAMEscalation",
  "Effect": "Deny",
  "Action": [
    "iam:CreateUser",
    "iam:AttachUserPolicy",
    "iam:CreateAccessKey",
    "iam:PutRolePolicy",
    "iam:CreateRole"
  ],
  "Resource": "*"
}
```

This prevents a student from creating a new IAM user with admin rights to escape
the boundaries of the lab account — a common privilege escalation path.

> **Why does Deny beat Allow?**  
> In AWS IAM, an explicit `Deny` always overrides any `Allow` in any policy,
> regardless of policy order or attachment point. This makes Deny safe to use
> as a hard guardrail.

---

## Part 2 — VPC and Network Layout

### 2.1 Create a VPC

1. **VPC → Your VPCs → Create VPC**
2. Name: `cit270-vpc`
3. IPv4 CIDR: `10.0.0.0/16`
4. Leave IPv6 disabled
5. Click **Create VPC**

The /16 block gives 65,536 addresses. Subnets will carve out smaller slices.

### 2.2 Create subnets

**Public subnet** (web tier lives here):

1. **VPC → Subnets → Create subnet**
2. VPC: `cit270-vpc`
3. Name: `cit270-public`
4. Availability zone: pick any (e.g. `us-east-1a`)
5. IPv4 CIDR: `10.0.1.0/24` (256 addresses)

**Private subnet** (app tier — no direct internet route):

1. Name: `cit270-private`
2. Same VPC, same AZ
3. IPv4 CIDR: `10.0.2.0/24`

### 2.3 Attach an Internet Gateway

Without an Internet Gateway (IGW), no traffic can flow between the VPC and the internet.

1. **VPC → Internet Gateways → Create internet gateway**
2. Name: `cit270-igw`
3. After creating: **Actions → Attach to VPC → cit270-vpc**

### 2.4 Route the public subnet to the IGW

Route tables define where traffic is sent. The public subnet needs a route
that sends internet-bound traffic (`0.0.0.0/0`) to the IGW.

1. **VPC → Route Tables → Create route table**
2. Name: `cit270-public-rt` | VPC: `cit270-vpc`
3. **Routes tab → Edit routes → Add route**
   - Destination: `0.0.0.0/0`
   - Target: `cit270-igw` (Internet Gateway)
4. **Subnet associations tab → Edit → select `cit270-public`**

The private subnet uses the VPC's default route table which has no IGW route —
that is what makes it "private." Traffic between instances in the VPC still works
(local route), but the app tier cannot be reached from the internet directly.

### 2.5 Enable public IP assignment on the public subnet

1. **Subnets → select `cit270-public` → Actions → Edit subnet settings**
2. Check **Enable auto-assign public IPv4 address**
3. Save

Without this, EC2 instances in the public subnet won't receive a public IP at launch.
Do **not** enable this on `cit270-private`.

---

## Part 3 — Security Groups

Security groups are **stateful virtual firewalls** attached to individual EC2 instances
(technically to the Elastic Network Interface). You write inbound rules; AWS automatically
allows the return traffic.

### 3.1 Create `sg-web` (Web Tier Firewall)

1. **EC2 → Security Groups → Create security group**
2. Name: `sg-web`
3. Description: `Web tier — internet-facing firewall`
4. VPC: `cit270-vpc`

**Inbound rules:**

| Rule # | Type        | Protocol | Port | Source        | Reason                            |
|--------|-------------|----------|------|---------------|-----------------------------------|
| 1      | HTTP        | TCP      | 80   | `0.0.0.0/0`  | Allow HTTP from any internet client |
| 2      | HTTPS       | TCP      | 443  | `0.0.0.0/0`  | Allow HTTPS from any internet client |
| 3      | Custom TCP  | TCP      | 22   | `YOUR_IP/32` | SSH — your IP only, not the world |

To find your IP: `curl ifconfig.me` or visit whatismyip.com. Use the `/32` suffix to
mean "exactly this one address."

**Outbound rules (leave as default):**

| Type        | Protocol | Port | Destination  |
|-------------|----------|------|--------------|
| All traffic | All      | All  | `0.0.0.0/0` |

> **Why is SSH locked to your IP?**  
> Port 22 open to `0.0.0.0/0` means every automated scanner on the internet can
> attempt logins. Even with key-based auth, it generates noise and increases exposure.
> Scoping to `/32` means only one address can even initiate the TCP handshake.

### 3.2 Create `sg-app` (App Tier Firewall)

1. Name: `sg-app`
2. Description: `App tier — accessible from web tier only`
3. VPC: `cit270-vpc`

**Inbound rules:**

| Rule # | Type       | Protocol | Port | Source      | Reason                                     |
|--------|------------|----------|------|-------------|--------------------------------------------|
| 1      | Custom TCP | TCP      | 3000 | `sg-web`    | API access from web tier instances **only** |
| 2      | SSH        | TCP      | 22   | `YOUR_IP/32`| Direct SSH for lab troubleshooting         |

> **Critical:** For rule #1, the source is a **security group ID** (`sg-web`), not a CIDR.
> This means: only EC2 instances that have `sg-web` attached can reach port 3000.
> If someone discovers the app tier's public IP and tries to connect, the SG drops
> the packets — not because of the IP, but because their connection doesn't originate
> from an instance carrying `sg-web`.

**Outbound rules (leave as default):**

| Type        | Protocol | Port | Destination  |
|-------------|----------|------|--------------|
| All traffic | All      | All  | `0.0.0.0/0` |

The default outbound allow is needed so the instance can reach the internet for
package downloads and AWS API calls (SSM, CloudWatch).

### 3.3 Why reference a security group instead of a CIDR?

If you wrote port 3000 source as `10.0.1.0/24` (the public subnet CIDR), then
*any* instance launched in that subnet — whether or not it's the web tier — could reach
the API. Using `sg-web` as the source means only instances explicitly assigned
that security group are allowed. This survives IP changes, auto-scaling, and multi-AZ
deployments without ever updating the rule.

---

## Part 4 — Launch EC2 Instances

The application running on the instances is irrelevant to this section. Focus on the
security-relevant settings at launch time.

### 4.1 App Tier — launch first

You need the app tier's **private IP** to configure the web tier.

1. **EC2 → Launch Instance**
2. Name: `cit270-app-ec2`
3. AMI: `Amazon Linux 2` (free tier)
4. Instance type: `t2.micro`
5. Key pair: select your existing key pair

**Network settings (critical):**

| Setting                   | Value                  | Why                                              |
|---------------------------|------------------------|--------------------------------------------------|
| VPC                       | `cit270-vpc`           | Must be in the lab VPC                           |
| Subnet                    | `cit270-public`        | Public for this lab (private subnet needs NAT)   |
| Auto-assign public IP     | **Enable**             | Needed for direct SSH in this lab                |
| Firewall / Security group | **Select existing: `sg-app`** | Attaches the app tier firewall          |

6. Expand **Advanced details**
7. IAM instance profile: `cit270-lab-ec2-role`
8. Launch

After launch, note the **private IPv4 address** from the instance summary (e.g. `10.0.1.45`).
This is the address the web tier will use to reach the API — it never changes for the
lifetime of the instance, unlike public IPs which can reassign on stop/start.

### 4.2 Web Tier

1. Name: `cit270-web-ec2`
2. AMI: `Amazon Linux 2` | Type: `t2.micro` | same key pair

**Network settings:**

| Setting                   | Value                          |
|---------------------------|-------------------------------|
| VPC                       | `cit270-vpc`                  |
| Subnet                    | `cit270-public`               |
| Auto-assign public IP     | **Enable**                    |
| Security group            | **Select existing: `sg-web`** |

3. IAM instance profile: `cit270-lab-ec2-role`
4. Launch

---

## Part 5 — Firewall Verification

Wait 2–3 minutes for instances to reach the `running` state, then verify the firewall
rules are behaving as configured.

### Test 1: Web tier is reachable from the internet

```bash
# Replace with your web-tier public IP
curl -v http://<web-public-ip>/health
```

Expected: HTTP 200 response  
Why it works: `sg-web` has an inbound rule allowing TCP 80 from `0.0.0.0/0`

### Test 2: App tier port 3000 is blocked from the internet

```bash
curl -v --max-time 5 http://<app-public-ip>:3000/health
```

Expected: **connection times out** (not "connection refused" — the SG drops packets silently)  
Why: `sg-app` has no inbound rule allowing port 3000 from `0.0.0.0/0`

> **Connection timeout vs. connection refused:**  
> "Refused" means the OS got the packet and rejected it (port not listening).  
> "Timeout" means the packet never arrived — the firewall dropped it upstream.  
> Security groups produce timeouts, not refusals.

### Test 3: Web tier CAN reach the app tier

SSH into the web tier, then run the curl from there:

```bash
ssh -i your-key.pem ec2-user@<web-public-ip>

# From inside the web-tier instance:
curl http://<app-private-ip>:3000/health
```

Expected: HTTP 200 response  
Why: the request originates from `cit270-web-ec2` which carries `sg-web` — the source
matches the inbound rule `port 3000 from sg-web` on `sg-app`.

### Test 4: Verify IAM role is attached

```bash
# From inside any instance (uses the IMDSv2 metadata service):
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")

curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/info
```

Expected: JSON showing `"InstanceProfileArn"` with `cit270-lab-ec2-role`.  
If no role is attached, this returns a 404 — the instance cannot call any AWS API.

---

## Part 6 — Firewall Exercises

Each exercise changes exactly one rule so you can observe the isolated effect.
**Always restore the original rule after each exercise.**

### Exercise A — Expose the app tier to the internet

Goal: understand what the `sg-web` source restriction actually prevents.

1. **EC2 → Security Groups → sg-app → Inbound rules → Edit**
2. Change the port-3000 rule source from `sg-web` to `0.0.0.0/0`
3. Save rules

From your laptop:
```bash
curl http://<app-public-ip>:3000/health   # Now succeeds — API exposed to internet
```

Observation: the API is now reachable from any IP on the internet. A port scanner
would find it within minutes. **This is the misconfiguration the lab is designed to prevent.**

4. Revert: change the source back to `sg-web`, save.
5. Re-run the curl — timeout again.

### Exercise B — Sever the web-to-app path

Goal: see what happens to the application when the inter-tier firewall rule is removed.

1. **sg-app → Inbound rules → Edit**
2. Delete the `port 3000 from sg-web` rule entirely
3. Reload the browser — the frontend loads (web tier still reachable) but tasks fail (web tier can no longer reach app tier)
4. From inside the web-tier EC2: `curl http://<app-private-ip>:3000/health` → timeout

Restore the rule. Traffic resumes immediately — security group changes take effect
within seconds, no reboot needed.

### Exercise C — Lock down the web tier HTTP

Goal: observe that `sg-web` controls internet access to the web tier.

1. **sg-web → Inbound rules → Edit**
2. Delete the `port 80 from 0.0.0.0/0` rule
3. Try loading the site in a browser → timeout

The app tier is unaffected — it has no dependency on this rule. This shows that
the two security groups are independent firewalls; changing one does not change the other.

Restore the rule.

### Exercise D — Overly broad SSH (what NOT to do)

This exercise is read-only — do not apply it in a real environment.

Observe that rule #3 on `sg-web` reads:
```
Port 22 | Source: YOUR_IP/32
```

If you changed it to `0.0.0.0/0`, every IP on the internet could attempt SSH connections.
Automated bots scan the entire IPv4 space for port 22 continuously. Even with key-based
auth, this increases your attack surface. The `/32` restriction means only your machine
can initiate the TCP handshake — all other scanners are silently dropped by the SG.

---

## Part 7 — Cleanup

Run in order — security groups cannot be deleted while attached to running instances.

```bash
# Option A: CloudFormation (deletes everything in one command)
aws cloudformation delete-stack --stack-name cit270-lab

# Option B: Manual
# 1. Terminate both instances
aws ec2 terminate-instances --instance-ids <web-id> <app-id>

# 2. Wait for 'terminated' state, then delete security groups
aws ec2 delete-security-group --group-id <sg-app-id>
aws ec2 delete-security-group --group-id <sg-web-id>

# 3. Detach and delete the internet gateway
aws ec2 detach-internet-gateway --internet-gateway-id <igw-id> --vpc-id <vpc-id>
aws ec2 delete-internet-gateway --internet-gateway-id <igw-id>

# 4. Delete subnets, then the VPC
aws ec2 delete-subnet --subnet-id <public-subnet-id>
aws ec2 delete-subnet --subnet-id <private-subnet-id>
aws ec2 delete-vpc --vpc-id <vpc-id>

# 5. Delete the IAM role
aws iam remove-role-from-instance-profile \
  --instance-profile-name cit270-lab-ec2-profile \
  --role-name cit270-lab-ec2-role
aws iam delete-instance-profile --instance-profile-name cit270-lab-ec2-profile
aws iam detach-role-policy --role-name cit270-lab-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
aws iam delete-role --role-name cit270-lab-ec2-role
```

> EC2 instances in the AWS student tier count against an hourly budget.
> Always terminate instances at the end of each lab session.
