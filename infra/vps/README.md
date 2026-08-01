# VPS Supabase foundation (Iteration 1)

This directory deploys a **non-production** self-hosted Supabase foundation only. It must not change DNS, Vercel, x-ui, xray, UFW, or active application schedulers.

The upstream source is pinned to Supabase `v1.26.07` / commit `949a57d2854b7fcadc0d621cb7fffa167506d581`; exact image tags are in [`LOCK.json`](LOCK.json). This release uses PostgreSQL 17 and the Kong gateway. Supabase announced that Envoy becomes the default gateway on 2026-08-09, so an upgrade must be a separately reviewed change rather than an unpinned pull.

On the VPS, copy this directory to `/srv/malakhov-ai-digest/infra/vps`, then run as root:

```sh
/srv/malakhov-ai-digest/infra/vps/install-docker.sh
/srv/malakhov-ai-digest/infra/vps/deploy-foundation.sh
```

`bootstrap-foundation.sh` generates the real upstream `.env` only on the VPS with mode `0600`; it deliberately redirects the key-generator output and never writes values to Git or logs. Persistent bind volumes live below `/srv/malakhov-ai-digest/supabase-source/docker/volumes`. Recovery exports are root-only under `/srv/malakhov-ai-digest/recovery`, outside any web root.

The override removes all gateway, Postgres, and Supavisor host-port publications. Studio has no direct host port. Do not expose those ports or enable a firewall until a separate cutover/firewall gate has verified the x-ui/xray ports and a second SSH session.

`preflight.sh` renders Compose without printing resolved secrets, checks loopback-only database/pooler ports, and restarts the DB after inserting a non-content sentinel to prove volume persistence. It is safe before any schema or recovery-data import. `backup.sh` is only a local dump helper; Iteration 3 must add encrypted offsite storage and a restore drill before treating it as a backup solution.
