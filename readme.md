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

The container runs nginx on `7777` and proxies `/api/*` to the internal Node server. Uploaded files and the SQLite database are stored in `/app/data`; keep that path mounted as a volume if you want data to survive container replacement.

## GitHub Autobuilds

The repository includes GitHub Actions workflows in `.github/workflows/`:

- `CI`: builds the web/server project, checks the desktop client, and verifies the Docker image on pushes and pull requests to `main`.
- `Publish`: publishes the webserver image to GitHub Container Registry and builds desktop clients for Linux, Windows, and macOS on pushes to `main`, version tags, or manual dispatch.

Published Docker images use:

```text
ghcr.io/<owner>/<repo>:latest
ghcr.io/<owner>/<repo>:v2.0.0
ghcr.io/<owner>/<repo>:sha-<commit>
```

Push a version tag to publish a GitHub Release with client downloads:

```bash
git tag v2.0.0
git push origin v2.0.0
```

Release assets include Linux `.deb` and `.rpm`, Windows `.msi`/`.exe`, and macOS `.dmg` builds. The Docker image is published from the same tag.
