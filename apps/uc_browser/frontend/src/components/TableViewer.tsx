import { TableDetail } from '../api'
import { SelectedTable } from '../App'

interface Props {
  selected: SelectedTable | null
  detail: TableDetail | null
  loading: boolean
  error: string | null
}

export default function TableViewer({ selected, detail, loading, error }: Props) {
  if (!selected) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 flex items-center justify-center py-12 shrink-0">
        <div className="text-center">
          <svg className="w-10 h-10 text-gray-200 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path strokeLinecap="round" d="M3 9h18M3 15h18M9 3v18" />
          </svg>
          <p className="text-sm text-gray-400 font-medium">Select a table from the sidebar</p>
          <p className="text-xs text-gray-300 mt-1">Schema and sample data will appear here</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shrink-0">
      {/* Table path breadcrumb */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-1.5 bg-gray-50/50">
        <span className="text-xs text-gray-400 font-mono">{selected.catalog}</span>
        <span className="text-gray-300 text-xs">/</span>
        <span className="text-xs text-gray-400 font-mono">{selected.schema}</span>
        <span className="text-gray-300 text-xs">/</span>
        <span className="text-sm font-semibold text-gray-800 font-mono">{selected.table}</span>
        {loading && (
          <svg className="animate-spin w-3.5 h-3.5 text-gray-400 ml-2" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
        )}
        {detail && (
          <span className="ml-auto text-xs text-gray-400">
            {detail.columns.length} column{detail.columns.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {error && (
        <div className="px-5 py-3 text-sm text-red-600 bg-red-50 border-b border-red-100">{error}</div>
      )}

      {loading && (
        <div className="px-5 py-4 text-sm text-gray-400">Loading schema...</div>
      )}

      {detail && detail.columns.length > 0 && (
        <div className="overflow-x-auto max-h-48">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Column</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-4 py-2 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Nullable</th>
              </tr>
            </thead>
            <tbody>
              {detail.columns.map((col, i) => (
                <tr key={col.name} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'}>
                  <td className="px-4 py-1.5 font-mono text-gray-800 font-medium text-xs">{col.name}</td>
                  <td className="px-4 py-1.5 font-mono text-blue-600 text-xs">{col.type}</td>
                  <td className="px-4 py-1.5 text-xs">
                    <span className={col.nullable ? 'text-gray-400' : 'text-gray-700 font-medium'}>
                      {col.nullable ? 'YES' : 'NO'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
