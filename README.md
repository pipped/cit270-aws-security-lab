# CIT 270 — AWS Full-Stack Security Lab

A hands-on lab that builds a two-tier web application on AWS EC2 and uses
**Security Groups as virtual firewalls** to control traffic between tiers.
IAM roles enforce least-privilege access for the EC2 instances themselves.

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

* Both instances use the same public subnet in this lab for simplicity.
  In production the app tier would sit in a private subnet behind a NAT gateway.
```

**Key firewall rule:** The app tier's port 3000 is open only to the `sg-web` security group,
not to the internet. Trying to hit `http://<app-public-ip>:3000` from a browser fails.

---

## Lab Objectives

1. Launch two EC2 instances with distinct security groups
2. Observe how SG rules act as stateful firewalls between tiers
3. Attach an IAM instance role (least-privilege) to each instance
4. Deploy a Node.js API (app tier) and nginx frontend (web tier)
5. Verify firewall rules by intentionally breaking and restoring them

---

## Quick Start

### Option A — CloudFormation (automated)

```bash
aws cloudformation deploy \
  --template-file aws/cloudformation/lab-stack.yaml \
  --stack-name cit270-lab \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    KeyPairName=YOUR_KEY_PAIR \
    YourIP=$(curl -s ifconfig.me)/32
```

Stack outputs give you the web tier public IP and app tier private IP.

### Option B — Manual (follow the lab guide)

See [docs/lab-guide.md](docs/lab-guide.md) for step-by-step console instructions.

---

## Documentation

| Document | Contents |
|----------|---------|
| [docs/lab-guide.md](docs/lab-guide.md) | Step-by-step IAM, VPC, security group, and EC2 setup with firewall verification exercises |
| [docs/aws-firewall-reference.md](docs/aws-firewall-reference.md) | Full rule tables for every SG, IAM policy, route table, and traffic matrix in one place |
| [docs/security-analysis.md](docs/security-analysis.md) | Threat model, IAM reasoning, IMDSv2, and defense-in-depth breakdown |
| [docs/nacl-vs-sg.md](docs/nacl-vs-sg.md) | Stateful vs. stateless firewalls, rule evaluation order, and hands-on NACL exercise |

## Repository Structure

```
├── app/
│   ├── frontend/          Static web UI — used to generate verifiable traffic
│   └── backend/           Node.js API — runs on the app tier EC2
├── aws/
│   ├── cloudformation/    One-command stack deploy (VPC + SGs + IAM + EC2)
│   ├── iam/               IAM role, trust policy, and student policy JSON
│   ├── scripts/           EC2 user-data bootstrap scripts
│   └── security-groups/   Annotated SG rule reference
└── docs/                  All security and firewall documentation (see table above)
```

---

## Prerequisites

- AWS Academy / Student account with EC2 and IAM permissions
- AWS CLI configured (`aws configure`) **or** AWS Management Console
- A key pair created in your target region
- Git

---

## Running Locally (without AWS)

```bash
# App tier
cd app/backend
npm install
node server.js          # API on http://localhost:3000

# Web tier (open in browser — no server needed)
open app/frontend/index.html
# The JS defaults API_BASE to http://localhost:3000
```

---

## License

MIT — free to use and adapt for coursework.
