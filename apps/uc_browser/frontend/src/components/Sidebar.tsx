import { useState, useEffect } from 'react'
import { api } from '../api'
import { SelectedTable } from '../App'

interface Props {
  onTableSelect: (catalog: string, schema: string, table: string) => void
  selectedTable: SelectedTable | null
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-gray-400 shrink-0 transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg className="animate-spin w-3 h-3 text-gray-400" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}

function CatalogIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-orange-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
    </svg>
  )
}

function SchemaIcon() {
  return (
    <svg className="w-3.5 h-3.5 text-blue-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
      <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 4h14v8a1 1 0 01-1 1H4a1 1 0 01-1-1V8z" clipRule="evenodd" />
    </svg>
  )
}

function TableIcon({ active }: { active?: boolean }) {
  return (
    <svg className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-blue-500' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path strokeLinecap="round" d="M3 9h18M3 15h18M9 3v18" />
    </svg>
  )
}

export default function Sidebar({ onTableSelect, selectedTable }: Props) {
  const [catalogs, setCatalogs] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [openCatalogs, setOpenCatalogs] = useState<Record<string, boolean>>({})
  const [openSchemas, setOpenSchemas] = useState<Record<string, boolean>>({})

  const [schemas, setSchemas] = useState<Record<string, string[]>>({})
  const [tables, setTables] = useState<Record<string, string[]>>({})

  const [schemaLoading, setSchemaLoading] = useState<Record<string, boolean>>({})
  const [tableLoading, setTableLoading] = useState<Record<string, boolean>>({})

  useEffect(() => {
    api.getCatalogs()
      .then(r => setCatalogs(r.catalogs))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const toggleCatalog = async (catalog: string) => {
    const willOpen = !openCatalogs[catalog]
    setOpenCatalogs(prev => ({ ...prev, [catalog]: willOpen }))
    if (willOpen && !schemas[catalog]) {
      setSchemaLoading(prev => ({ ...prev, [catalog]: true }))
      try {
        const r = await api.getSchemas(catalog)
        setSchemas(prev => ({ ...prev, [catalog]: r.schemas }))
      } catch (e: unknown) {
        console.error(e)
      } finally {
        setSchemaLoading(prev => ({ ...prev, [catalog]: false }))
      }
    }
  }

  const toggleSchema = async (catalog: string, schema: string) => {
    const key = `${catalog}.${schema}`
    const willOpen = !openSchemas[key]
    setOpenSchemas(prev => ({ ...prev, [key]: willOpen }))
    if (willOpen && !tables[key]) {
      setTableLoading(prev => ({ ...prev, [key]: true }))
      try {
        const r = await api.getTables(catalog, schema)
        setTables(prev => ({ ...prev, [key]: r.tables }))
      } catch (e: unknown) {
        console.error(e)
      } finally {
        setTableLoading(prev => ({ ...prev, [key]: false }))
      }
    }
  }

  return (
    <aside className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 shrink-0">
        <h2 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest">
          Catalog Explorer
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {loading && (
          <div className="flex items-center gap-2 px-4 py-3 text-sm text-gray-400">
            <Spinner /> Loading catalogs...
          </div>
        )}
        {error && (
          <div className="px-4 py-3 text-xs text-red-500 bg-red-50 m-2 rounded">{error}</div>
        )}
        {!loading && !error && catalogs.length === 0 && (
          <div className="px-4 py-3 text-sm text-gray-400">No catalogs found</div>
        )}

        {catalogs.map(catalog => (
          <div key={catalog}>
            {/* Catalog row */}
            <button
              onClick={() => toggleCatalog(catalog)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 text-left group"
            >
              <Chevron open={!!openCatalogs[catalog]} />
              <CatalogIcon />
              <span className="text-sm text-gray-800 font-medium truncate flex-1">{catalog}</span>
              {schemaLoading[catalog] && <Spinner />}
            </button>

            {/* Schemas */}
            {openCatalogs[catalog] && (schemas[catalog] || []).map(schema => (
              <div key={schema}>
                <button
                  onClick={() => toggleSchema(catalog, schema)}
                  className="w-full flex items-center gap-2 pl-7 pr-3 py-1.5 hover:bg-gray-50 text-left"
                >
                  <Chevron open={!!openSchemas[`${catalog}.${schema}`]} />
                  <SchemaIcon />
                  <span className="text-sm text-gray-700 truncate flex-1">{schema}</span>
                  {tableLoading[`${catalog}.${schema}`] && <Spinner />}
                </button>

                {/* Tables */}
                {openSchemas[`${catalog}.${schema}`] && (
                  <div>
                    {(tables[`${catalog}.${schema}`] || []).length === 0 && !tableLoading[`${catalog}.${schema}`] && (
                      <div className="pl-14 pr-3 py-1 text-xs text-gray-400">Empty schema</div>
                    )}
                    {(tables[`${catalog}.${schema}`] || []).map(table => {
                      const active =
                        selectedTable?.catalog === catalog &&
                        selectedTable?.schema === schema &&
                        selectedTable?.table === table
                      return (
                        <button
                          key={table}
                          onClick={() => onTableSelect(catalog, schema, table)}
                          className={`w-full flex items-center gap-2 pl-11 pr-3 py-1.5 text-left transition-colors ${
                            active
                              ? 'bg-blue-50 border-r-2 border-blue-500'
                              : 'hover:bg-gray-50'
                          }`}
                        >
                          <TableIcon active={active} />
                          <span className={`text-sm truncate ${active ? 'text-blue-700 font-medium' : 'text-gray-600'}`}>
                            {table}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}
