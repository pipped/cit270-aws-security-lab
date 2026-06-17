# VPC — Virtual Private Cloud

A VPC is a logically isolated network inside AWS. Every resource you launch — EC2, RDS,
Lambda inside a subnet — lives inside one. Understanding VPC structure is what lets you
reason about why traffic can or can't flow between resources and the internet.

---

## Core Concepts

### CIDR Blocks

When you create a VPC you assign it an IPv4 CIDR block. This defines the private
address space all resources inside the VPC draw from.

```
10.0.0.0/16  →  10.0.0.0 – 10.0.255.255  (65,536 addresses)
10.0.0.0/24  →  10.0.0.0 – 10.0.0.255   (256 addresses)
10.0.0.0/32  →  10.0.0.0 only            (single host)
```

The `/` number is the prefix length — the larger it is, the smaller the range.
AWS requires VPC CIDRs between `/16` and `/28`.

AWS reserves 5 addresses in every subnet (first 4 and the last):

```
10.0.1.0   — network address
10.0.1.1   — AWS VPC router
10.0.1.2   — AWS DNS
10.0.1.3   — reserved for future use
10.0.1.255 — broadcast (AWS doesn't use it but reserves it)
```

A `/24` subnet gives you 256 − 5 = **251 usable addresses**.

### What makes a subnet public vs. private

The word "public" and "private" aren't AWS settings on the subnet itself — they
describe whether instances in that subnet can communicate with the internet.
A subnet is effectively public if:

1. Its route table has a route sending `0.0.0.0/0` to an **Internet Gateway**
2. Instances in it are assigned a public IP

Remove either condition and the subnet becomes private. That's all there is to it.

---

## Internet Gateway (IGW)

The IGW is the VPC component that enables bidirectional traffic between the VPC
and the public internet. One IGW per VPC; it scales automatically.

```
EC2 instance (10.0.1.10, public IP 54.x.x.x)
      │  sends packet to 8.8.8.8
      ▼
Route table: 0.0.0.0/0 → igw-xxxxxxxx
      │
      ▼
IGW: performs 1:1 NAT — translates 10.0.1.10 to 54.x.x.x on outbound,
     and 54.x.x.x back to 10.0.1.10 on inbound response
      │
      ▼
Internet
```

Without an IGW attached to the VPC, no traffic crosses the VPC boundary regardless
of what the route table says.

---

## NAT Gateway

A NAT Gateway lets instances in a **private subnet** initiate outbound internet traffic
(package installs, API calls) without being reachable from the internet.

```
Private EC2 (10.0.2.10, no public IP)
      │  needs to reach the internet
      ▼
Route table (private subnet): 0.0.0.0/0 → nat-xxxxxxxx
      │
      ▼
NAT Gateway (lives in the PUBLIC subnet, has an Elastic IP)
      │  many-to-one NAT — translates all private IPs to its Elastic IP
      ▼
IGW → Internet
```

Return traffic flows back through the NAT Gateway to the originating private instance.
Inbound connections initiated from the internet can't reach the private instance
because the NAT Gateway doesn't forward unsolicited inbound packets — there's no
port mapping like a traditional NAT router.

**Key differences from IGW:**

| | IGW | NAT Gateway |
|-|-----|-------------|
| Direction | Inbound and outbound | Outbound only |
| Placement | VPC-level | Must be in a public subnet |
| Public IP | Instance gets its own Elastic IP | NAT GW has one Elastic IP shared by all private instances |
| Cost | Free | ~$0.045/hr + data transfer |

In this lab the app tier sits in the public subnet because NAT Gateway has a cost. In
production it would be in the private subnet with a NAT Gateway handling outbound traffic.

---

## Route Tables

Every subnet is associated with exactly one route table. The route table is evaluated
for every packet leaving a subnet — AWS picks the most specific matching route.

**Lab public subnet route table (`cit270-public-rt`):**

| Destination | Target | Meaning |
|-------------|--------|---------|
| `10.0.0.0/16` | `local` | All intra-VPC traffic stays inside the VPC |
| `0.0.0.0/0` | `igw-xxxxxxxx` | Everything else goes to the internet |

**Lab private subnet (default route table — no IGW route):**

| Destination | Target | Meaning |
|-------------|--------|---------|
| `10.0.0.0/16` | `local` | Intra-VPC only — no internet route exists |

The `local` route is implicit and can't be deleted. It's what allows an EC2 instance
in `10.0.1.0/24` to reach an RDS instance in `10.0.2.0/24` without going through the IGW.

**Longest prefix match:**  
If a packet matches multiple routes, AWS picks the most specific one (longest prefix).
A route for `10.0.1.5/32` wins over `10.0.1.0/24` which wins over `0.0.0.0/0`.

---

## VPC Endpoints

By default, AWS service calls (S3, DynamoDB, SSM) leave the VPC, go to the internet,
and come back through the IGW. VPC Endpoints keep that traffic inside the AWS network.

### Gateway Endpoint (S3 and DynamoDB only)

A free endpoint that adds a route to the route table pointing S3/DynamoDB traffic
directly to the AWS backbone instead of through the IGW.

```bash
aws ec2 create-vpc-endpoint \
  --vpc-id vpc-xxxxxxxx \
  --service-name com.amazonaws.us-east-1.s3 \
  --route-table-ids rtb-xxxxxxxx
```

The route table gains an entry like:
```
pl-xxxxxxxx (S3 prefix list)  →  vpce-xxxxxxxx
```

After this, `aws s3 cp ...` from an EC2 instance never touches the internet.
You can then add a bucket policy that denies access unless `aws:SourceVpce` matches
your endpoint — meaning even someone with valid IAM creds can't access the bucket
from outside the VPC.

### Interface Endpoint (PrivateLink)

For other services (SSM, CloudWatch, EC2 API, etc.), Interface Endpoints provision
an ENI with a private IP in your subnet. Traffic to that service resolves to the
private IP via DNS and stays on the AWS backbone.

Cost: ~$0.01/hr per AZ per endpoint. Worth it in production to avoid IGW dependency
and to enable private subnet access to AWS APIs without a NAT Gateway.

---

## VPC Peering

VPC Peering connects two VPCs so instances in each can communicate using private IPs,
as if they were in the same network. Traffic stays on the AWS backbone.

```
VPC A (10.0.0.0/16)  ←──── peering connection ────→  VPC B (172.16.0.0/16)
```

After creating the peering connection, you add routes in both VPCs:

```
VPC A route table: 172.16.0.0/16 → pcx-xxxxxxxx
VPC B route table: 10.0.0.0/16  → pcx-xxxxxxxx
```

**Limitations:**
- Not transitive — if A peers with B and B peers with C, A cannot reach C through B
- CIDRs cannot overlap between peered VPCs
- Security groups in one VPC can reference security groups in the peered VPC (same region only)

---

## VPC Flow Logs

Flow Logs capture metadata for every accepted and rejected network flow through
the VPC, a subnet, or a specific ENI. They don't capture packet contents — just
the 5-tuple (source IP, dest IP, source port, dest port, protocol), action, and bytes.

```
version account-id interface-id srcaddr dstaddr srcport dstport protocol packets bytes start end action log-status
2 123456789012 eni-abc123 10.0.1.10 10.0.2.20 52341 3000 6 10 840 1609459200 1609459260 ACCEPT OK
2 123456789012 eni-abc123 203.0.113.5 10.0.1.10 44231 22 6 3 120 1609459200 1609459210 REJECT OK
```

The second record shows a REJECT — someone at `203.0.113.5` tried to reach port 22
and was blocked by the security group. Without flow logs, you'd never know the attempt happened.

**Enable on the VPC:**
```bash
aws ec2 create-flow-logs \
  --resource-type VPC \
  --resource-ids vpc-xxxxxxxx \
  --traffic-type ALL \
  --log-destination-type cloud-watch-logs \
  --log-group-name /cit270-lab/vpc-flow-logs \
  --deliver-logs-permission-arn arn:aws:iam::ACCOUNT:role/flow-logs-role
```

`--traffic-type` options:
- `ACCEPT` — only log traffic that was allowed
- `REJECT` — only log traffic that was blocked (useful for detecting scans)
- `ALL` — both (most useful for security investigations)

---

## DNS Inside a VPC

Every VPC gets an internal DNS resolver at the second IP of the VPC CIDR
(e.g., `10.0.0.2` for a `10.0.0.0/16` VPC). Two settings control DNS behavior:

| Setting | What it controls |
|---------|-----------------|
| `enableDnsSupport` | Whether the VPC resolver is active. Default: enabled. |
| `enableDnsHostnames` | Whether EC2 instances get `ec2-x-x-x-x.compute-1.amazonaws.com` DNS names. Default: disabled on custom VPCs. |

Both must be enabled for VPC Endpoints to work (the endpoint injects DNS entries
that resolve the AWS service name to a private IP).

---

## Lab VPC Summary

| Resource | Value | Purpose |
|----------|-------|---------|
| VPC CIDR | `10.0.0.0/16` | Private address space for all lab resources |
| Public subnet | `10.0.1.0/24` | Web tier EC2 — has IGW route and public IP |
| Private subnet | `10.0.2.0/24` | Intended for app tier in production |
| Internet Gateway | `cit270-igw` | Allows public subnet to reach/be reached from internet |
| Public route table | `0.0.0.0/0 → igw` | Sends internet-bound traffic from public subnet to IGW |
| Private route table | `10.0.0.0/16 → local` | No IGW route — intra-VPC only |

The security groups (`sg-web`, `sg-app`) are the per-instance firewall on top of this
network layout. The VPC and route tables determine what's *routable*; the security groups
determine what's *allowed* once a packet arrives at the instance.
