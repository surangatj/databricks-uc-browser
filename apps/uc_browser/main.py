"""
Unity Catalog Browser — FastAPI backend
Auth: Databricks Apps On-Behalf-Of (OBO) — queries run as the logged-in user

All catalog/schema/table browsing uses SQL (SHOW CATALOGS, SHOW SCHEMAS, etc.)
so only the 'sql' OBO scope is needed — no unity-catalog SDK scope required.
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
    Return a WorkspaceClient using the OBO token when available.
    auth_type="pat" prevents the SDK from throwing
    "more than one authorization method configured" when both the OBO token
    and the SP credentials (DATABRICKS_CLIENT_ID/SECRET) are present.
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
    from_env = os.environ.get("DATABRICKS_WAREHOUSE_ID", "").strip()
    if from_env:
        _warehouse_id = from_env
        logger.info(f"Using warehouse from env: {_warehouse_id}")
        return _warehouse_id
    w = client or get_client()
    for wh in w.warehouses.list():
        if wh.id:
            _warehouse_id = wh.id
            logger.info(f"Auto-discovered warehouse: {wh.name} ({wh.id})")
            return _warehouse_id
    raise RuntimeError("No SQL warehouse found in this workspace")


# ---------------------------------------------------------------------------
# SQL execution helper
# ---------------------------------------------------------------------------

def run_sql(statement: str, user_token: Optional[str] = None) -> tuple[list[str], list[list]]:
    """
    Execute a SQL statement and return (columns, rows).
    Uses the OBO token so Unity Catalog enforces the user's own permissions.
    """
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
    columns: list[str] = []
    rows: list[list] = []
    if result.manifest and result.manifest.schema and result.manifest.schema.columns:
        columns = [col.name or "" for col in result.manifest.schema.columns]
    if result.result and result.result.data_array:
        rows = result.result.data_array
    return columns, rows


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Unity Catalog Browser", version="1.0.0")

# CORS for local Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = Path(__file__).parent / "static"

# Mount static assets BEFORE the catch-all route
if (STATIC_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")


# ---------------------------------------------------------------------------
# API routes — all UC browsing via SQL (only 'sql' OBO scope needed)
# ---------------------------------------------------------------------------

@app.get("/api/me")
def get_me(request: Request):
    """Return the currently logged-in user and OBO status."""
    user = request.headers.get("X-Forwarded-Email") or "local-dev"
    token = user_token_from(request)
    return {"user": user, "on_behalf_of": bool(token)}


@app.get("/api/catalogs")
def list_catalogs(request: Request):
    """List all catalogs the user can see via SHOW CATALOGS."""
    token = user_token_from(request)
    try:
        _, rows = run_sql("SHOW CATALOGS", token)
        # SHOW CATALOGS returns: catalog (col 0)
        catalogs = sorted(r[0] for r in rows if r and r[0])
        return {"catalogs": catalogs}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/catalogs/{catalog}/schemas")
def list_schemas(catalog: str, request: Request):
    """List schemas in a catalog via SHOW SCHEMAS."""
    token = user_token_from(request)
    try:
        _, rows = run_sql(f"SHOW SCHEMAS IN `{catalog}`", token)
        # SHOW SCHEMAS returns: databaseName (col 0)
        schemas = sorted(r[0] for r in rows if r and r[0])
        return {"schemas": schemas}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/catalogs/{catalog}/schemas/{schema}/tables")
def list_tables(catalog: str, schema: str, request: Request):
    """List tables and views via SHOW TABLES."""
    token = user_token_from(request)
    try:
        _, rows = run_sql(f"SHOW TABLES IN `{catalog}`.`{schema}`", token)
        # SHOW TABLES returns: namespace, tableName, isTemporary
        tables = sorted(r[1] for r in rows if r and len(r) > 1 and r[1])
        return {"tables": tables}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/catalogs/{catalog}/schemas/{schema}/tables/{table}")
def get_table_detail(catalog: str, schema: str, table: str, request: Request):
    """Return column schema via DESCRIBE TABLE and a 10-row sample."""
    token = user_token_from(request)

    # Column schema via DESCRIBE TABLE
    try:
        _, rows = run_sql(
            f"DESCRIBE TABLE `{catalog}`.`{schema}`.`{table}`", token
        )
        columns = []
        for r in rows:
            if not r or not r[0]:
                break  # DESCRIBE TABLE has a blank separator before partitioning info
            col_name = r[0]
            col_type = r[1] if len(r) > 1 else ""
            if col_name.startswith("#"):
                break  # partition/detail section starts
            columns.append({"name": col_name, "type": col_type, "nullable": True})
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to describe table: {e}")

    # 10-row sample (best-effort)
    sample_rows: list = []
    try:
        _, sample_rows = run_sql(
            f"SELECT * FROM `{catalog}`.`{schema}`.`{table}` LIMIT 10", token
        )
    except Exception:
        pass

    return {"columns": columns, "sample_rows": sample_rows}


# ---------------------------------------------------------------------------
# SQL query endpoint
# ---------------------------------------------------------------------------

_BLOCKED_PREFIXES = (
    "DROP ", "DELETE ", "TRUNCATE ", "ALTER ",
    "INSERT ", "UPDATE ", "MERGE ", "CREATE ", "REPLACE ",
)


@app.post("/api/query")
def run_query(body: "QueryRequest", request: Request):
    """Execute a SELECT statement and return results."""
    token = user_token_from(request)
    sql_upper = body.sql.strip().upper()

    for prefix in _BLOCKED_PREFIXES:
        if sql_upper.startswith(prefix):
            raise HTTPException(
                status_code=400,
                detail=f"Only SELECT statements are allowed. Blocked: {prefix.strip()}",
            )

    columns, rows = run_sql(body.sql.strip(), token)
    return {"columns": columns, "rows": rows, "row_count": len(rows)}


class QueryRequest(BaseModel):
    sql: str


# ---------------------------------------------------------------------------
# SPA catch-all — MUST be last
# ---------------------------------------------------------------------------

@app.get("/{full_path:path}", response_class=HTMLResponse, include_in_schema=False)
def serve_spa(full_path: str = ""):
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
