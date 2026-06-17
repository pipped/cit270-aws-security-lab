# CIT 270 — AWS Security Lab

Lab documentation from CIT 270. Covers building a two-tier web application on AWS
and securing it with Security Groups, IAM, VPC networking, and S3 bucket policies.
The focus is on how AWS enforces network and access controls at the infrastructure level.

---

## What I Learned

- How **Security Groups** act as stateful firewalls attached to individual EC2 instances,
  and why referencing a SG as a source is more reliable than using a CIDR block
- How **IAM roles and trust policies** give EC2 instances scoped AWS permissions
  without hardcoding credentials, and how an explicit `Deny` beats any `Allow`
- How **VPC networking** — CIDR blocks, subnets, route tables, Internet Gateways, NAT Gateways,
  and VPC Endpoints — controls what traffic can even reach an instance before the SG fires
- The difference between **stateful (SG) and stateless (NACL)** firewalls and when each is appropriate
- How **S3 bucket policies and Block Public Access** control who can read or write objects,
  and why a misconfigured bucket is one of the most common AWS security incidents
- The **defense-in-depth** model: IGW → NACL → Security Group → IAM, and how each
  layer limits blast radius independently of the others

---

## Architecture

```
Internet
   │
   │  HTTP/HTTPS (port 80/443)
   ▼
┌─────────────────────────┐       sg-web
│   Web Tier (EC2)        │  allows: 80, 443 from 0.0.0.0/0
│   nginx + static files  │  allows: 22 from YOUR_IP/32
│   Public subnet         │
└──────────┬──────────────┘
           │
           │  port 3000 (sg-web → sg-app only)
           ▼
┌─────────────────────────┐       sg-app
│   App Tier (EC2)        │  allows: 3000 from sg-web ONLY
│   Node.js / Express     │  allows: 22 from YOUR_IP/32
│   Public subnet*        │  blocks: 3000 from internet
└─────────────────────────┘

* In production the app tier sits in a private subnet behind a NAT gateway.
```

The core firewall rule: the app tier's port 3000 source is set to `sg-web` (a security group
reference, not a CIDR). Any connection that doesn't originate from an instance carrying
`sg-web` is dropped at the hypervisor — the OS never sees the packet.

---

## Documentation

| Document | Contents |
|----------|---------|
| [docs/lab-guide.md](docs/lab-guide.md) | IAM, VPC, security group, and EC2 configuration steps with firewall verification exercises |
| [docs/aws-firewall-reference.md](docs/aws-firewall-reference.md) | All SG rules, IAM permissions, route tables, and a full traffic matrix |
| [docs/vpc.md](docs/vpc.md) | VPC networking — CIDR, subnets, IGW, NAT, route tables, endpoints, peering, and flow logs |
| [docs/s3-security.md](docs/s3-security.md) | S3 bucket policies, Block Public Access, encryption, and access control |
| [docs/security-analysis.md](docs/security-analysis.md) | Threat model, IAM reasoning, IMDSv2, and defense-in-depth breakdown |
| [docs/nacl-vs-sg.md](docs/nacl-vs-sg.md) | Stateful vs. stateless firewalls, rule evaluation order, packet walkthrough |

---

## Repository Structure

```
├── app/
│   ├── frontend/          Static web UI — used to generate traffic for firewall testing
│   └── backend/           Node.js API — runs on the app tier EC2
├── aws/
│   ├── cloudformation/    One-command stack deploy (VPC + SGs + IAM + EC2)
│   ├── iam/               IAM role, trust policy, and student policy JSON
│   ├── scripts/           EC2 user-data bootstrap scripts
│   └── security-groups/   Annotated SG rule reference
└── docs/                  Lab writeups and security reference docs
```

---

## Deploy

**CloudFormation (one command):**

```bash
aws cloudformation deploy \
  --template-file aws/cloudformation/lab-stack.yaml \
  --stack-name cit270-lab \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    KeyPairName=YOUR_KEY_PAIR \
    YourIP=$(curl -s ifconfig.me)/32
```

**Manual setup:** follow [docs/lab-guide.md](docs/lab-guide.md).

---

## Prerequisites

- AWS Academy / Student account with EC2 and IAM permissions
- AWS CLI configured (`aws configure`) or AWS Management Console access
- A key pair created in your target region
