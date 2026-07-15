# Deploying First Move on a shared VPS

First Move is a single lightweight, stateless Node service (no database, no
background jobs). It co-exists safely with other apps on the same VPS as long as
it gets **its own internal port** and traffic is routed by **hostname** through
a reverse proxy. Nothing here touches another app's ports, domains, or runtime.

## The isolation model

```
                       :443 (HTTPS, hostname routing)
Internet ─▶ Reverse proxy (Caddy or nginx) ─┬─▶ 127.0.0.1:<your other app>  (e.g. prism pulse)
                                            └─▶ 127.0.0.1:8090  (KeepFlow container)
```

- KeepFlow binds to `127.0.0.1:8090` only (see `docker-compose.yml`) — never
  publicly exposed directly, and cannot collide with another app's public port.
- The reverse proxy already listening on 80/443 multiplexes both apps by
  hostname/subdomain and terminates HTTPS.
- Resource caps (`mem_limit: 256m`, `cpus: 0.5`) mean it can't starve a
  co-tenant.

## Steps

1. **DNS** — point a subdomain (e.g. `keepflow.yourdomain.com`) A/AAAA record at
   the VPS.

2. **Get the code** on the VPS:
   ```bash
   git clone https://github.com/Stella112/Keepflow.git
   cd Keepflow
   cp .env.example .env      # edit as needed (see below)
   ```

3. **Run it** (Docker — recommended for isolation):
   ```bash
   docker compose up -d --build
   docker compose ps            # healthy?
   curl -s localhost:8090/health
   ```
   If port 8090 is already used by another app, change the left side of the
   `ports:` mapping in `docker-compose.yml` (and the proxy target below).

   *No Docker?* Run it directly instead:
   ```bash
   npm ci && npm run build
   PORT=8090 NODE_ENV=production node dist/server.js   # or a systemd unit / pm2
   ```

4. **Reverse proxy** — add ONE block to your existing proxy:
   - **Caddy** (automatic HTTPS): append `deploy/Caddyfile.example` to your
     Caddyfile, edit the hostname, `caddy reload`.
   - **nginx**: install `deploy/nginx-keepflow.conf.example` as a new site, then
     `certbot --nginx -d keepflow.yourdomain.com` for HTTPS.

5. **Verify public HTTPS**:
   ```bash
   curl -s https://keepflow.yourdomain.com/health
   ```

## Environment (`.env`)

| Var | For the demo | Notes |
|---|---|---|
| `PORT` | `8080` | Container-internal; the compose file maps it. Leave as-is with Docker. |
| `ANTHROPIC_API_KEY` | optional | Set to enable the hybrid classifier; omit for deterministic-only. |
| `PAYMENTS_ENABLED` | `true` to demo the paid gate | With `true` you MUST set `X402_PAY_TO_ADDRESS` and `X402_FACILITATOR_URL`, or the gate fails closed (`500`). |
| `X402_PAY_TO_ADDRESS` | your X Layer address | Seller payout address. |
| `X402_FACILITATOR_URL` | OKX x402 facilitator | ⚠️ confirm the exact URL against OKX docs before going live. |

Leave `PAYMENTS_ENABLED=false` while validating the endpoint; flip it on once the
facilitator URL is confirmed.

## Won't this affect my other app?

No — different internal port, hostname-based routing, containerized runtime, and
capped resources. The only shared surface is the reverse proxy on 80/443, which
is designed to host many sites side by side.
