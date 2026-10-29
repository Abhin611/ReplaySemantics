import { Route, Routes } from 'react-router-dom'
import AppLayout from './components/AppLayout'
import { SelectedCaseProvider } from './lib/SelectedCaseContext'
import Dashboard from './pages/Dashboard'
import Cases from './pages/Cases'
import ReplayConsole from './pages/ReplayConsole'
import ReplayGraph from './pages/ReplayGraph'
import Attribution from './pages/Attribution'
import Scenario from './pages/Scenario'
import Policies from './pages/Policies'
import AuditLog from './pages/AuditLog'
import Settings from './pages/Settings'

const TITLES = {
  '/': 'Dashboard',
  '/cases': 'Cases',
  '/replay-console': 'Replay Console',
  '/replay-graph': 'Replay Graph',
  '/attribution': 'Attribution',
  '/scenario': 'Corrected Scenario',
  '/policies': 'Policies',
  '/audit-log': 'Audit Log',
  '/settings': 'Settings',
}

// One line under each page title: what the page is for.
const SUBTITLES = {
  '/': 'Overview of the cases, verdicts and losses ReplaySemantics has examined.',
  '/cases': 'Browse the cases and pick one to replay.',
  '/replay-console': 'Replay corrections on one case, check whether their order matters, and read the verdict.',
  '/replay-graph': 'The object-centric event graph behind a case.',
  '/attribution': 'How a validated loss is split between the events that caused it.',
  '/scenario': 'Choose corrections to apply together and see the new total and the loss avoided.',
  '/policies': 'The rules that define a compliant posting and fix the order of corrections.',
  '/audit-log': 'A record of what was run and when.',
  '/settings': 'Application settings.',
}

// Pages that fit the screen exactly instead of scrolling as a whole.
const FILL = new Set(['/replay-console'])

function Page({ path, children }) {
  return (
    <AppLayout title={TITLES[path]} subtitle={SUBTITLES[path]} fill={FILL.has(path)}>
      {children}
    </AppLayout>
  )
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
        <Route
          path="/scenario"
          element={
            <Page path="/scenario">
              <Scenario />
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
