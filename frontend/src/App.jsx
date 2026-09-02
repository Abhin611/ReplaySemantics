import { Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { SelectedCaseProvider } from './lib/SelectedCaseContext'
import Dashboard from './pages/Dashboard'
import Cases from './pages/Cases'
import ReplayConsole from './pages/ReplayConsole'
import ReplayGraph from './pages/ReplayGraph'
import Attribution from './pages/Attribution'
import Policies from './pages/Policies'
import AuditLog from './pages/AuditLog'
import Settings from './pages/Settings'

const TITLES = {
  '/': 'Dashboard',
  '/cases': 'Cases',
  '/replay-console': 'Replay Console',
  '/replay-graph': 'Replay Graph',
  '/attribution': 'Attribution',
  '/policies': 'Policies',
  '/audit-log': 'Audit Log',
  '/settings': 'Settings',
}

function Page({ path, children }) {
  return <AppLayout title={TITLES[path]}>{children}</AppLayout>
}

export default function App() {
  return (
    <SelectedCaseProvider>
      <Routes>
        <Route path="/" element={<Page path="/"><Dashboard /></Page>} />
        <Route path="/cases" element={<Page path="/cases"><Cases /></Page>} />
        <Route
          path="/replay-console"
          element={
            <Page path="/replay-console">
              <ReplayConsole />
            </Page>
          }
        />
        <Route
          path="/replay-graph"
          element={
            <Page path="/replay-graph">
              <ReplayGraph />
            </Page>
          }
        />
        <Route
          path="/attribution"
          element={
            <Page path="/attribution">
              <Attribution />
            </Page>
          }
        />
        <Route path="/policies" element={<Page path="/policies"><Policies /></Page>} />
        <Route path="/audit-log" element={<Page path="/audit-log"><AuditLog /></Page>} />
        <Route path="/settings" element={<Page path="/settings"><Settings /></Page>} />
      </Routes>
    </SelectedCaseProvider>
  )
}
