"""
Unity Catalog Browser — FastAPI backend
Auth: Databricks Apps On-Behalf-Of (OBO) — queries run as the logged-in user
"""
import os
import logging
from typing import Optional

from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from databricks.sdk import WorkspaceClient
from databricks.sdk.service.sql import StatementState
from pydantic import BaseModel
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_HOST = os.environ.get("DATABRICKS_HOST", "")
_warehouse_id: Optional[str] = None

# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------

def get_client(user_token: Optional[str] = None) -> WorkspaceClient:
    """
    Return a WorkspaceClient.
    When OBO is active the user's OAuth token is passed; auth_type="pat" tells
    the SDK to use ONLY this token and ignore the SP credentials in env vars
    (otherwise it throws "more than one authorization method configured").
    """
    if user_token:
        return WorkspaceClient(host=_HOST, token=user_token, auth_type="pat")
    return WorkspaceClient()


def user_token_from(request: Request) -> Optional[str]:
    """Extract the OBO token injected by the Databricks Apps proxy."""
    return request.headers.get("X-Forwarded-Access-Token") or None


# ---------------------------------------------------------------------------
# Warehouse auto-discovery (cached after first call)
# ---------------------------------------------------------------------------

def get_warehouse_id(client: Optional[WorkspaceClient] = None) -> str:
    global _warehouse_id
    if _warehouse_id:
        return _warehouse_id
    # Allow override via env var
    from_env = os.environ.get("DATABRICKS_WAREHOUSE_ID", "").strip()
    if from_env:
        _warehouse_id = from_env
        logger.info(f"Using warehouse from env: {_warehouse_id}")
        return _warehouse_id
    # Auto-discover first available warehouse
    w = client or get_client()
    for wh in w.warehouses.list():
        if wh.id:
            _warehouse_id = wh.id
            logger.info(f"Auto-discovered warehouse: {wh.name} ({wh.id})")
            return _warehouse_id
    raise RuntimeError("No SQL warehouse found in this workspace")


# ---------------------------------------------------------------------------
# SQL execution
# ---------------------------------------------------------------------------

def execute_sql(statement: str, user_token: Optional[str] = None):
    w = get_client(user_token)
    warehouse_id = get_warehouse_id(w)
    result = w.statement_execution.execute_statement(
        warehouse_id=warehouse_id,
        statement=statement,
        wait_timeout="30s",
    )
    if result.status.state == StatementState.FAILED:
        raise HTTPException(
            status_code=400,
            detail=f"SQL error: {result.status.error.message}",
        )
    return result


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Unity Catalog Browser", version="1.0.0")

# Allow CORS for local development (Vite dev server on :5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"

# IMPORTANT: mount static assets BEFORE the catch-all route.
# If the catch-all is registered first, /assets/... requests are intercepted.
if (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------

@app.get("/api/me")
def get_me(request: Request):
    """Return the currently logged-in user and OBO status."""
    user = request.headers.get("X-Forwarded-Email") or "local-dev"
    token = user_token_from(request)
    return {"user": user, "on_behalf_of": bool(token)}


@app.get("/api/catalogs")
def list_catalogs(request: Request):
    """List all Unity Catalog catalogs the user has access to."""
    token = user_token_from(request)
    w = get_client(token)
    try:
        catalogs = sorted(c.name for c in w.catalogs.list() if c.name)
        return {"catalogs": catalogs}
    except Exception as e:
        logger.error(f"list_catalogs error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/catalogs/{catalog}/schemas")
def list_schemas(catalog: str, request: Request):
    """List schemas within a catalog."""
    token = user_token_from(request)
    w = get_client(token)
    try:
        schemas = sorted(s.name for s in w.schemas.list(catalog_name=catalog) if s.name)
        return {"schemas": schemas}
    except Exception as e:
        logger.error(f"list_schemas error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/catalogs/{catalog}/schemas/{schema}/tables")
def list_tables(catalog: str, schema: str, request: Request):
    """List tables and views within a schema."""
    token = user_token_from(request)
    w = get_client(token)
    try:
        tables = sorted(t.name for t in w.tables.list(catalog_name=catalog, schema_name=schema) if t.name)
        return {"tables": tables}
    except Exception as e:
        logger.error(f"list_tables error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/catalogs/{catalog}/schemas/{schema}/tables/{table}")
def get_table_detail(catalog: str, schema: str, table: str, request: Request):
    """Return column schema and a 10-row sample for a table."""
    token = user_token_from(request)
    w = get_client(token)

    # Column schema via Unity Catalog API
    try:
        table_info = w.tables.get(full_name=f"{catalog}.{schema}.{table}")
        columns = []
        if table_info.columns:
            columns = [
                {
                    "name": col.name,
                    "type": col.type_text or str(col.type_name),
                    "nullable": col.nullable if col.nullable is not None else True,
                }
                for col in table_info.columns
            ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get table info: {e}")

    # 10-row sample (best-effort — user may not have SELECT)
    sample_rows: list = []
    try:
        result = execute_sql(
            f"SELECT * FROM `{catalog}`.`{schema}`.`{table}` LIMIT 10",
            token,
        )
        if result.result and result.result.data_array:
            sample_rows = result.result.data_array
    except Exception:
        pass  # sample is optional

    return {"columns": columns, "sample_rows": sample_rows}


class QueryRequest(BaseModel):
    sql: str


# Simple allowlist — only SELECT statements
_BLOCKED_PREFIXES = ("DROP ", "DELETE ", "TRUNCATE ", "ALTER ", "INSERT ", "UPDATE ", "MERGE ", "CREATE ", "REPLACE ")


@app.post("/api/query")
def run_query(body: QueryRequest, request: Request):
    """Execute a SQL statement and return results (SELECT only)."""
    token = user_token_from(request)
    sql_upper = body.sql.strip().upper()

    for prefix in _BLOCKED_PREFIXES:
        if sql_upper.startswith(prefix):
            raise HTTPException(
                status_code=400,
                detail=f"Only SELECT statements are allowed. Blocked keyword: {prefix.strip()}",
            )

    result = execute_sql(body.sql.strip(), token)

    columns: list[str] = []
    rows: list = []

    if result.manifest and result.manifest.schema and result.manifest.schema.columns:
        columns = [col.name or "" for col in result.manifest.schema.columns]
    if result.result and result.result.data_array:
        rows = result.result.data_array

    return {"columns": columns, "rows": rows, "row_count": len(rows)}


# ---------------------------------------------------------------------------
# SPA catch-all — MUST be last
# ---------------------------------------------------------------------------

@app.get("/{full_path:path}", response_class=HTMLResponse, include_in_schema=False)
def serve_spa(full_path: str = ""):
    """Serve the React SPA for every non-API route."""
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        return HTMLResponse(
            content=(
                "<h2>Frontend not built</h2>"
                "<p>Run <code>npm install && npm run build</code> inside "
                "<code>apps/uc_browser/frontend/</code> first.</p>"
            ),
            status_code=503,
        )
    return HTMLResponse(index_path.read_text())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("UVICORN_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, log_level="info")
