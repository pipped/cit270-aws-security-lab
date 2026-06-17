#!/bin/bash
# EC2 User Data — App Tier (runs as root on first boot)
# Installs Node.js and starts the Express API on port 3000.
# This instance has NO inbound rule for port 3000 from 0.0.0.0/0 —
# only the web-tier security group is allowed in.

set -euo pipefail
WEB_ORIGIN="${WEB_ORIGIN:-*}"   # set to the web-tier's public DNS in production

yum update -y
curl -fsSL https://rpm.nodesource.com/setup_18.x | bash -
yum install -y nodejs git

git clone https://github.com/YOUR_USERNAME/cit270-aws-security-lab.git /opt/lab
cd /opt/lab/app/backend
npm install --production

# Systemd service so the API survives reboots
cat > /etc/systemd/system/lab-api.service <<EOF
[Unit]
Description=CIT 270 Lab API
After=network.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=/opt/lab/app/backend
ExecStart=/usr/bin/node server.js
Restart=on-failure
Environment=PORT=3000
Environment=WEB_ORIGIN=${WEB_ORIGIN}

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable lab-api
systemctl start lab-api

echo "App tier setup complete. API listening on port 3000."
