# teleport

Fast room-based paste and file sync with 24-hour auto-destroy.

## Production Docker

Build the nginx production image:

```bash
docker build -t teleport:production .
```

Run it on port `7777`:

```bash
docker run -d \
  --name teleport \
  --restart unless-stopped \
  -p 7777:7777 \
  -v teleport-data:/app/data \
  teleport:production
```

Or use Compose:

```bash
docker compose up -d --build
```

Open:

```text
http://101.245.78.174:7777/
```

The container runs nginx on `7777` and proxies `/api/rooms/*` to the internal Node server. Uploaded files and the SQLite database are stored in `/app/data`; keep that path mounted as a volume if you want data to survive container replacement.
