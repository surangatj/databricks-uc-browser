import { UserInfo } from '../api'

interface Props {
  userInfo: UserInfo | null
}

export default function Header({ userInfo }: Props) {
  return (
    <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0 shadow-sm">
      {/* Logo + title */}
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-[#FF3621] rounded-lg flex items-center justify-center shadow-sm">
          <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 9h16M9 9v11" />
          </svg>
        </div>
        <div>
          <h1 className="text-base font-semibold text-gray-900 leading-tight">
            Unity Catalog Browser
          </h1>
          <p className="text-[11px] text-gray-400 leading-tight">
            Databricks Apps · On-Behalf-Of Auth
          </p>
        </div>
      </div>

      {/* User info */}
      <div className="flex items-center gap-2.5">
        {userInfo ? (
          <>
            <div
              className={`w-2 h-2 rounded-full ${
                userInfo.on_behalf_of ? 'bg-green-400' : 'bg-amber-400'
              }`}
              title={userInfo.on_behalf_of ? 'OBO token active' : 'No OBO token (local dev?)'}
            />
            <span className="text-sm text-gray-600 font-medium">{userInfo.user}</span>
            {userInfo.on_behalf_of ? (
              <span className="text-[11px] bg-green-50 text-green-700 border border-green-200 rounded-full px-2.5 py-0.5 font-medium">
                OBO Active
              </span>
            ) : (
              <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5 font-medium">
                Local Dev
              </span>
            )}
          </>
        ) : (
          <span className="text-sm text-gray-400 animate-pulse">Loading...</span>
        )}
      </div>
    </header>
  )
}
