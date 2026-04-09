import { useState, useEffect, useRef } from 'react'
import { QueryResult } from '../api'

interface Props {
  defaultSql: string
  onQuery: (sql: string) => void
  result: QueryResult | null
  loading: boolean
  error: string | null
}

export default function QueryPanel({ defaultSql, onQuery, result, loading, error }: Props) {
  const [sql, setSql] = useState(defaultSql)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Update SQL when a new table is selected
  useEffect(() => {
    setSql(defaultSql)
  }, [defaultSql])

  const handleRun = () => {
    const trimmed = sql.trim()
    if (trimmed) onQuery(trimmed)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden flex flex-col flex-1 min-h-0">
      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-700">SQL Query</h3>
          <span className="text-[11px] text-gray-400 ml-1">⌘ + Enter to run</span>
        </div>
        <button
          onClick={handleRun}
          disabled={loading || !sql.trim()}
          className="flex items-center gap-1.5 bg-[#FF3621] text-white text-sm font-medium px-4 py-1.5 rounded-lg hover:bg-[#e02d1c] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              Running...
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
              </svg>
              Run Query
            </>
          )}
        </button>
      </div>

      {/* SQL editor */}
      <textarea
        ref={textareaRef}
        value={sql}
        onChange={e => setSql(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            handleRun()
          }
        }}
        placeholder="SELECT * FROM `catalog`.`schema`.`table` LIMIT 100"
        className="w-full px-5 py-3 font-mono text-sm text-gray-800 bg-gray-50/50 resize-none outline-none border-b border-gray-100 shrink-0"
        rows={4}
        spellCheck={false}
      />

      {/* Error */}
      {error && (
        <div className="px-5 py-3 text-sm text-red-600 bg-red-50 border-b border-red-100 shrink-0 flex items-start gap-2">
          <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="px-5 py-2 text-xs text-gray-500 border-b border-gray-100 bg-gray-50/50 shrink-0 flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
            </svg>
            <span>
              <strong>{result.row_count.toLocaleString()}</strong> row{result.row_count !== 1 ? 's' : ''} returned
            </span>
          </div>
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="bg-gray-50 border-b border-gray-100">
                  {result.columns.map(col => (
                    <th
                      key={col}
                      className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b border-gray-50 ${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/30'} hover:bg-blue-50/30`}
                  >
                    {row.map((cell, j) => (
                      <td
                        key={j}
                        className="px-4 py-1.5 font-mono text-xs text-gray-700 whitespace-nowrap max-w-xs"
                        title={cell !== null ? String(cell) : 'null'}
                      >
                        {cell === null ? (
                          <span className="text-gray-300 italic">null</span>
                        ) : (
                          <span className="block truncate">{String(cell)}</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !error && !loading && (
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          <div className="text-center">
            <svg className="w-8 h-8 text-gray-200 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
            </svg>
            Results will appear here
          </div>
        </div>
      )}
    </div>
  )
}
