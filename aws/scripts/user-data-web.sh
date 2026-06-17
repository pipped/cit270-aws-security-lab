#!/bin/bash
# EC2 User Data — Web Tier (runs as root on first boot)
# Installs nginx and serves the static frontend.
# Replace APP_TIER_IP with the private IP of your app-tier EC2.

set -euo pipefail
APP_TIER_IP="${APP_TIER_IP:-REPLACE_ME}"

yum update -y
amazon-linux-extras enable nginx1
yum install -y nginx git

# Pull latest frontend files
git clone https://github.com/YOUR_USERNAME/cit270-aws-security-lab.git /opt/lab
cp -r /opt/lab/app/frontend/* /usr/share/nginx/html/

# Inject the app-tier URL so the browser JS knows where to send API calls.
# nginx proxies /api/* to the app tier so the browser never hits port 3000 directly.
sed -i "s|http://localhost:3000|http://${APP_TIER_IP}:3000|g" /usr/share/nginx/html/app.js

# nginx config: serve static files + proxy /api and /health to app tier
cat > /etc/nginx/conf.d/lab.conf <<EOF
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Proxy API calls to the app tier (port 3000 is NOT open to the internet)
    location /api/ {
        proxy_pass http://${APP_TIER_IP}:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }

    location /health {
        proxy_pass http://${APP_TIER_IP}:3000/health;
    }
}
EOF

systemctl enable nginx
systemctl start nginx

echo "Web tier setup complete. Serving on port 80."
