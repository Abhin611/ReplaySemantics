import { useLocation } from 'react-router-dom'
import TopNav from './TopNav'
import TopBar from './TopBar'

// Navigation runs across the top, so every page gets the full width. The page heading scrolls away with
// the content; the navigation stays put. `rs-page` gives every page the same staggered entrance.
// `fill` pages (the Replay Console) fit the screen exactly on desktop: the page itself never scrolls, and the
// panels inside it do the scrolling, so the graph and the results stay in view together.
export default function AppLayout({ title, subtitle, fill = false, children }) {
  const { pathname } = useLocation()
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#f4f6f8]">
      <TopNav />
      <main className={`min-h-0 flex-1 px-4 py-3 lg:px-6 ${fill ? 'overflow-y-auto lg:overflow-hidden' : 'overflow-y-auto py-4'}`}>
        <div key={pathname} className={`rs-page ${fill ? 'lg:flex lg:h-full lg:min-h-0 lg:flex-col' : ''}`}>
          <TopBar title={title} subtitle={subtitle} compact={fill} />
          {fill ? <div className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">{children}</div> : children}
        </div>
      </main>
    </div>
  )
}
