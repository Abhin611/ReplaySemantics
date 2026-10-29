import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  Bell, ChevronDown, FlaskConical, Folder, GitBranch, History, LayoutDashboard, Menu, PieChart,
  PlayCircle, Search, Share2, ShieldCheck, SlidersHorizontal, X,
} from 'lucide-react'
import { mockUser } from '../data/mockData'

const MAIN = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/cases', label: 'Cases', icon: Folder },
  { to: '/replay-console', label: 'Replay Console', icon: PlayCircle },
  { to: '/replay-graph', label: 'Replay Graph', icon: Share2 },
  { to: '/attribution', label: 'Attribution', icon: PieChart },
  { to: '/scenario', label: 'Corrected Scenario', icon: FlaskConical },
]
const SYSTEM = [
  { to: '/policies', label: 'Policies', icon: ShieldCheck },
  { to: '/audit-log', label: 'Audit Log', icon: History },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal },
]
const isActivePath = (pathname, link) => (link.end ? pathname === link.to : pathname.startsWith(link.to))

// Top navigation bar. A single pill slides under whichever page is open; the three system pages sit
// in one "System" menu so the six analysis pages get the room. Below 768px it folds into a menu.
export default function TopNav() {
  const { pathname } = useLocation()
  const trackRef = useRef(null)
  const itemRefs = useRef({})
  const [pill, setPill] = useState(null) // { left, width } of the active item, or null when a system page is open
  const [menuOpen, setMenuOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const systemActive = SYSTEM.some((l) => isActivePath(pathname, l))

  const measure = () => {
    const track = trackRef.current
    const active = MAIN.find((l) => isActivePath(pathname, l))
    const el = active && itemRefs.current[active.to]
    if (!track || !el) return setPill(null)
    setPill({ left: el.offsetLeft, width: el.offsetWidth })
  }
  useLayoutEffect(measure, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.addEventListener('resize', measure)
    document.fonts?.ready?.then(measure)
    return () => window.removeEventListener('resize', measure)
  }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    setMenuOpen(false)
    setMobileOpen(false)
  }, [pathname])
  useEffect(() => {
    if (!menuOpen) return undefined
    const close = (e) => { if (!e.target.closest?.('[data-system-menu]')) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  return (
    <header className="relative z-30 shrink-0 border-b border-white/5 bg-navy-950/95 text-white shadow-[0_8px_24px_-12px_rgba(10,20,31,0.6)] backdrop-blur">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-teal-400/50 to-transparent" />
      <div className="flex h-14 items-center gap-4 px-4 lg:px-6">
        {/* Brand */}
        <NavLink to="/" className="group flex shrink-0 items-center gap-2.5" aria-label="ReplaySemantics home">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-teal-500 shadow-[0_0_0_0_rgba(69,179,165,0.6)] transition-shadow duration-300 group-hover:shadow-[0_0_0_5px_rgba(69,179,165,0.18)]">
            <GitBranch size={17} strokeWidth={2.5} />
          </span>
          <span className="hidden text-[15px] font-bold tracking-tight min-[1100px]:inline">ReplaySemantics</span>
        </NavLink>

        <span className="hidden h-6 w-px bg-white/10 md:block" aria-hidden="true" />

        {/* Page links */}
        <nav aria-label="Main" className="relative hidden min-w-0 flex-1 md:block">
          <div ref={trackRef} className="relative flex w-fit items-center gap-0.5">
            <span
              aria-hidden="true"
              className="absolute inset-y-0 rounded-lg bg-white/10 ring-1 ring-inset ring-white/10 transition-[left,width,opacity] duration-500 ease-[cubic-bezier(0.34,1.4,0.5,1)]"
              style={pill ? { left: pill.left, width: pill.width, opacity: 1 } : { left: 0, width: 0, opacity: 0 }}
            >
              <span className="absolute inset-x-3 -bottom-[9px] h-[3px] rounded-full bg-teal-400 shadow-[0_0_10px_rgba(69,179,165,0.9)]" />
            </span>
            {MAIN.map((l) => {
              const Icon = l.icon
              const active = isActivePath(pathname, l)
              return (
                <NavLink
                  key={l.to}
                  to={l.to}
                  end={l.end}
                  ref={(el) => { itemRefs.current[l.to] = el }}
                  title={l.label}
                  className={`relative z-10 flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] transition-colors duration-200 ${
                    active ? 'font-semibold text-white' : 'text-[#9fb0bf] hover:text-white'
                  }`}
                >
                  <Icon size={15} strokeWidth={2} className={active ? 'text-teal-300' : ''} />
                  <span className={active ? '' : 'hidden xl:inline'}>{l.label}</span>
                </NavLink>
              )
            })}

            {/* System menu */}
            <div className="relative" data-system-menu>
              <button
                type="button"
                onClick={() => setMenuOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                className={`relative z-10 flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[13px] transition-colors duration-200 ${
                  systemActive ? 'bg-white/10 font-semibold text-white' : 'text-[#9fb0bf] hover:text-white'
                }`}
              >
                <SlidersHorizontal size={15} />
                System
                <ChevronDown size={13} className={`transition-transform duration-300 ${menuOpen ? 'rotate-180' : ''}`} />
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  className="rs-menu-in absolute left-0 top-[calc(100%+10px)] w-48 overflow-hidden rounded-xl border border-white/10 bg-navy-900 p-1 shadow-2xl"
                >
                  {SYSTEM.map((l) => {
                    const Icon = l.icon
                    return (
                      <NavLink
                        key={l.to}
                        to={l.to}
                        role="menuitem"
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] transition-colors ${
                            isActive ? 'bg-white/10 font-semibold text-white' : 'text-[#9fb0bf] hover:bg-white/5 hover:text-white'
                          }`
                        }
                      >
                        <Icon size={15} /> {l.label}
                      </NavLink>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </nav>
        <div className="flex-1 md:hidden" />

        {/* Right: search, alerts, user */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative hidden 2xl:block">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7f93a3]" />
            <input
              type="text"
              placeholder="Search cases, events..."
              className="w-52 rounded-lg border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-[12.5px] text-white placeholder:text-[#7f93a3] transition-all duration-300 focus:w-64 focus:bg-white/10"
            />
          </div>
          <button aria-label="Search" className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9fb0bf] transition-colors hover:bg-white/10 hover:text-white 2xl:hidden">
            <Search size={16} />
          </button>
          <button aria-label="Notifications" className="relative flex h-9 w-9 items-center justify-center rounded-lg text-[#9fb0bf] transition-colors hover:bg-white/10 hover:text-white">
            <Bell size={16} />
            <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-status-blocked ring-2 ring-navy-950" />
          </button>
          <div className="ml-1 flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-white/10">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 to-teal-500 text-[11px] font-bold">
              {mockUser.initials}
            </div>
            <div className="hidden min-w-0 min-[1100px]:block">
              <div className="truncate text-[12px] font-semibold leading-tight">{mockUser.name}</div>
              <div className="truncate text-[10.5px] leading-tight text-[#7f93a3]">{mockUser.role}</div>
            </div>
          </div>
          <button
            type="button"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileOpen((o) => !o)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#9fb0bf] hover:bg-white/10 hover:text-white md:hidden"
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <nav aria-label="Mobile" className="rs-menu-in grid gap-0.5 border-t border-white/10 bg-navy-900 p-2 md:hidden">
          {[...MAIN, ...SYSTEM].map((l) => {
            const Icon = l.icon
            return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] ${
                    isActive ? 'bg-white/10 font-semibold text-white' : 'text-[#9fb0bf] hover:bg-white/5'
                  }`
                }
              >
                <Icon size={16} /> {l.label}
              </NavLink>
            )
          })}
        </nav>
      )}
    </header>
  )
}
