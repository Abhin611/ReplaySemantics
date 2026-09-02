import { NavLink } from 'react-router-dom'
import {
  GitBranch,
  LayoutDashboard,
  Folder,
  PlayCircle,
  Share2,
  PieChart,
  ShieldCheck,
  History,
  SlidersHorizontal,
  LogOut,
} from 'lucide-react'
import { mockUser } from '../data/mockData'

const analysisLinks = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/cases', label: 'Cases', icon: Folder },
  { to: '/replay-console', label: 'Replay Console', icon: PlayCircle },
  { to: '/replay-graph', label: 'Replay Graph', icon: Share2 },
  { to: '/attribution', label: 'Attribution', icon: PieChart },
]

const systemLinks = [
  { to: '/policies', label: 'Policies', icon: ShieldCheck },
  { to: '/audit-log', label: 'Audit Log', icon: History },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal },
]

function NavSection({ title, links }) {
  return (
    <div className="mt-6 first:mt-0">
      <div className="px-4 pb-2 text-[11px] font-semibold tracking-wide text-[#5c7488]">
        {title}
      </div>
      <nav className="flex flex-col gap-0.5 px-2">
        {links.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
                isActive
                  ? 'bg-navy-700 text-white font-semibold'
                  : 'text-[#9fb0bf] hover:bg-navy-800 hover:text-white'
              }`
            }
          >
            <Icon size={16} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function Sidebar() {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col bg-navy-950 text-white">
      <div className="flex items-center gap-2.5 px-5 py-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-500">
          <GitBranch size={17} strokeWidth={2.5} />
        </div>
        <span className="text-[15px] font-bold tracking-tight">ReplaySemantics</span>
      </div>

      <div className="flex-1 overflow-y-auto pb-4">
        <NavSection title="ANALYSIS" links={analysisLinks} />
        <NavSection title="SYSTEM" links={systemLinks} />
      </div>

      <div className="border-t border-navy-800 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-500 text-[12px] font-bold">
            {mockUser.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{mockUser.name}</div>
            <div className="truncate text-[11px] text-[#7f93a3]">{mockUser.role}</div>
          </div>
          <LogOut size={15} className="shrink-0 text-[#7f93a3]" />
        </div>
      </div>
    </aside>
  )
}
