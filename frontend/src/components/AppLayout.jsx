import { useLocation } from 'react-router-dom'
import TopNav from './TopNav'
import TopBar from './TopBar'

// Cards light up where the pointer is (index.css .rs-card): one listener here feeds every card on the page.
function trackPointer(e) {
  const card = e.target.closest?.('.rs-card')
  if (!card) return
  const r = card.getBoundingClientRect()
  card.style.setProperty('--mx', `${e.clientX - r.left}px`)
  card.style.setProperty('--my', `${e.clientY - r.top}px`)
}

// The navigation floats over the page as a glass bar, so content scrolls beneath it. `--nav-h` (index.css) is where the
// bar ends: sticky panels stop just below it (top: calc(var(--nav-h) + 4px)), and so do scroll targets. The room for the
// bar is padding on the page itself, not on the scroller, because a scroller's padding pushes sticky children down.
// Behind everything: a faint dot grid and two slow lights. `rs-page` gives every page the same entrance, led by a scan line.
export default function AppLayout({ title, subtitle, children }) {
  const { pathname } = useLocation()
  return (
    // overflow-clip, not hidden: a hidden box can still be scrolled by scrollIntoView, which would carry the bar away
    <div className="rs-app relative h-screen w-full overflow-clip">
      <div aria-hidden="true" className="rs-app-glow" />
      <div aria-hidden="true" className="rs-app-grid" />
      <TopNav />
      <main onPointerMove={trackPointer} className="relative z-[1] h-full overflow-y-auto px-4 [scroll-padding-top:calc(var(--nav-h)+12px)] lg:px-6">
        <div key={pathname} className="rs-page mx-auto w-full max-w-[1760px] pb-10 pt-[calc(var(--nav-h)+18px)]">
          <TopBar title={title} subtitle={subtitle} />
          {children}
        </div>
      </main>
    </div>
  )
}
