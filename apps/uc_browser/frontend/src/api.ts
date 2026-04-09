/**
 * API client — all paths are relative so they work both in production
 * (same origin, FastAPI serves everything) and in local dev (Vite proxies
 * /api to localhost:8000 via vite.config.ts).
 */

export interface UserInfo {
  user: string
  on_behalf_of: boolean
}

export interface TableColumn {
  name: string
  type: string
  nullable: boolean
}

export interface TableDetail {
  columns: TableColumn[]
  sample_rows: (string | null)[][]
}

export interface QueryResult {
  columns: string[]
  rows: (string | null)[][]
  row_count: number
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail: string }).detail || res.statusText)
  }
  return res.json() as Promise<T>
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail: string }).detail || res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  getMe: () =>
    get<UserInfo>('/api/me'),

  getCatalogs: () =>
    get<{ catalogs: string[] }>('/api/catalogs'),

  getSchemas: (catalog: string) =>
    get<{ schemas: string[] }>(`/api/catalogs/${encodeURIComponent(catalog)}/schemas`),

  getTables: (catalog: string, schema: string) =>
    get<{ tables: string[] }>(
      `/api/catalogs/${encodeURIComponent(catalog)}/schemas/${encodeURIComponent(schema)}/tables`
    ),

  getTableDetail: (catalog: string, schema: string, table: string) =>
    get<TableDetail>(
      `/api/catalogs/${encodeURIComponent(catalog)}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}`
    ),

  runQuery: (sql: string) =>
    post<QueryResult>('/api/query', { sql }),
}
