import React from 'react'

interface DashboardSidebarProps {
  activeTab: string
  onTabChange: (tab: any) => void
}

export const DashboardSidebar: React.FC<DashboardSidebarProps> = ({
  activeTab,
  onTabChange,
}) => {
  const navItems = [
    { key: 'overview', label: 'Dashboard', icon: 'dashboard' },
    { key: 'fundamental', label: 'Fundamentals', icon: 'analytics' },
    { key: 'technical', label: 'Technicals', icon: 'show_chart' },
    { key: 'sentiment', label: 'Sentiment', icon: 'psychology' },
    { key: 'full-report', label: 'Reports', icon: 'description' },
  ]

  return (
    <aside className="bg-slate-100 dark:bg-slate-900 h-screen w-64 fixed left-0 top-0 pt-16 flex-col gap-2 p-4 hidden lg:flex">
      <div className="mb-6 px-4">
        <h2 className="font-['Inter'] font-black text-slate-900 dark:text-slate-50 text-sm">
          Terminal v1.0
        </h2>
        <p className="font-['Space_Grotesk'] font-medium text-[10px] uppercase tracking-[0.2em] text-slate-500">
          Analyst View
        </p>
      </div>

      <nav className="flex flex-col gap-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.key
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onTabChange(item.key)}
              className={
                isActive
                  ? "flex items-center gap-3 bg-white dark:bg-slate-800 text-slate-900 dark:text-white rounded-md px-4 py-3 shadow-sm active:scale-95 duration-200 transition-all cursor-pointer w-full text-left"
                  : "flex items-center gap-3 text-slate-500 dark:text-slate-400 px-4 py-3 hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-all active:scale-95 duration-200 cursor-pointer rounded-md w-full text-left"
              }
            >
              <span className="material-symbols-outlined text-lg">{item.icon}</span>
              <span className="font-['Space_Grotesk'] font-medium text-xs uppercase tracking-widest">
                {item.label}
              </span>
            </button>
          )
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-slate-200/50">
        <button
          type="button"
          className="flex flex-row items-center gap-3 text-slate-500 dark:text-slate-400 px-4 py-3 w-full text-left hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-all active:scale-95 duration-200 cursor-pointer rounded-md"
        >
          <span className="material-symbols-outlined text-lg">settings</span>
          <span className="font-['Space_Grotesk'] font-medium text-xs uppercase tracking-widest">
            Settings
          </span>
        </button>
        <button
          type="button"
          className="flex flex-row items-center gap-3 text-slate-500 dark:text-slate-400 px-4 py-3 w-full text-left hover:bg-slate-200/50 dark:hover:bg-slate-800/50 transition-all active:scale-95 duration-200 cursor-pointer rounded-md"
        >
          <span className="material-symbols-outlined text-lg">help_outline</span>
          <span className="font-['Space_Grotesk'] font-medium text-xs uppercase tracking-widest">
            Support
          </span>
        </button>
      </div>
    </aside>
  )
}
