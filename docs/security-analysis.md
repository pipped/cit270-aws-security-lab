# Security Analysis — CIT 270 Lab

## Threat Model

| Threat | Mitigation |
|--------|-----------|
| Direct API access from internet | `sg-app` blocks port 3000 from `0.0.0.0/0` |
| Lateral movement from web tier to other resources | IAM role has no permissions beyond logs + SSM |
| SSH brute force | SSH rule scoped to `YOUR_IP/32` only |
| Privilege escalation via IAM | `DenyIAMEscalation` block in lab student policy |
| Malicious input / SQL injection | Input sanitized and length-capped in Express routes; parameterized SQLite queries |
| XSS via task titles | `escapeHtml()` in frontend JS before rendering |

---

## Security Group: Stateful Firewall

Security groups track connection state. When the web tier sends a request to port 3000
on the app tier, AWS automatically allows the response packets back — you don't write
a return rule. This is a **stateful** firewall.

### Contrast: Network ACLs (stateless)

NACLs operate at the subnet level and are stateless — you must explicitly allow
both inbound and outbound (and ephemeral port ranges) for traffic to flow.

| Property         | Security Group          | Network ACL           |
|------------------|-------------------------|-----------------------|
| Level            | Instance (ENI)          | Subnet                |
| State            | Stateful                | Stateless             |
| Default          | Deny all inbound        | Allow all             |
| Rule evaluation  | All rules evaluated     | Rules evaluated in order (stop on match) |
| Best for         | Per-instance firewall   | Subnet-level guard    |

---

## IAM Least Privilege

The EC2 instance role (`cit270-lab-ec2-role`) has:

- **SSM Session Manager** — allows shell access without opening port 22 to the internet
- **CloudWatch Logs (scoped to `/cit270-lab/*`)** — instance can write logs but cannot
  read or delete log groups outside the lab prefix

It does NOT have:
- S3, RDS, Lambda, or any service it doesn't need
- `ec2:*` — the instance can't launch or modify other instances
- `iam:*` — cannot escalate its own permissions

---

## Defense in Depth

This lab demonstrates layered security:

1. **Layer 1 — IAM:** Restricts what the EC2 instances can do in the AWS control plane
2. **Layer 2 — Security Groups:** Controls which network traffic reaches each instance
3. **Layer 3 — Application:** Input validation and parameterized queries in Express
4. **Layer 4 — OS:** Runs as `ec2-user` (non-root), systemd unit can't write outside `/opt/lab`

No single layer is enough. If the Express app had a code execution bug, the attacker
would still be constrained by the IAM role (can't call AWS APIs) and the security group
(can't reach other hosts on the internet freely).

---

## What This Lab Does NOT Cover (extension topics)

- **HTTPS / TLS** — add an ACM certificate and Application Load Balancer
- **WAF** — AWS WAF on the ALB for OWASP rule groups
- **VPC Flow Logs** — log all accepted/rejected traffic to CloudWatch
- **GuardDuty** — threat detection based on flow logs + DNS queries
- **Secrets Manager** — replace hardcoded DB paths with rotated secrets
- **Private subnet + NAT gateway** — true network isolation for the app tier
