# Deployment (CI/CD)

This repository includes a GitHub Actions workflow that builds the multi-stage `Dockerfile` (it builds the `Frontend` then the `Backend`) and pushes a Docker image to GitHub Container Registry (GHCR) on every push to `main`.

- Workflow: [.github/workflows/build-and-push.yml](.github/workflows/build-and-push.yml)
- Docker image location: `ghcr.io/<OWNER>/weather-forecast:latest` (also tagged with the commit SHA)

How it works
- The workflow builds the image using the repository `Dockerfile` which compiles the frontend into `Backend/public`, installs backend dependencies, and produces a single runtime image that serves the app on port `4000`.
- The image is pushed to GHCR using the repository's `GITHUB_TOKEN` (the workflow requests `packages: write` permission).

Run the image locally (example):

```powershell
docker pull ghcr.io/<OWNER>/weather-forecast:latest
docker run -p 4000:4000 ghcr.io/<OWNER>/weather-forecast:latest
# then open http://localhost:4000
```

Notes
- You do not need to add extra secrets to push to GHCR if you use the default `GITHUB_TOKEN`, but ensure the workflow has `packages: write` permission (the provided workflow sets this).
- If you prefer to push to Docker Hub or another registry, update the login step in the workflow and set the required secrets (`DOCKER_USERNAME` / `DOCKER_PASSWORD`).
- For automated deployment to a server (VM, cloud instance, or container host), add a second workflow step that SSHs to the host and runs `docker pull` + `docker run` (or use a provider-specific action: Azure, AWS, GCP).
