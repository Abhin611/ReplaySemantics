import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { LoadingState } from './components/StatusStates'
import LoadLog from './components/LoadLog'
import { SelectedCaseProvider } from './lib/SelectedCaseContext'
import { SessionProvider, useSession } from './lib/session'
import Landing from './pages/Landing'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Cases from './pages/Cases'
import ReplayConsole from './pages/ReplayConsole'
import ReplayGraph from './pages/ReplayGraph'
import Attribution from './pages/Attribution'
import Scenario from './pages/Scenario'
import Ledger from './pages/Ledger'
import Policies from './pages/Policies'
import AuditLog from './pages/AuditLog'
import Settings from './pages/Settings'
import History from './pages/History'
import Profile from './pages/Profile'

const TITLES = {
  '/dashboard': 'Dashboard',
  '/load-log': 'Load an event log',
  '/history': 'History',
  '/profile': 'Your profile',
  '/cases': 'Cases',
  '/replay-console': 'Replay Console',
  '/replay-graph': 'Replay Graph',
  '/attribution': 'Attribution',
  '/ledger': 'Replay Analysis',
  '/scenario': 'Swap Scenario',
  '/policies': 'Policies',
  '/audit-log': 'Audit Log',
  '/settings': 'Settings',
}

// One line under each page title: what the page is for.
const SUBTITLES = {
  '/dashboard': 'Overview of the cases, verdicts and losses in the event log you are working on.',
  '/load-log': 'Add an event log to your profile.',
  '/history': 'Everything you have run, saved to your account. Tick actions to compare them.',
  '/profile': 'Your account and the event logs you have loaded.',
  '/cases': 'Browse the cases and pick one to replay.',
  '/replay-console': 'Replay corrections on one case, check whether their order matters, and read the verdict.',
  '/replay-graph': 'The object-centric event graph behind a case.',
  '/attribution': 'How a validated loss is split between the events that caused it.',
  '/ledger': 'Corrected inputs, posted amounts, the swappable pairs and what the policy decides.',
  '/scenario': 'Swap the order of events: the posted order gives the original graph, and only a different order can move a value.',
  '/policies': 'The rules that define a compliant posting and fix the order of corrections.',
  '/audit-log': 'A record of what was run and when.',
  '/settings': 'Application settings.',
}

// A page of the app: needs a signed-in user and, for most pages, a loaded event log.
function Page({ path, needsLog = true, children }) {
  const { profile, activeLog, loading } = useSession()
  const location = useLocation()
  if (loading) return <div className="flex h-screen items-center justify-center bg-[#f4f6f8]"><LoadingState label="Signing you in…" /></div>
  if (!profile) return <Navigate replace to="/login" state={{ from: location.pathname + location.search }} />
  if (needsLog && !activeLog) return <Navigate replace to="/dashboard" />
  return (
    <AppLayout title={TITLES[path]} subtitle={SUBTITLES[path]}>
      {children}
    </AppLayout>
  )
}

function AppRoutes() {
  const { profile, activeLog } = useSession()
  // a new key on a change of user or log starts every page clean, so nothing from one log shows on another
  return (
    <SelectedCaseProvider key={`${profile?.uid}:${activeLog?.id}`}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Page path="/dashboard" needsLog={false}><Dashboard /></Page>} />
        <Route path="/load-log" element={<Page path="/load-log" needsLog={false}><LoadLog /></Page>} />
        <Route path="/history" element={<Page path="/history" needsLog={false}><History /></Page>} />
        <Route path="/profile" element={<Page path="/profile" needsLog={false}><Profile /></Page>} />
        <Route path="/cases" element={<Page path="/cases"><Cases /></Page>} />
        <Route path="/replay-console" element={<Page path="/replay-console"><ReplayConsole /></Page>} />
        <Route path="/replay-graph" element={<Page path="/replay-graph"><ReplayGraph /></Page>} />
        <Route path="/attribution" element={<Page path="/attribution"><Attribution /></Page>} />
        <Route path="/ledger" element={<Page path="/ledger"><Ledger /></Page>} />
        <Route path="/scenario" element={<Page path="/scenario"><Scenario /></Page>} />
        <Route path="/policies" element={<Page path="/policies" needsLog={false}><Policies /></Page>} />
        <Route path="/audit-log" element={<Page path="/audit-log" needsLog={false}><AuditLog /></Page>} />
        <Route path="/settings" element={<Page path="/settings" needsLog={false}><Settings /></Page>} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
    </SelectedCaseProvider>
  )
}

export default function App() {
  return (
    <SessionProvider>
      <AppRoutes />
    </SessionProvider>
  )
}
