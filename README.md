# CIT 270 — AWS Security Lab

Lab documentation from CIT 270. Covers building a two-tier web application on AWS
and securing it with Security Groups, IAM, VPC networking, and S3 bucket policies.
Extended with a serverless visitor counter using Lambda, DynamoDB, API Gateway, and CloudWatch.
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
- How **AWS Lambda** runs event-driven code without servers and how execution roles
  scope its AWS permissions to the minimum required actions
- How **DynamoDB** stores and atomically increments a visitor counter using a single
  item, on-demand billing, and the `ADD` update expression
- How **API Gateway** fronts Lambda with a managed HTTPS endpoint, handles CORS preflight
  with a MOCK integration, and exposes per-stage deployment snapshots
- How **CloudWatch** automatically captures Lambda logs and publishes service metrics,
  and how alarms fire when error thresholds are crossed

---

## Architecture

### Two-Tier Web App (EC2)

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

### Serverless Visitor Counter

```
Browser
   │  GET /visitors (HTTPS)
   ▼
┌─────────────────────────┐
│   API Gateway REST API  │  cit270-visitor-api → stage: prod
└──────────┬──────────────┘
           │  Lambda Proxy Integration
           ▼
┌─────────────────────────┐
│   Lambda Function       │  cit270-visitor-counter (Python 3.12)
│   visitor_counter.py    │  IAM role: scoped to UpdateItem + logs only
└──────────┬──────────────┘
           │  UpdateItem (atomic ADD)
           ▼
┌─────────────────────────┐
│   DynamoDB Table        │  cit270-visitor-counter (PAY_PER_REQUEST)
│   pk = visitor_count    │  Single item, Number attribute
└─────────────────────────┘
           │
           └──→  CloudWatch Logs + Alarms (cit270-lambda-errors, cit270-apigw-4xx)
```

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
| [docs/serverless.md](docs/serverless.md) | Lambda, DynamoDB, API Gateway, and CloudWatch — setup, IAM scoping, atomic increment, alarms |

---

## Repository Structure

```
├── app/
│   ├── frontend/          Static web UI — used to generate traffic for firewall testing
│   ├── backend/           Node.js API — runs on the app tier EC2
│   └── lambda/            Python Lambda function for the serverless visitor counter
├── aws/
│   ├── cloudformation/
│   │   ├── lab-stack.yaml         VPC + SGs + IAM + EC2 (two-tier base lab)
│   │   └── serverless-stack.yaml  Lambda + DynamoDB + API Gateway + CloudWatch
│   ├── iam/               IAM role, trust policy, student policy, Lambda execution policy
│   ├── scripts/           EC2 user-data bootstrap scripts
│   └── security-groups/   Annotated SG rule reference
└── docs/                  Lab writeups and security reference docs
```

---

## Prerequisites

- AWS Academy / Student account with EC2, Lambda, DynamoDB, and API Gateway permissions
- AWS CLI configured (`aws configure`) or AWS Management Console access
- A key pair created in your target region
