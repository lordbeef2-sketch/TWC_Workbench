# Backend

This FastAPI service is the secure integration layer for TWC Workbench. It manages delegated Teamwork Cloud sessions, direct Teamwork Cloud token sign-in, HTTP-only app sessions, startup-loaded Teamwork Cloud preset servers from `TWC_PRESET_SERVERS`, pre-login selected-server state, per-user post-login server selection state, Teamwork Cloud adapters, and capability probing.

To change the pre-login preset catalog, edit `TWC_PRESET_SERVERS` in `backend/.env` and restart the backend.
`Sign In via TWC` is the primary path. It sends the browser to the selected Teamwork Cloud Authentication Server authorize endpoint, derived by default as `https://<selected-twc-host>:8443/authentication/authorize`, exchanges the returned authorization code at `/authentication/api/token`, refreshes that token when the AuthServer returns a refresh token, and validates the user through `/osmc/admin/currentUser`. `Use TWC Token` remains the explicit fallback. The Authentication Server must have this app's callback URL whitelisted, one app client id from `authentication.client.ids`, and `authentication.client.secret` configured. This project is now documented and configured around a Teamwork Cloud 2022x deployment profile.

OSLC is a separate integration lane. The workbench now includes an OSLC Explorer that discovers `/oslc/api/rootservices`, authorizes through the server's OAuth 1.0a consumer endpoints, executes signed OSLC GET requests with the approved consumer key and secret configured in `backend/.env`, and can generate a consumer key from the root-services registration URL when the server publishes it. Generated keys still require admin approval in Magic Collaboration Studio Settings before OSLC authorization will succeed.

The backend also supports plugin-fed model cache ingestion. The preferred setup is to generate the plugin ingest token inside the admin Settings screen, where Workbench stores it encrypted in app storage. `CACHE_INGEST_TOKENS` remains available as a legacy fallback for bearer-authenticated writes into:

- `POST /api/cache-ingest/branch-snapshots`
- `POST /api/cache-ingest/branch-deltas`

Users can now create their own cache API keys from Workbench Settings for scripts, AI tools, and other integrations. Each key carries explicit `read`, `write`, and `edit` scopes. `CACHE_API_TOKENS` remains available as a legacy fallback for environment-managed bearer tokens. Cache access is exposed through:

- `GET /api/cache`
- `GET /api/cache/servers`
- `GET /api/cache/servers/{server_id}/projects`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/summary`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/snapshot`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/tree`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/nodes/{parent_id}/children`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/models`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/models/{model_id}`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/elements`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/elements/search`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/elements/by-stereotype`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/elements/{element_id}`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/elements/{element_id}/details`
- `GET /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/elements/{element_id}/graph`
- `PATCH /api/cache/servers/{server_id}/projects/{project_id}/branches/{branch_id}/elements/{element_id}`

Use `Authorization: Bearer <api-key>` on those requests. The API key identity maps back to the Workbench user who created it, so cache reads stay scoped to that user's cached visibility instead of becoming a server-wide bypass.
`write` scope also allows `POST /api/cache-ingest/branch-snapshots` and `POST /api/cache-ingest/branch-deltas`. `edit` scope allows cache edits on plugin-backed branches when the user's TWC model permission overlay marks that model editable.
Stereotype search accepts either a stereotype id or a stereotype name fragment and can return either lightweight cached element records or full cached item details with `includeDetails=true`.
Key labels, creation time, and last-used time are stored for light auditability, while the full secret is only shown once at creation time.

Use `TWC_PLUGIN_ONLY_CACHE_TARGETS` when you want specific server/project/branch combinations to refuse live `/osmc` fallback and require a Cameo plugin snapshot first.

The cache API stores the shared branch model payload once and keeps per-user
permission overlays separately. That avoids duplicating the same branch model
for every user while still keeping visibility scoped to the TWC-backed
Workbench user identity.

See the developer-facing cache API guide in [CACHE_API.md](/C:/sand/fresh/New%20Project/CACHE_API.md) and the runnable examples in [examples/README.md](/C:/sand/fresh/New%20Project/examples/README.md).

Preset-management authorization is derived from Teamwork Cloud user context and trusted upstream role or group headers when they are available. The backend does not keep a separate hardcoded admin-user list.

Cache refresh is now intentionally view-scoped. Workbench serves cache first, only materializes a full branch cache after a user actually opens that project branch, and only refreshes the actively viewed branch when its revision changes. Automatic webhook-driven background refresh is disabled.

## Verified Contract Boundary

- The adapter uses the verified Teamwork Cloud Swagger surface in `contracts/RealSwagger.json` for resources, workspaces, branches, models, elements, revision diff, and current-user validation.
- Branch rename and branch metadata edit remain version-gated features and are not part of the default 2022x deployment profile.
- Simulation, collaborator workspace, attachments, comments, documents, publish/export jobs, job center, saved searches, bookmarks, and global model search are not exposed because this Swagger file does not define those APIs.

## Artifact-First Extractor

For offline or scripted extraction, use `app.extractors.twc_artifact_extractor`. It intentionally starts from branch artifacts because the validated Swagger for this project exposes:

- `GET /osmc/workspaces/{workspaceId}/resources/{resourceId}/branches/{branchId}/artifacts`
- `GET /osmc/workspaces/{workspaceId}/resources/{resourceId}/branches/{branchId}/artifacts/{artifact}`
- `POST /osmc/workspaces/{workspaceId}/resources/{resourceId}/branches/{branchId}/elements`

but does not expose a root `GET .../elements` listing path for the whole branch.

Windows example:

```powershell
.\.venv\Scripts\python.exe -m app.extractors.twc_artifact_extractor `
  --base-url https://twc-host:8111 `
  --token <bearer-token> `
  --workspace-id <workspace-id> `
  --resource-id <resource-id> `
  --branch-id <branch-id> `
  --verify-tls false
```

The extractor caches discovered IDs in `backend/data/twc_artifact_extractor.sqlite3` unless you override `--cache-path`, and `--refresh-discovery` forces a new artifact walk when you need one.

Run locally from the repository root virtual environment:

Windows:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Linux:

```bash
./.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Important environment variables are documented in `backend/.env.example` and the repository root `README.md`.
