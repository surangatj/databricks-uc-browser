# Build a Databricks App with React + FastAPI - No Service Principals, No PATs, No Secrets

> **A complete tutorial for building a production-ready Databricks App that queries Unity Catalog as the logged-in user - zero credential management required.**

---

## The Problem

You've built a great analytics app. You deploy it to Databricks Apps. Then the questions start:

- *"Which service principal should the app use?"*
- *"How do we rotate the PAT every 90 days?"*
- *"User A can see table X - but the app's SP can see everything. How do we enforce UC permissions?"*
- *"The secret scope expired again. Who manages that?"*

The traditional approach looks like this:

```
User → App → Service Principal (SP) → Unity Catalog
                  ↑
          Has its own permissions
          Needs admin to grant UC access
          Token expires, needs rotation
          Can bypass row/column filters
```

This is painful. The SP has to be granted permissions separately, its credentials need rotation, and you lose the per-user governance that Unity Catalog gives you for free.

**There's a better way.**

---

## The Solution: On-Behalf-Of (OBO) Authentication

Databricks Apps supports a feature called **On-Behalf-Of User Authorization**. When enabled, the Databricks proxy injects the **logged-in user's own OAuth token** into every request via the `X-Forwarded-Access-Token` header.

```
User → Databricks Proxy (SSO) → App → Unity Catalog
                ↓
    Injects user's OAuth token
    as X-Forwarded-Access-Token
                            ↓
                  Runs SQL as the user
                  UC enforces their permissions
                  No SP, no PAT, no rotation
```

The result:
- ✅ Every query runs as the user - UC row filters, column masks, and permissions all apply
- ✅ No service principal needed (or you can remove it)
- ✅ No PAT rotation, no secret scopes
- ✅ First-time users see a one-time consent screen - then it just works
- ✅ Different users see different data based on their own grants

---

## What We're Building

A **Unity Catalog Browser** - a React + FastAPI app that lets users:

1. Browse all catalogs, schemas, and tables they have access to
2. View table schema (columns, types, nullability)
3. Run SQL queries and see results - all as themselves

![App Screenshot](docs/images/app-main.png)
*The Unity Catalog Browser - showing the catalog tree on the left, table schema in the center, and SQL query results at the bottom.*

> **Screenshot needed**: Take a screenshot of the running app at `https://uc-catalog-browser-7474643844809599.aws.databricksapps.com` and save as `docs/images/app-main.png`

---

## Architecture

![Architecture - Unity Catalog Browser OBO Auth Flow](docs/images/architecture.gif)

### Key design decisions

| Decision | Why |
|---|---|
| **FastAPI over Streamlit** | Full control over API + UI, proper SPA architecture |
| **React + Vite + Tailwind** | Fast builds, TypeScript safety, no CSS framework bloat |
| **OBO over SP auth** | Zero credential management, UC permissions respected per user |
| **DAB (Asset Bundles)** | One command to deploy to any environment |
| **Static build in `static/`** | Keeps `package.json` out of the uploaded source (critical - see gotchas) |

---

## Prerequisites

- Databricks workspace with **Unity Catalog** enabled
- Workspace **admin** access (to enable the OBO Preview feature - one-time setup)
- [Databricks CLI v0.200+](https://docs.databricks.com/dev-tools/cli/install.html)
- Node.js 18+ and npm
- Python 3.10+

---

## Project Structure

```
databricks-uc-browser/
├── databricks.yml                  # DAB config - workspace, targets, app resource
├── .gitignore                      # Excludes apps/*/static/ (built output)
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Actions: build + deploy on push to main
└── apps/
    └── uc_browser/
        ├── app.yaml                # Minimal: just the startup command
        ├── main.py                 # FastAPI backend (the main file)
        ├── requirements.txt        # Python dependencies
        ├── .databricksignore       # Excludes frontend/ from upload
        ├── static/                 # Built React output (gitignored, built in CI)
        │   ├── index.html
        │   └── assets/
        └── frontend/               # React source - NOT uploaded to Databricks
            ├── package.json
            ├── vite.config.ts      # outDir: '../static' ← critical setting
            ├── tailwind.config.js
            └── src/
                ├── App.tsx
                ├── api.ts
                └── components/
                    ├── Header.tsx
                    ├── Sidebar.tsx
                    ├── TableViewer.tsx
                    └── QueryPanel.tsx
```

---

## Step-by-Step Implementation

### Step 1 - Configure the DAB bundle

`databricks.yml` registers the app with your workspace:

```yaml
bundle:
  name: uc_browser_bundle

workspace:
  host: https://<your-workspace>.cloud.databricks.com

targets:
  dev:
    default: true
    mode: development

resources:
  apps:
    uc_browser:
      name: "uc-catalog-browser"
      description: "Unity Catalog browser - runs SQL as the logged-in user"
      source_code_path: ./apps/uc_browser
      user_api_scopes:
        - sql          # ← This is what enables OBO with SQL access
```

> **Important**: `user_api_scopes: [sql]` must live in `databricks.yml`. If you set it via CLI, the next `bundle deploy` resets it.

---

### Step 2 - The FastAPI backend

The heart of the OBO pattern is in `main.py`. Here's the auth flow:

```python
def user_token_from(request: Request) -> Optional[str]:
    # Databricks Apps proxy injects the user's OAuth token here
    return request.headers.get("X-Forwarded-Access-Token") or None

def get_client(user_token: Optional[str] = None) -> WorkspaceClient:
    if user_token:
        # auth_type="pat" is CRITICAL - without it, the SDK sees both the OBO
        # token AND the SP credentials in env vars and throws:
        # "more than one authorization method configured: oauth and pat"
        return WorkspaceClient(host=_HOST, token=user_token, auth_type="pat")
    return WorkspaceClient()  # Falls back to SP credentials (local dev)
```

SQL execution using the Statement Execution API:

```python
def execute_sql(statement: str, user_token: Optional[str] = None):
    w = get_client(user_token)
    result = w.statement_execution.execute_statement(
        warehouse_id=get_warehouse_id(w),  # Auto-discovered
        statement=statement,
        wait_timeout="30s",
    )
    if result.status.state == StatementState.FAILED:
        raise HTTPException(400, detail=result.status.error.message)
    return result
```

Unity Catalog browsing via SDK:

```python
@app.get("/api/catalogs")
def list_catalogs(request: Request):
    w = get_client(user_token_from(request))
    return {"catalogs": sorted(c.name for c in w.catalogs.list() if c.name)}

@app.get("/api/catalogs/{catalog}/schemas/{schema}/tables/{table}")
def get_table_detail(catalog: str, schema: str, table: str, request: Request):
    w = get_client(user_token_from(request))
    table_info = w.tables.get(full_name=f"{catalog}.{schema}.{table}")
    columns = [{"name": c.name, "type": c.type_text} for c in table_info.columns]
    # ... sample data via SQL
    return {"columns": columns, "sample_rows": rows}
```

**The static file mounting order matters:**

```python
# CORRECT: mount static assets BEFORE the catch-all route
app.mount("/assets", StaticFiles(directory="static/assets"), name="assets")

# If you register this first, it intercepts /assets/... requests
@app.get("/{full_path:path}", response_class=HTMLResponse)
def serve_spa(full_path: str = ""):
    return HTMLResponse((STATIC_DIR / "index.html").read_text())
```

---

### Step 3 - The .databricksignore trick

This is the most important gotcha. If `package.json` is present in the uploaded source, Databricks Apps detects it and runs `npm install` at startup. This causes the "Preparing source code" step to **hang indefinitely** until it times out.

The fix: build React locally, output to `static/` (outside `frontend/`), and exclude the entire `frontend/` directory:

**`apps/uc_browser/.databricksignore`:**
```
frontend/
```

**`frontend/vite.config.ts`:**
```typescript
export default defineConfig({
  build: {
    outDir: '../static',   // ← outputs to apps/uc_browser/static/
    emptyOutDir: true,
  },
  server: {
    proxy: { '/api': 'http://localhost:8000' }  // for local dev
  }
})
```

---

### Step 4 - The React frontend

The app uses a 3-panel layout: sidebar (catalog tree) + table schema viewer + SQL query panel.

![Catalog Tree](docs/images/app-catalog-tree.png)
*The sidebar shows catalogs → schemas → tables in a lazy-loading tree. Click a table to load its schema.*

> **Screenshot needed**: Expand `transportation > gold` and click `fact_trips`. Save as `docs/images/app-catalog-tree.png`

The API client (`api.ts`) uses relative URLs so it works in both production (same origin) and local dev (Vite proxy):

```typescript
export const api = {
  getCatalogs: () => fetch('/api/catalogs').then(r => r.json()),
  getTableDetail: (catalog, schema, table) =>
    fetch(`/api/catalogs/${catalog}/schemas/${schema}/tables/${table}`).then(r => r.json()),
  runQuery: (sql: string) =>
    fetch('/api/query', { method: 'POST', body: JSON.stringify({ sql }) }).then(r => r.json()),
}
```

![Query Results](docs/images/app-query-results.png)
*Running a SQL query - results appear in a scrollable table. Press ⌘+Enter to run.*

> **Screenshot needed**: Run `SELECT * FROM transportation.gold.fact_trips LIMIT 10` and save as `docs/images/app-query-results.png`

---

### Step 5 - Enable On-Behalf-Of in your workspace

This is a **one-time admin step** per workspace.

1. Go to your Databricks workspace
2. Click your username (top right) → **Previews**

![Step 1 - Open the user menu and click Previews](docs/images/step1-user-menu-previews.png)
*Click your workspace name / avatar in the top-right corner, then select **Previews** from the dropdown.*

3. Search for **"databricks app"** and toggle **"On-Behalf-Of User Authorization"** to **ON**

![Step 2 - The OBO toggle in the Previews panel](docs/images/step2-obo-toggle.png)
*The Previews panel - find "Databricks Apps - On-Behalf-Of User Authorization" and toggle it ON. Changes take effect in a few minutes.*

> Must be done in every workspace (dev, staging, production separately).

---

### Step 6 - Deploy

**First time setup:**

```bash
# 1. Clone the repo
git clone https://github.com/your-username/databricks-uc-browser
cd databricks-uc-browser

# 2. Authenticate the Databricks CLI
databricks auth login --host https://your-workspace.cloud.databricks.com --profile dev

# 3. Build the React frontend
cd apps/uc_browser/frontend
npm install
npm run build        # outputs to apps/uc_browser/static/
cd ../../..

# 4. Deploy with DAB
databricks bundle deploy -t dev

# 5. Start the app
databricks bundle run -t dev uc_browser
```

**After first deploy - critical steps:**

```bash
# Stop the app (required to pick up new token scopes)
databricks apps stop uc-catalog-browser --profile dev

# Start it again
databricks bundle run -t dev uc_browser
```

> Why stop + start? When OBO is first enabled or scopes change, existing app processes have old tokens without the `sql` scope. A full stop/start forces a fresh token.

---

### Step 7 - First-time user consent

When a new user opens the app, they'll see a consent screen:

![Step 3 - OBO consent screen](docs/images/step3-obo-consent-screen.png)
*The one-time consent screen - the app (`uc-catalog-browser`) is requesting permission to act on the user's behalf.*

Clicking **"Databricks SQL"** expands the scope detail before authorizing:

![Step 4 - Expanded scope detail](docs/images/step4-obo-authorized.png)
*Expanding the scope shows exactly what access the app is requesting: execute SQL and manage SQL-related resources. Click **Authorize** to proceed.*

This only appears once per user per app. After consent the user lands directly in the app - no login, no credentials, no setup.

This is expected and normal. After consent, the user lands in the app with their own UC permissions applied to every query.

---

## GitHub Actions CI/CD

The `.github/workflows/deploy.yml` automates the build + deploy on every push to `main`:

```yaml
name: Deploy to Databricks

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build React frontend
        working-directory: apps/uc_browser/frontend
        run: |
          npm ci
          npm run build

      - name: Install Databricks CLI
        uses: databricks/setup-cli@main

      - name: Deploy
        env:
          DATABRICKS_HOST: ${{ secrets.DATABRICKS_HOST }}
          DATABRICKS_TOKEN: ${{ secrets.DATABRICKS_TOKEN }}
        run: |
          databricks bundle deploy -t dev
          databricks bundle run -t dev uc_browser
```

Add `DATABRICKS_HOST` and `DATABRICKS_TOKEN` as repository secrets in GitHub → Settings → Secrets.

---

## Common Gotchas

### 1. "Preparing source code" hangs forever
**Cause**: `package.json` is in the uploaded source, triggering `npm install`.
**Fix**: Add `frontend/` to `.databricksignore` and build React before deploying.

### 2. `more than one authorization method configured`
**Cause**: OBO token is present + SP credentials in env vars, SDK can't decide.
**Fix**: Always pass `auth_type="pat"` when constructing the client with a user token.

### 3. Queries fail with "SQL scope missing"
**Cause**: The app was started before `user_api_scopes: [sql]` was set, or an old browser session has a token without the scope.
**Fix**: Full stop + start the app. Users clear `__Host-databricksapps` cookie or open in incognito.

### 4. Scope resets after `bundle deploy`
**Cause**: Setting scopes via CLI is overwritten on next deploy.
**Fix**: Always set `user_api_scopes` in `databricks.yml`, not via CLI.

### 5. `/assets/...` returns the SPA HTML instead of JS/CSS
**Cause**: The `/{full_path:path}` catch-all route was registered before `app.mount("/assets", ...)`.
**Fix**: Always mount static files before registering the catch-all route.

### 6. OBO not working after enabling the Preview toggle
**Cause**: Old browser sessions have tokens issued before OBO was enabled.
**Fix**: Full app stop + start. Users open in a new incognito window.

---

## Running Locally

```bash
# Terminal 1: FastAPI backend
cd apps/uc_browser
pip install -r requirements.txt
databricks auth login --host https://your-workspace.cloud.databricks.com
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com uvicorn main:app --reload

# Terminal 2: Vite dev server (proxies /api to :8000)
cd apps/uc_browser/frontend
npm install
npm run dev
# Open http://localhost:5173
```

In local dev, there's no OBO token (no Databricks proxy), so the backend falls back to the SDK's default auth (your CLI credentials). The header shows "Local Dev" instead of "OBO Active".

---

## The Code

Full source: [github.com/your-username/databricks-uc-browser](https://github.com/your-username/databricks-uc-browser)

```
databricks-uc-browser/
├── databricks.yml              ← DAB bundle config
├── apps/uc_browser/
│   ├── main.py                 ← FastAPI backend (OBO auth + UC APIs)
│   ├── app.yaml                ← Databricks App startup command
│   ├── requirements.txt
│   ├── .databricksignore       ← Excludes frontend/ from upload
│   └── frontend/
│       ├── vite.config.ts      ← outDir: '../static'
│       └── src/
│           ├── App.tsx
│           ├── api.ts
│           └── components/
│               ├── Header.tsx
│               ├── Sidebar.tsx
│               ├── TableViewer.tsx
│               └── QueryPanel.tsx
└── .github/workflows/
    └── deploy.yml              ← CI/CD: build + deploy on push to main
```

---

## Summary

| Old approach | With OBO |
|---|---|
| Create service principal | Not needed |
| Grant SP access to UC catalogs | Not needed |
| Create PAT + secret scope | Not needed |
| Rotate credentials every 90 days | Not needed |
| SP sees all data regardless of user | User only sees what they're granted |
| Admin work per environment | Enable one Preview toggle, done |

On-Behalf-Of is a single workspace toggle that eliminates an entire category of DevOps work. Once it's on, your app inherits the user's identity and Unity Catalog does the rest.

---

*Built with Databricks Apps, FastAPI, React, Vite, Tailwind CSS, and Databricks Asset Bundles.*
