import { useState, useEffect } from 'react'
import { api, UserInfo, TableDetail, QueryResult } from './api'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import TableViewer from './components/TableViewer'
import QueryPanel from './components/QueryPanel'

export interface SelectedTable {
  catalog: string
  schema: string
  table: string
}

function App() {
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null)
  const [selectedTable, setSelectedTable] = useState<SelectedTable | null>(null)
  const [tableDetail, setTableDetail] = useState<TableDetail | null>(null)
  const [tableLoading, setTableLoading] = useState(false)
  const [tableError, setTableError] = useState<string | null>(null)
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null)
  const [queryLoading, setQueryLoading] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)

  useEffect(() => {
    api.getMe().then(setUserInfo).catch(console.error)
  }, [])

  const handleTableSelect = async (catalog: string, schema: string, table: string) => {
    setSelectedTable({ catalog, schema, table })
    setTableDetail(null)
    setTableError(null)
    setQueryResult(null)
    setQueryError(null)
    setTableLoading(true)
    try {
      const detail = await api.getTableDetail(catalog, schema, table)
      setTableDetail(detail)
    } catch (e: unknown) {
      setTableError(e instanceof Error ? e.message : String(e))
    } finally {
      setTableLoading(false)
    }
  }

  const handleQuery = async (sql: string) => {
    setQueryResult(null)
    setQueryError(null)
    setQueryLoading(true)
    try {
      const result = await api.runQuery(sql)
      setQueryResult(result)
    } catch (e: unknown) {
      setQueryError(e instanceof Error ? e.message : String(e))
    } finally {
      setQueryLoading(false)
    }
  }

  const defaultSql = selectedTable
    ? `SELECT *\nFROM \`${selectedTable.catalog}\`.\`${selectedTable.schema}\`.\`${selectedTable.table}\`\nLIMIT 100`
    : ''

  return (
    <div className="flex flex-col h-screen bg-gray-50 font-sans">
      <Header userInfo={userInfo} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar onTableSelect={handleTableSelect} selectedTable={selectedTable} />
        <main className="flex-1 flex flex-col overflow-hidden p-5 gap-4 min-w-0">
          <TableViewer
            selected={selectedTable}
            detail={tableDetail}
            loading={tableLoading}
            error={tableError}
          />
          <QueryPanel
            defaultSql={defaultSql}
            onQuery={handleQuery}
            result={queryResult}
            loading={queryLoading}
            error={queryError}
          />
        </main>
      </div>
    </div>
  )
}

export default App
