import { useLocation } from 'react-router-dom'
import TopNav from './TopNav'
import TopBar from './TopBar'

// Navigation runs across the top, so every page gets the full width. The page heading scrolls away with
// the content; the navigation stays put. `rs-page` gives every page the same staggered entrance.
export default function AppLayout({ title, subtitle, children }) {
  const { pathname } = useLocation()
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#f4f6f8]">
      <TopNav />
      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6">
        <div key={pathname} className="rs-page">
          <TopBar title={title} subtitle={subtitle} />
          {children}
        </div>
      </main>
    </div>
  )
}
