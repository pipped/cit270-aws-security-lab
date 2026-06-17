# Security Analysis — AWS Controls

This document explains the reasoning behind each AWS security decision in the lab
and maps each control to the threat it mitigates.

---

## Threat Model

| Threat | AWS Control | How it mitigates |
|--------|-------------|-----------------|
| Direct internet access to the app tier API | `sg-app` inbound rule: port 3000 source = `sg-web` only | Packets from any IP that isn't carrying `sg-web` are silently dropped at the hypervisor level, before reaching the OS |
| Lateral movement from the web tier to unrelated AWS services | IAM instance role: scoped to SSM + CloudWatch only | Even if the web-tier instance is compromised, its credentials can't call S3, RDS, Lambda, EC2, or IAM APIs |
| SSH brute force from the internet | `sg-web` and `sg-app` SSH rules: source = `YOUR_IP/32` | Only one IP address can initiate a TCP handshake on port 22; automated scanners are dropped |
| Privilege escalation via IAM | `DenyIAMEscalation` block in `lab-student-policy.json` | Explicit Deny overrides any Allow — a student cannot create new users, access keys, or roles to escape the account boundary |
| Instance metadata abuse (credential theft via SSRF) | IMDSv2 required | The metadata service at `169.254.169.254` now requires a session token obtained via a PUT request — a simple `curl` fetch of credentials no longer works, which blocks most SSRF-based metadata attacks |
| Overly broad outbound traffic from the app tier | Tightened egress rules (extension exercise) | Limits exfiltration paths if the instance is compromised |

---

## Security Group Architecture

### Why two separate security groups?

Using one security group for both tiers would mean any rule allowing internet traffic
also applies to the app tier. Separate groups let you reason about and audit each
tier's firewall independently.

```
sg-web  ──── cit270-web-ec2
  rules: 80/443 from internet, 22 from YOUR_IP

sg-app  ──── cit270-app-ec2
  rules: 3000 from sg-web, 22 from YOUR_IP
```

If you need to change what the app tier accepts, you edit `sg-app` — it has no effect
on `sg-web` and doesn't require a restart.

### Stateful behavior

Security groups are stateful. When the web tier sends a TCP SYN to port 3000 on the app tier,
AWS tracks that connection. The response packets (SYN-ACK, ACK, data) are automatically
allowed back, even though there is no explicit outbound rule for port 3000 on `sg-app`
or inbound rule for ephemeral ports on `sg-web`.

This is the opposite of NACLs — see [nacl-vs-sg.md](nacl-vs-sg.md) for a full comparison.

### SG-to-SG referencing vs. CIDR

The app tier's port-3000 rule uses `sg-web` as the source, not a CIDR block:

**CIDR approach (fragile):**
```
Allow: TCP 3000 from 10.0.1.0/24
```
This permits any instance in that subnet, regardless of purpose.
If a new instance is launched in the subnet for a different workload, it can also reach port 3000.

**SG reference approach (robust):**
```
Allow: TCP 3000 from sg-web
```
Only instances explicitly assigned `sg-web` can reach the app tier.
The rule survives IP changes, auto-scaling, and multi-AZ deployments without modification.

---

## IAM Configuration

### Trust policy scope

The trust policy on `cit270-lab-ec2-role` restricts the principal to `ec2.amazonaws.com`:

```json
"Principal": { "Service": "ec2.amazonaws.com" }
```

This means no IAM user, Lambda function, or cross-account entity can assume this role.
Only the EC2 service can — and only when attaching it to an instance at launch or via
`associate-iam-instance-profile`.

### Permissions scope

| Permission granted | Scope | Why scoped |
|--------------------|-------|-----------|
| SSM Session Manager | `*` (required by SSM) | SSM endpoint is global; can't narrow by resource |
| CloudWatch Logs write | `/cit270-lab/*` prefix only | Instance can't write to or delete other teams' log groups |
| CloudWatch Logs read | **Not granted** | The instance has no reason to read its own logs via API |

The role does **not** include:
- `ec2:*` — a compromised instance can't launch, stop, or describe other instances
- `s3:*` — no object storage access
- `iam:*` — cannot create users, roles, or access keys to escalate privileges
- `sts:AssumeRole` targeting any other role

### EC2 Instance Metadata Service (IMDSv2)

IAM credentials for the attached role are available at `http://169.254.169.254`.
IMDSv2 adds a required session token step:

```bash
# Step 1: get a session token (requires PUT — a browser-redirect SSRF can't do this)
TOKEN=$(curl -s -X PUT "http://169.254.169.254/latest/api/token" \
  -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")

# Step 2: use the token to retrieve credentials
curl -s -H "X-aws-ec2-metadata-token: $TOKEN" \
  http://169.254.169.254/latest/meta-data/iam/security-credentials/cit270-lab-ec2-role
```

With IMDSv1, the second request alone was enough — an SSRF vulnerability anywhere
in the application could be used to steal the instance's AWS credentials. IMDSv2 breaks
that attack by requiring the session token, which a simple redirect can't produce.

To enforce IMDSv2 at launch:

```bash
aws ec2 run-instances \
  --metadata-options HttpTokens=required,HttpPutResponseHopLimit=1 \
  ...
```

Or in the CloudFormation template:
```yaml
MetadataOptions:
  HttpTokens: required
  HttpPutResponseHopLimit: 1
```

---

## Network Isolation

### Public vs. Private subnets

| Property | cit270-public (10.0.1.0/24) | cit270-private (10.0.2.0/24) |
|----------|-----------------------------|-------------------------------|
| Route to IGW | Yes (`0.0.0.0/0 → igw`) | No |
| Instances get public IP | Yes (auto-assign enabled) | No |
| Reachable from internet | Depends on SG | Never (no route exists) |
| Can initiate outbound to internet | Yes | Only via NAT Gateway |

In this lab, both instances sit in the public subnet for simplicity (the student tier
doesn't include a NAT Gateway cost). The **security group rules alone** prevent
internet-to-app-tier access. In production, the app tier would sit in a private
subnet, adding a second layer of isolation.

### Defense in depth — AWS layers only

```
Internet
   │
   ▼
[Internet Gateway]
   │  Route table allows 0.0.0.0/0 to IGW for public subnet
   ▼
[NACL — subnet boundary, stateless]
   │  Default: allow all. Can add explicit DENY rules here.
   ▼
[Security Group — instance boundary, stateful]
   │  sg-web: allows 80, 443 from internet; 22 from YOUR_IP
   │  sg-app: allows 3000 from sg-web; 22 from YOUR_IP
   ▼
[EC2 Instance]
   │  IAM role limits what AWS APIs the instance can call
   ▼
[IAM / AWS Control Plane]
```

Traffic that reaches an instance has passed through two firewall layers (NACL then SG).
IAM is a separate control plane layer that governs what the instance can *do* in AWS —
it doesn't affect network reachability but limits the blast radius of a compromise.

---

## What This Lab Does Not Cover

These controls are important in production but out of scope for this lab:

| Control | What it does |
|---------|-------------|
| AWS WAF | L7 firewall rules (rate limiting, OWASP rules) on an ALB |
| VPC Flow Logs | Logs all accepted/rejected traffic at the ENI level to CloudWatch or S3 |
| GuardDuty | Threat detection from flow logs, DNS, and CloudTrail — flags unusual traffic patterns |
| AWS Config | Continuous compliance monitoring — alerts if a SG rule changes to allow `0.0.0.0/0` |
| ACM + ALB | TLS termination at the load balancer; EC2 never handles raw TLS |
| Secrets Manager | Rotated credentials instead of static values baked into instance configs |
| Private subnet + NAT GW | True network isolation — app tier has no inbound internet route at the network level |
| SCPs (Service Control Policies) | Organization-wide Deny rules that apply even to account administrators |
