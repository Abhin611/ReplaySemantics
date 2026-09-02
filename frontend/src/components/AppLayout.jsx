import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function AppLayout({ title, children }) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#f4f6f8]">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={title} />
        <main className="flex-1 overflow-y-auto px-8 py-6">{children}</main>
      </div>
    </div>
  )
}
