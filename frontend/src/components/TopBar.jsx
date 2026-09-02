import { Search, Bell } from 'lucide-react'

export default function TopBar({ title }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-[#e2e6ea] bg-white px-8 py-4">
      <h1 className="text-xl font-bold tracking-tight text-[#101828]">{title}</h1>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a97a3]"
          />
          <input
            type="text"
            placeholder="Search cases, events..."
            className="w-72 rounded-lg border border-[#e2e6ea] bg-[#f7f8fa] py-2 pl-9 pr-3 text-[13px] text-[#101828] placeholder:text-[#8a97a3] focus:bg-white"
          />
        </div>
        <button
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[#5c6b7a] hover:bg-[#f2f4f6]"
        >
          <Bell size={17} />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-status-blocked" />
        </button>
      </div>
    </header>
  )
}
