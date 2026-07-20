# scripts

## update-cloudflare-ips.sh

Regenerates `nginx/cloudflare-ips.conf` (the `set_real_ip_from` list + the
`geo $from_cloudflare` allowlist that locks the origin to Cloudflare) from the
live `cloudflare.com/ips-v4`/`ips-v6` lists, then reloads nginx **only if the
ranges changed**. Validates with `nginx -t` and rolls back on failure. Idempotent.

Run once by hand:

```bash
COLLABJS_DIR=/opt/collabjs ./scripts/update-cloudflare-ips.sh
```

Cloudflare's ranges change rarely, so a weekly timer is plenty. Install it
(symlinks track the repo, so `git pull` keeps the units current):

```bash
sudo ln -s /opt/collabjs/scripts/systemd/cloudflare-ips.service /etc/systemd/system/
sudo ln -s /opt/collabjs/scripts/systemd/cloudflare-ips.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflare-ips.timer
systemctl list-timers cloudflare-ips.timer   # confirm it's scheduled
```
