# Security Group Rules — CIT 270 Lab

Security groups in AWS are **stateful firewalls** — return traffic is automatically allowed,
so you only write inbound rules. Compare this to NACLs (stateless) covered in Part 4.

---

## sg-web (Web Tier)

Attached to: `cit270-web-ec2`

### Inbound

| Port | Protocol | Source          | Purpose                                |
|------|----------|-----------------|----------------------------------------|
| 80   | TCP      | 0.0.0.0/0       | HTTP traffic from any internet client  |
| 443  | TCP      | 0.0.0.0/0       | HTTPS (enable after adding TLS cert)   |
| 22   | TCP      | YOUR_IP/32      | SSH — restrict to your IP only         |

### Outbound

| Port | Protocol | Destination     | Purpose                                |
|------|----------|-----------------|----------------------------------------|
| 3000 | TCP      | sg-app          | Reach the app tier API                 |
| 443  | TCP      | 0.0.0.0/0       | yum/apt updates, git clone             |
| 80   | TCP      | 0.0.0.0/0       | yum/apt updates (fallback)             |

> **Why not open outbound to all?**  
> Limiting egress prevents a compromised web server from reaching arbitrary internet hosts
> or exfiltrating data. Only the ports the tier actually needs should be open.

---

## sg-app (App Tier)

Attached to: `cit270-app-ec2`

### Inbound

| Port | Protocol | Source          | Purpose                                      |
|------|----------|-----------------|----------------------------------------------|
| 3000 | TCP      | sg-web          | API calls from the web tier **only**         |
| 22   | TCP      | YOUR_IP/32      | SSH — direct from your IP (or use SSM)       |

> **Key point:** Port 3000 is NOT open to `0.0.0.0/0`. An attacker who discovers
> the app-tier IP cannot reach the API directly — they'd have to go through the web tier.

### Outbound

| Port | Protocol | Destination | Purpose              |
|------|----------|-------------|----------------------|
| 443  | TCP      | 0.0.0.0/0  | Package downloads    |
| 80   | TCP      | 0.0.0.0/0  | Package downloads    |

---

## Source-based vs. CIDR-based rules

In the `sg-app` inbound rule, the source is **sg-web** (a security group ID), not a CIDR.
This means only EC2 instances that have `sg-web` attached can reach port 3000 —
even if someone spun up another instance in the same VPC with the app tier's private IP,
they still couldn't connect.

This is a core AWS security pattern: **reference SGs, not IPs**, wherever possible.

---

## Lab verification steps

1. Copy the app tier's **public IP** and try `curl http://<app-public-ip>:3000/health`  
   → Should **timeout or refuse** (no inbound rule for 3000 from internet).

2. Open the web tier's **public IP** in a browser → app should load and tasks should work.

3. SSH into the web tier and run `curl http://<app-private-ip>:3000/health`  
   → Should return `{"status":"ok"}` (web SG → app SG allowed).

4. Add an inbound rule to `sg-app` allowing 3000 from `0.0.0.0/0`, repeat step 1  
   → Now it works. **Remove that rule** and observe it breaks again.  
   This demonstrates how security groups act as a virtual firewall.
