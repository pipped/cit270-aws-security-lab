# NACLs vs. Security Groups

AWS provides two distinct firewall mechanisms in a VPC. They operate at different network
layers and have fundamentally different traffic evaluation models. Understanding both is
required to reason about why traffic is allowed or blocked.

---

## Comparison Table

| Property | Security Group | Network ACL (NACL) |
|----------|---------------|-------------------|
| Attachment point | ENI (elastic network interface) on each instance | Subnet |
| Scope | Per instance | All instances in the subnet |
| State | **Stateful** — return traffic auto-allowed | **Stateless** — must explicitly allow both directions |
| Rule types | Allow only — no Deny | Allow and Deny |
| Rule evaluation | All rules evaluated simultaneously; most permissive wins | Rules evaluated in ascending number order; first match stops evaluation |
| Default (new) | Deny all inbound, allow all outbound | Allow all inbound and outbound |
| Default (existing VPC) | N/A | Allow all (AWS default NACL) |
| Applies to | Traffic entering/leaving an instance | Traffic entering/leaving a subnet |
| Granularity | Can reference other SGs as source/destination | CIDR only — no SG references |

---

## Packet flow through both layers

A packet from the internet to port 80 on the web-tier EC2 passes through:

```
Internet
   │
   ▼
1. NACL (inbound) — evaluated at the subnet boundary
   │  Is there a rule matching TCP 80 from 0.0.0.0/0?
   │  Default NACL: rule 100 → allow all → YES, continue
   ▼
2. Security Group (inbound) — evaluated at the instance ENI
   │  Is there an inbound rule allowing TCP 80 from 0.0.0.0/0?
   │  sg-web: YES → packet delivered to the instance
   ▼
3. Instance OS receives the packet
```

Response packet from the instance back to the internet:

```
Instance OS sends response
   │
   ▼
1. Security Group (outbound) — STATEFUL
   │  SG already knows this is a return packet for an established connection
   │  Automatically allowed — no outbound rule check needed
   ▼
2. NACL (outbound) — STATELESS
   │  Must check outbound rules explicitly
   │  Default NACL: rule 100 → allow all → YES, continue
   ▼
Internet
```

If you created a **custom NACL** with restrictive rules, you must add an outbound
rule allowing the ephemeral port range (1024–65535) for return traffic to flow.
Security groups handle this automatically.

---

## Stateful vs. Stateless — concrete example

```
Web tier (10.0.1.10) contacts app tier (10.0.2.20) on port 3000.
The web OS picks ephemeral source port 52341.

TCP flow: 10.0.1.10:52341 → 10.0.2.20:3000   (request)
          10.0.2.20:3000  → 10.0.1.10:52341   (response)

─────────────────────────────────────────────────────────
Security Group evaluation (stateful):

  sg-app inbound:  allow TCP 3000 from sg-web  ✓  request accepted
  sg-web outbound: allow all traffic            ✓  response auto-allowed (stateful)
  ← No rule for ephemeral 52341 needed. SG tracks the session.

─────────────────────────────────────────────────────────
NACL evaluation (stateless) — if you add a custom NACL:

  NACL on private-subnet inbound:   allow TCP 3000 from 10.0.1.0/24  ✓
  NACL on private-subnet outbound:  allow TCP 1024-65535 to 10.0.1.0/24  ✓
  ← Both directions must be explicit. Missing either drops the traffic.
  ← Ephemeral port range (1024-65535) must be allowed, not just port 3000.
```

---

## Rule evaluation order — NACL specifics

NACLs evaluate rules in ascending rule-number order and stop at the first match.
Rule numbers are arbitrary integers you assign (typically in increments of 10 or 100
to leave room for insertions).

Example: explicitly blocking a known-bad IP before the broad allow-all rule

```
Rule 50  | DENY  | TCP 80 | Source: 203.0.113.5/32  | ← drop this attacker IP
Rule 100 | ALLOW | TCP 80 | Source: 0.0.0.0/0        | ← allow everyone else
Rule *   | DENY  | All    | Source: 0.0.0.0/0        | ← AWS implicit deny (always last)
```

Packet from `203.0.113.5` → hits rule 50 → DENIED, evaluation stops.  
Packet from any other IP → skips rule 50 (no match) → hits rule 100 → ALLOWED.

If you reversed the rule numbers (100 first, then 50), every packet would match
rule 100 and be allowed — the deny at rule 150 would never be reached.

Security groups do not work this way: all rules are evaluated, and if any rule allows
the packet, it is allowed. You **cannot** block a specific IP with a security group.
For IP-level blocking, use a NACL or AWS WAF.

---

## When to use each

**Security groups — primary per-instance firewall**

- Control traffic to individual instances or sets of instances
- Use SG-to-SG references to scope inter-tier traffic without IP management
- Always write the minimum inbound rules needed; leave out any port not actively used

**NACLs — subnet-level guard, secondary layer**

- Block specific IP ranges or CIDRs across an entire subnet
- Add an explicit DENY ahead of a broad ALLOW when you need to exclude known-bad addresses
- Use when the SG cannot satisfy the requirement (e.g., explicit Deny)
- Remember to write both inbound and outbound rules for stateless flows

---

## Lab exercise — see both in action

### NACL blocking your own IP (even though the SG allows it)

1. **VPC → Network ACLs → Create network ACL**
   - Name: `cit270-test-nacl`
   - VPC: `cit270-vpc`
2. Associate it with `cit270-public` subnet
3. Add inbound rule:
   - Rule #: `50`
   - Type: HTTP (TCP 80)
   - Source: your IP `/32`
   - Allow/Deny: **DENY**
4. Add inbound rule:
   - Rule #: `100`
   - Type: HTTP (TCP 80)
   - Source: `0.0.0.0/0`
   - Allow/Deny: Allow
5. Add outbound rule:
   - Rule #: `100`
   - All traffic → `0.0.0.0/0` → Allow

**Result:** Loading `http://<web-public-ip>` from your browser times out — even though
`sg-web` explicitly allows port 80 from your IP. The NACL fires first and drops the packet
before it reaches the SG.

6. Delete the DENY rule (or disassociate the NACL) — traffic restores immediately.

This demonstrates the evaluation order: **NACL before Security Group**,
and that a Deny at the NACL layer cannot be overridden by an Allow at the SG layer.
