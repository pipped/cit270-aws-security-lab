# NACLs vs. Security Groups

Both are AWS firewall mechanisms, but they operate at different layers
and have fundamentally different behaviour.

## Quick Reference

| Question | Security Group | NACL |
|----------|---------------|------|
| Where does it apply? | To an ENI (elastic network interface) | To a subnet |
| Is it stateful? | Yes — return traffic is auto-allowed | No — must allow inbound AND outbound |
| How are rules evaluated? | ALL rules evaluated, most permissive wins | Rules evaluated lowest-number-first, stops at first match |
| Can you DENY traffic? | No — only ALLOW rules exist | Yes — explicit DENY rules |
| Default behavior | Deny all inbound, allow all outbound | Allow all in both directions |

## When to use each

Use **Security Groups** for per-instance controls — this is the primary tool.
Reference other SGs as sources to avoid IP churn (e.g. `sg-web` → `sg-app`).

Use **NACLs** as a secondary perimeter — e.g. to explicitly block a known-bad IP
range at the subnet level before it even reaches the instance security group.

## Stateful vs. Stateless example

```
Web → App request: TCP 10.0.1.10:52341 → 10.0.2.20:3000

Security Group (stateful):
  Outbound rule on web-SG: allows 3000 to sg-app ✓
  Return packets automatically allowed — no rule needed ✓

NACL (stateless):
  Subnet outbound: must allow TCP 3000 to 10.0.2.0/24 ✓
  Subnet inbound: must allow ephemeral ports 1024-65535 from 10.0.2.0/24 ✓
  (ephemeral = the random source port the server responds to)
  Missing either rule → traffic drops
```

## Lab extension

To see NACLs in action:
1. Go to **VPC → Network ACLs → Create network ACL** for the public subnet
2. Add a DENY inbound rule for your own IP (rule number 50, before the ALLOW rules)
3. Notice that even though `sg-web` allows your IP on port 80, the NACL blocks you first
4. Remove the DENY rule — traffic flows again

This shows the order: traffic hits the NACL at the subnet boundary first,
then the security group at the instance.
