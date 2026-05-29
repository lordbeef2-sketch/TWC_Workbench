# TWC Workbench

TWC Workbench is a server-backed enterprise web application for Teamwork Cloud 2022x. It provides secure TWC authentication, workspace navigation, model browsing, item details, item editing where supported by the Teamwork Cloud API, and compare workflows derived from `contracts/RealSwagger.json`.

## Architecture Summary

The platform is split into two deployable tiers:

- `backend/`: FastAPI service that owns authentication, secure HTTP-only sessions, capability discovery, Teamwork Cloud API communication, and version adapters.
- `frontend/`: React + TypeScript + Material UI application that renders the landing page, dashboard, project browser, model browser, item details, and compare experiences.

The browser never talks directly to Teamwork Cloud. All Teamwork Cloud access, token handling, and endpoint probing stay on the backend.

## One-Script Launch

Run the platform from the repository root with a single script:

Windows:

```powershell
.\launch.ps1
```

Linux:

```bash
bash ./launch.sh
```

What the launchers do:

- Windows launcher checks all `.ps1` files under the repository and unblocks any that still carry a Windows download mark.
- Both launchers create or reuse the root `.venv`.
- Both launchers install backend dependencies when `backend/pyproject.toml` changes.
- Both launchers install frontend dependencies when `frontend/package.json` changes.
- Both launchers attempt `npm audit fix` after frontend dependency installation and continue with a warning when the npm audit endpoint is unreachable or blocked by local certificate trust.
- Both launchers rebuild the frontend when source files change.
- Both launchers set `FRONTEND_ORIGIN` to the backend URL for a single-origin launch.
- Both launchers start FastAPI so the backend serves both the API and the built frontend.

Useful options:

- Windows: `.\launch.ps1 -PrepareOnly`, `.\launch.ps1 -NoBrowser`, `.\launch.ps1 -Port 8080`, `.\launch.ps1 -BindHost 127.0.0.1`
- Linux: `bash ./launch.sh --prepare-only`, `bash ./launch.sh --no-browser`, `bash ./launch.sh --port 8080`, `bash ./launch.sh --host 127.0.0.1`

If PowerShell execution policy blocks script execution on Windows, run:

```powershell
powershell -ExecutionPolicy Bypass -File .\launch.ps1
```

## Tech Stack Justification

- **FastAPI + httpx + pydantic** provide a clean async backend with strong typed models and straightforward API integration patterns.
- **Server-side session management** keeps tokens out of browser storage and supports secure HTTP-only cookies.
- **SQLite by default** gives a zero-friction local runtime for preset server definitions and per-user server selection state while leaving room for Redis-backed sessions and external infra in production.
- **React + TypeScript + Material UI** provide a maintainable enterprise-grade frontend with responsive layout, theming, and composable workflows.
- **Adapter boundaries** isolate Teamwork Cloud version differences and remote capability uncertainty behind stable internal contracts.

## Backend Configuration

Copy `backend/.env.example` to `backend/.env` and set values appropriate for your environment.

`backend/.env` remains the app runtime configuration file, and it also carries the preset Teamwork Cloud catalog through `TWC_PRESET_SERVERS`.
`TWC_PRESET_SERVERS` is the authoritative JSON catalog for pre-login Teamwork Cloud discovery. Each preset includes `id`, `name`, `base_url`, `version`, `verify_tls`, `ca_bundle_path`, `enabled`, and `display_order`.
The backend loads that catalog at startup and exposes enabled presets on the landing page before authentication. Users do not create their own target servers just to connect; the app persists only each user’s selected and last-used server state separately.
To change the pre-login preset catalog, edit `TWC_PRESET_SERVERS` and restart the backend.
`Sign In via TWC` is the primary sign-in path. It redirects to the Authentication Server for the selected Teamwork Cloud preset, derived by default as `https://<selected-twc-host>:8443/authentication/authorize`, requests an authorization code, exchanges that code for a token through `/authentication/api/token`, refreshes that token when the AuthServer returns a refresh token, and validates the user through the RealSwagger `/osmc/admin/currentUser` REST endpoint. The documented deployment profile for this project is a Teamwork Cloud 2022x server, with `TWC_AUTH_SERVER_OVERRIDES` available when that 2022x environment uses an explicit Authentication Server host or proxy path. `Use TWC Token` remains the explicit fallback.
OSLC remains a separate API lane from `/osmc`. The workbench now includes an OSLC Explorer that discovers `/oslc/api/rootservices`, authorizes through OAuth 1.0a consumer endpoints, signs OSLC GET requests with an approved consumer key/secret, and can generate an OSLC consumer key from `jfs:oauthRequestConsumerKeyUrl` when the server publishes that root-services link.
Preset-management authorization is derived from Teamwork Cloud or trusted reverse-proxy role and group context. When no upstream role or group claims are available, the app defaults to allowing authenticated users rather than maintaining a separate authorization list.

Important settings:

- `HOST`: bind address for this app only. Use `0.0.0.0`, `127.0.0.1`, or a local interface IP. Do not put the Teamwork Cloud FQDN here.
- `FRONTEND_ORIGIN`: allowed browser origin for local development or deployment.
- `APP_ORIGIN`: optional public origin of this app when it is served behind a reverse proxy. Defaults to `FRONTEND_ORIGIN` when left empty. Set this in deployed environments if you want the app to auto-register Teamwork Cloud branch webhooks for cache refresh where supported.
- `SESSION_SECRET`: replace with a long random secret in every non-local environment. It encrypts stored per-user delegated credentials inside the app session.
- `TWC_PRESET_SERVERS`: JSON array of preset Teamwork Cloud servers loaded at startup for pre-login discovery.
- `SECURE_COOKIES=true`: required when running behind HTTPS.
- `UPSTREAM_AUTH_COOKIE_NAMES`: optional JSON array of TWC cookie names to forward. Leave empty to forward all incoming cookies except the app's own session cookie.
- `UPSTREAM_USER_HEADERS`: optional JSON array of trusted reverse-proxy user headers.
- `UPSTREAM_GROUP_HEADERS`: optional JSON array of trusted reverse-proxy group headers used to mirror TWC group membership.
- `UPSTREAM_ROLE_HEADERS`: optional JSON array of trusted reverse-proxy role headers used to mirror TWC role membership.
- `UPSTREAM_ACCESS_TOKEN_HEADERS`: optional JSON array of trusted reverse-proxy TWC token headers.
- `TWC_AUTH_CLIENT_ID`: one Authentication Server client id listed in `authentication.client.ids`.
- `TWC_AUTH_CLIENT_SECRET`: Authentication Server `authentication.client.secret` used as the `X-Auth-Secret` token-exchange header.
- `TWC_AUTHENTICATION_CLIENT_ID`, `TWC_AUTHENTICATION_CLIENT_IDS`, `TWC_AUTHENTICATION_CLIENT_SECRET`: optional aliases for the same TWC AuthServer properties.
- `TWC_AUTH_SCOPE`: optional AuthServer token-exchange scope. Leave blank unless Dassault support tells you otherwise; the app defaults it to the Teamwork Cloud documented value.
- `TWC_SAML_AUTHORIZE_URL`: optional complete SAML/AuthServer authorize URL. Leave blank to derive it from the selected server.
- `TWC_SAML_LOGIN_PATH`: authorize path used when `TWC_SAML_AUTHORIZE_URL` is blank. Defaults to `/authentication/authorize`.
- `TWC_SAML_LOGIN_PORT`: authorize port used when `TWC_SAML_AUTHORIZE_URL` is blank. Defaults to `8443`.
- `TWC_SAML_TOKEN_URL`: optional complete AuthServer token URL. Leave blank to derive it from the selected server or authorize URL.
- `TWC_SAML_RETURN_URL_PARAMETER`: query parameter used to pass the app callback URL to the TWC authorize endpoint. Defaults to `redirect_uri`.
- `TWC_AUTH_SERVER_OVERRIDES`: optional JSON object keyed by preset server id for explicit 2022x AuthServer hosts, client ids, secrets, ports, paths, scopes, and return parameter names.
- `TWC_OSLC_CONSUMER_KEY`, `TWC_OSLC_CONSUMER_SECRET`: approved OAuth 1.0a consumer credentials for OSLC. These can also be generated from the OSLC Explorer and stored per app session, but generated keys still require admin approval in Teamwork Cloud Settings.
- `TWC_OSLC_ROOTSERVICES_URL`: optional complete OSLC root services URL. Leave blank to derive `https://<selected-twc-host>:8443/oslc/api/rootservices`.
- `TWC_OSLC_PORT`, `TWC_OSLC_BASE_PATH`: derivation controls for OSLC when the root services URL is not explicitly set.
- `TWC_OSLC_CALLBACK_PATH`: optional browser-visible callback path for the OSLC OAuth redirect.
- `CACHE_INGEST_TOKENS`: optional legacy fallback list for plugin write tokens. The preferred path is to manage the plugin ingest token from Workbench admin Settings.
- `CACHE_API_TOKENS`: optional legacy fallback map of bearer token to Workbench username for cache-read API access. The preferred path is to let users create their own API keys from Workbench Settings.
- `TWC_PLUGIN_ONLY_CACHE_TARGETS`: optional JSON object keyed by Workbench server id that forces listed project ids or project/branch pairs to use plugin-backed cache only and refuse live `/osmc` fallback until a plugin snapshot exists.
- `REDIS_URL`: optional, enables Redis-backed sessions.
Teamwork Cloud base URLs, version hints, certificate settings, and preset ordering are configured through `TWC_PRESET_SERVERS`, not through `HOST`.

The launch scripts read `HOST` and `PORT` from `backend/.env` by default. Command-line launch options override them when provided.

## Developer API

Workbench now includes a cache-first developer API for scripts, AI tools, and
external integrations.

- Users create labeled API keys from the Workbench `Developer API` tab or
  Settings.
- Keys support `read`, `write`, and `edit` scopes.
- The shared model cache is stored once per branch, while Workbench maintains a
  per-user visibility and editability overlay so TWC access stays user-scoped
  without caching the same model N times.
- Plugin-backed branches can be forced to use plugin cache only through
  `TWC_PLUGIN_ONLY_CACHE_TARGETS`.

See:

- [CACHE_API.md](/C:/sand/fresh/New%20Project/CACHE_API.md)
- [examples/README.md](/C:/sand/fresh/New%20Project/examples/README.md)

## Frontend Configuration

Copy `frontend/.env.example` to `frontend/.env` when you need to override the default API base path.

By default the frontend uses `VITE_API_BASE=/api`, which works with both:

- Vite dev proxy during local development.
- Backend-served static assets when the frontend has been built into `frontend/dist`.

## Dependencies

Backend dependencies are declared in `backend/pyproject.toml`.

Frontend dependencies are declared in `frontend/package.json`.

## Setup Instructions

### Backend

1. Create a Python 3.11+ virtual environment.
2. Install the backend package in editable mode.
3. Copy `backend/.env.example` to `backend/.env`.
4. Set `SESSION_SECRET` and environment-specific values.

Windows example:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e backend
Copy-Item backend/.env.example backend/.env
```

Linux example:

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e backend
cp backend/.env.example backend/.env
```

### Frontend

1. Install Node.js 20+.
2. Install frontend dependencies.
3. Run `npm audit fix`.
4. Optionally copy `frontend/.env.example` to `frontend/.env`.

Windows example:

```powershell
Set-Location frontend
npm install
npm audit fix
Copy-Item .env.example .env
```

Linux example:

```bash
cd frontend
npm install
npm audit fix
cp .env.example .env
```

## Run Instructions

### Preferred

From the repository root:

Windows:

```powershell
.\launch.ps1
```

Linux:

```bash
bash ./launch.sh
```

Open `http://localhost:8000`.

### Development

Run backend on Windows:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Run backend on Linux:

```bash
./.venv/bin/python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Run frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173`.

### Production-style Single-Origin Serve

Build the frontend:

```powershell
cd frontend
npm run build
```

Then run the backend. If `frontend/dist` exists, FastAPI serves it automatically from the root path.

## Deployment Notes

- Terminate TLS at a reverse proxy or application gateway and forward traffic to FastAPI.
- Set `SECURE_COOKIES=true` behind HTTPS.
- Move sessions to Redis via `REDIS_URL` for multi-instance deployments.
- Move SQLite to a managed relational database if you need multi-node preset and per-user state.
- If custom CA bundles are required, mount them into the backend container or VM and reference them in server profiles.

## TWC Authentication Configuration Notes

- TWC is the authentication and authorization authority for this app.
- Preset Teamwork Cloud servers are loaded from `TWC_PRESET_SERVERS` at startup and are readable on the landing page before app login.
- Users select a preset server first, then authenticate against that selected Teamwork Cloud server.
- The post-login app session is bound to the selected server, not the other way around.
- Redirect-based `Sign In via TWC` sends the browser to the selected preset's AuthServer authorize endpoint, preserves the selected preset server, and completes the app session on the callback route after exchanging the returned authorization code.
- The callback URL is the Workbench app URL, normally `https://<workbench-host>/api/auth/callback`; whitelist that same callback in every TWC/AuthServer client registration that should be able to return users to this app.
- If your 2022x environment uses a separate Authentication Server host, `authentication.client.ids`, `authentication.client.secret`, or proxy path, put those values in `TWC_AUTH_SERVER_OVERRIDES` keyed by the matching `TWC_PRESET_SERVERS` id.
- If your deployment bypasses the AuthServer code flow, the callback must receive authenticated Teamwork Cloud session cookies or a forwarded user-scoped TWC token from your proxy or auth gateway.
- `Use TWC Token` remains the explicit fallback when your deployment cannot return authenticated TWC context to the callback.
- If your proxy cannot forward Teamwork Cloud session cookies, configure `UPSTREAM_ACCESS_TOKEN_HEADERS` to pass a user-scoped TWC token instead.
- Direct token sign-in is also supported from the landing page. The backend validates the supplied token against `/osmc/admin/currentUser` before opening a workbench session.
- Optional trusted user headers in `UPSTREAM_USER_HEADERS` are used only as identity hints and authorization context when a reverse proxy already knows the authenticated TWC user; they do not replace the required Teamwork Cloud session cookies or forwarded token for callback completion.

## 2022x Profile

- The project is configured, documented, and defaulted for Teamwork Cloud `2022x`.
- New preset server definitions default to version `2022x`.
- The adapter uses the verified main TWC Swagger surface for resource, branch, model, and element browsing when the live server exposes those endpoints.
- Branch rename and branch metadata edit remain version-gated features and are not part of the default 2022x deployment profile.
- Unknown or unavailable remote capabilities are not replaced with local workspace fallbacks.

## Removed API Surface

`contracts/RealSwagger.json` is treated as the entire Teamwork Cloud API contract for this app. Simulation, collaborator workspace, global model search results, publish/export jobs, job center, saved searches, bookmarks, comments, documents, and attachments are not exposed because this Swagger file does not define those APIs.

## Future Roadmap

- Add persistent relational storage for profiles and sessions.
- Add SSO provider-specific hardening and token refresh flow handling.
- Add packaging for Docker and container orchestration.
