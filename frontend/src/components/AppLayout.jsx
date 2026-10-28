import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function AppLayout({ title, subtitle, children }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f4f6f8]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} subtitle={subtitle} />
        <main className="flex-1 overflow-y-auto px-6 py-4">{children}</main>
      </div>
    </div>
  )
}
