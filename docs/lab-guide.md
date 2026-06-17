# Lab Guide — Step-by-Step Manual Setup

Estimated time: 60–90 minutes

---

## Part 1 — IAM Setup

### 1.1 Create the EC2 Instance Role

1. In the AWS Console, go to **IAM → Roles → Create role**
2. Trusted entity: **AWS Service → EC2**
3. Attach managed policy: `AmazonSSMManagedInstanceCore`
4. Add inline policy from `aws/iam/ec2-instance-role-policy.json`
5. Name the role: `cit270-lab-ec2-role`

This role lets the instances push logs to CloudWatch and use Session Manager
(so you can shell in without opening SSH if you prefer).

### 1.2 (Optional) Restrict your lab user

If using a shared AWS account or you want to practice least-privilege,
apply `aws/iam/lab-student-policy.json` to your IAM user.
The `DenyIAMEscalation` block prevents privilege escalation via IAM.

> **Discussion:** Why does the EC2 role NOT include `ec2:*` or `s3:*`?
> Least privilege means only granting what the workload actually needs.
> If the instance is compromised, a minimal role limits the blast radius.

---

## Part 2 — VPC and Networking

Use the default VPC or create a new one (`10.0.0.0/16`).

For this lab a new VPC makes the security group behaviour clearer.
The CloudFormation template creates the full VPC for you (Part 5).

---

## Part 3 — Security Groups

### 3.1 Create `sg-web`

1. **EC2 → Security Groups → Create security group**
2. Name: `sg-web` | VPC: your lab VPC
3. Add inbound rules:
   - Type: HTTP | Port: 80 | Source: `0.0.0.0/0`
   - Type: HTTPS | Port: 443 | Source: `0.0.0.0/0`
   - Type: Custom TCP | Port: 22 | Source: **your IP** (`x.x.x.x/32`)
4. Leave outbound: all traffic (default)

### 3.2 Create `sg-app`

1. Name: `sg-app` | VPC: same VPC
2. Add inbound rules:
   - Type: Custom TCP | Port: 3000 | Source: **select `sg-web`** (not a CIDR!)
   - Type: SSH | Port: 22 | Source: your IP
3. Outbound: all traffic (default — needed for package installs)

> **Lab question:** What happens if you set the port-3000 source to `0.0.0.0/0`?
> Test it in Part 6.

---

## Part 4 — Launch EC2 Instances

### 4.1 App Tier (launch this first — you need its private IP for the web tier)

1. **EC2 → Launch Instance**
2. Name: `cit270-app-ec2`
3. AMI: Amazon Linux 2
4. Instance type: `t2.micro` (free tier)
5. Key pair: your existing key pair
6. Network settings:
   - VPC: your lab VPC
   - Subnet: public subnet
   - Auto-assign public IP: **Enable** (for SSH access; in production: disable)
   - Security group: `sg-app`
7. Advanced → IAM instance profile: `cit270-lab-ec2-role`
8. User data: paste contents of `aws/scripts/user-data-app.sh`
9. Launch

Note the **private IP** from the instance summary (e.g. `10.0.1.45`).

### 4.2 Web Tier

1. Name: `cit270-web-ec2`
2. AMI, type, key pair: same as above
3. Security group: `sg-web`
4. IAM profile: same role
5. User data: paste `aws/scripts/user-data-web.sh`, replacing `REPLACE_ME` with the app tier private IP
6. Launch

---

## Part 5 — Verify the Deployment

Wait ~3 minutes for user-data to finish, then:

```bash
# From your laptop:
curl http://<web-public-ip>/health     # Should return {"status":"ok"}

curl http://<app-public-ip>:3000/health  # Should TIMEOUT (sg-app blocks 3000 from internet)
```

Open `http://<web-public-ip>` in a browser — you should see the Task Manager UI.

SSH into the web tier and verify it can reach the app tier:
```bash
ssh -i your-key.pem ec2-user@<web-public-ip>
curl http://<app-private-ip>:3000/health   # Should return {"status":"ok"}
```

---

## Part 6 — Firewall Exercises

### Exercise A: Break the firewall, observe the effect

1. Go to `sg-app` → Edit inbound rules
2. Add: Custom TCP | 3000 | 0.0.0.0/0
3. From your laptop: `curl http://<app-public-ip>:3000/health`
4. Now it responds — the app tier API is exposed to the internet
5. **Remove the rule** — verify it breaks again

### Exercise B: Block the web-to-app path

1. Remove the `sg-web → port 3000` rule from `sg-app`
2. Reload the browser — tasks fail to load (web tier can no longer reach app tier)
3. Restore the rule

### Exercise C: Block HTTP to the web tier

1. Remove the `0.0.0.0/0 → port 80` rule from `sg-web`
2. Browser times out — no inbound HTTP allowed
3. Restore it

---

## Part 7 — Cleanup

```bash
# Delete the CloudFormation stack (deletes everything):
aws cloudformation delete-stack --stack-name cit270-lab

# Or manually:
# 1. Terminate both EC2 instances
# 2. Delete security groups sg-web, sg-app
# 3. Delete the IAM role cit270-lab-ec2-role
# 4. Delete the VPC (if you created a new one)
```

> Always clean up — EC2 instances in the student tier have hour limits.
