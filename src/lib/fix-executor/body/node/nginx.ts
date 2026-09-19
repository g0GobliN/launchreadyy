export function nginxConf(hasBackend: boolean): string {
  const proxyBlock = hasBackend
    ? `
  # Proxy API requests to the backend service
  location /api/ {
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    client_max_body_size 50M;
  }
`
    : "";

  return `server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  # Security headers
  add_header X-Frame-Options "SAMEORIGIN";
  add_header X-Content-Type-Options "nosniff";
  add_header Referrer-Policy "strict-origin-when-cross-origin";
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()";

  # Compression
  gzip on;
  gzip_types text/plain text/css application/javascript application/json image/svg+xml;

  # Long-term cache for hashed static assets
  location ~* \\.(js|css|png|jpg|svg|ico|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
${proxyBlock}
  # SPA fallback — all routes served by index.html
  location / {
    try_files $uri $uri/ /index.html;
  }
}
`;
}
