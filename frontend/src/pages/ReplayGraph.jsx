import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import { useApi } from '../lib/useApi'
import { clearApiCache, getCases, runReplay } from '../lib/api'
import { useSelectedCase, usePersistentState } from '../lib/SelectedCaseContext'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import EventNode from '../components/graph/EventNode'
import ConstraintSummaryCard from '../components/ConstraintSummaryCard'
import ConstraintExplanationList from '../components/ConstraintExplanationList'
import PaymentRoutesCard from '../components/PaymentRoutesCard'
import OrderSensitivityCard from '../components/OrderSensitivityCard'
import { LoadingState, ErrorState } from '../components/StatusStates'
import RefreshButton from '../components/RefreshButton'
import { formatDateTime } from '../lib/format'
import { computePaymentRoutes } from '../lib/paymentRoutes'
import { layoutGraph } from '../lib/graphLayout'
import { scenarioPath, togglePair, unionEvents } from '../lib/scenario'
import { badgeStatus, buildNodeStatus, isApplicable, NODE_KIND_STYLE } from '../lib/verdict'

const NODE_TYPES = { event: EventNode }

const VERDICT_LEGEND = ['independent', 'ordered', 'blocked', 'exempt', 'context'].map((k) => ({
  label: NODE_KIND_STYLE[k].label,
  color: NODE_KIND_STYLE[k].border,
}))
const PLAIN_LEGEND = [
  { label: 'Target event', color: '#2a9d8f' },
  { label: 'Candidate event', color: '#c2cad2' },
  { label: 'Pruned parent (not connected to target)', color: '#b3261e' },
]

export default function ReplayGraph() {
  const { selectedCaseId, setSelectedCaseId } = useSelectedCase()
  const casesApi = useApi(useCallback(() => getCases(), []))
  const cases = casesApi.data?.cases || []
  const navigate = useNavigate()
  // the last result is kept in the app-level store, so coming back to this tab shows it straight away
  const [saved, setSaved] = usePersistentState('graph:result', null) // { caseId, data }
  const result = saved && saved.caseId === selectedCaseId ? saved.data : null
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [selectedConstraint, setSelectedConstraint] = useState(null)
  const [selectedRoute, setSelectedRoute] = useState(null) // { key: 'highest' | 'lowest', eventIds }
  const [reloadTick, setReloadTick] = useState(0)
  const [selectedPairs, setSelectedPairs] = useState([]) // order-sensitive pairs {a, b, ...}, one or several

  useEffect(() => {
    if (!selectedCaseId && cases.length) setSelectedCaseId(cases[0].case_id)
  }, [cases, selectedCaseId, setSelectedCaseId])

  useEffect(() => {
    if (!selectedCaseId) return undefined
    if (saved && saved.caseId === selectedCaseId) return undefined // already have it: no second run
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelectedNode(null)
    setSelectedConstraint(null)
    setSelectedRoute(null)
    setSelectedPairs([])
    runReplay(selectedCaseId)
      .then((data) => {
        if (!cancelled) setSaved({ caseId: selectedCaseId, data })
      })
      .catch((err) => {
        if (!cancelled) setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedCaseId, reloadTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh: drop the remembered result and selections, forget cached responses and load the selected case
  // afresh from the backend (this page has no Run button; it always shows the selected case).
  const handleRefresh = () => {
    clearApiCache()
    setSaved(null)
    setSelectedNode(null)
    setSelectedConstraint(null)
    setSelectedRoute(null)
    setSelectedPairs([])
    setError(null)
    casesApi.refetch()
    setReloadTick((t) => t + 1)
  }

  // Only one highlight is active at a time -- picking a constraint clears
  // any selected route and vice versa (see the two onSelect handlers
  // passed to the cards below), so this is a simple either/or.
  const highlightSpec = selectedConstraint
    ? { type: 'constraint', before: selectedConstraint.before, after: selectedConstraint.after }
    : selectedRoute
    ? { type: 'route', eventIds: selectedRoute.eventIds }
    : selectedPairs.length
    ? { type: 'pairs', pairs: selectedPairs.map((p) => [p.a, p.b]) }
    : null

  // Verdict colouring comes from the real stage 3-4 output; null for real VBFA results.
  const nodeStatus = useMemo(() => buildNodeStatus(result), [result])

  const { nodes, edges } = useMemo(
    () => layoutGraph(result?.replay_graph, highlightSpec, nodeStatus),
    [result, nodeStatus, selectedConstraint, selectedRoute, selectedPairs]
  )

  // Exactly one highlight at a time: choosing anything clears the others.
  const clearSelections = () => {
    setSelectedConstraint(null)
    setSelectedRoute(null)
    setSelectedPairs([])
  }
  const activeCase = cases.find((c) => c.case_id === selectedCaseId)

  const eventLookup = useMemo(() => {
    const lookup = {}
    result?.replay_graph?.nodes?.forEach((n) => {
      lookup[n.id] = n.activity
    })
    return lookup
  }, [result])

  const paymentRoutes = useMemo(() => computePaymentRoutes(result?.replay_graph), [result])

  if (casesApi.loading) return <LoadingState label="Loading cases…" />
  if (casesApi.error) return <ErrorState error={casesApi.error} onRetry={casesApi.refetch} />

  return (
    <div className="flex flex-col gap-4">
      {result && (
        <ConstraintSummaryCard
          constraintData={result.stage_2b_constraint_extraction}
          eventLookup={eventLookup}
        />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="!p-0 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e6ea] px-5 py-4">
            <div className="flex items-center gap-3">
              <select
                value={selectedCaseId || ''}
                onChange={(e) => setSelectedCaseId(e.target.value)}
                className="rounded-lg border border-[#e2e6ea] px-3 py-1.5 text-[13px] font-semibold"
              >
                {cases.map((c) => (
                  <option key={c.case_id} value={c.case_id}>
                    {c.case_id}
                  </option>
                ))}
              </select>
              {result && isApplicable(result) && (
                <StatusBadge status={badgeStatus(result.stage_5_verdict.classification)} />
              )}
              {result && !isApplicable(result) && (
                <span
                  className="rounded-md bg-status-idleBg px-2.5 py-1 text-xs font-semibold text-status-idle"
                  title={result.stage_5_verdict?.message}
                >
                  stages 1–2b only (real data)
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div className="text-[12.5px] text-[#8a97a3]">
                {result?.policy_version}
                {activeCase?.timestamp && `${result?.policy_version ? ' · ' : ''}${formatDateTime(activeCase.timestamp)}`}
              </div>
              <RefreshButton onClick={handleRefresh} busy={loading} />
            </div>
          </div>

          <div style={{ height: 600 }}>
            {loading ? (
              <LoadingState label="Running replay…" />
            ) : error ? (
              <ErrorState error={error} />
            ) : result ? (
              <ReactFlow
                key={`${selectedCaseId}-${nodes.length}`}
                nodes={nodes}
                edges={edges}
                nodeTypes={NODE_TYPES}
                onNodeClick={(_e, n) => setSelectedNode(n.data.node)}
                fitView
                fitViewOptions={{ padding: 0.25 }}
                minZoom={0.05}
                maxZoom={1.5}
                proOptions={{ hideAttribution: true }}
              >
                <Background color="#eef1f4" gap={20} />
                <Controls showInteractive={false} />
              </ReactFlow>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-[#e2e6ea] px-5 py-3">
            {(nodeStatus ? VERDICT_LEGEND : PLAIN_LEGEND).map((l) => (
              <div key={l.label} className="flex items-center gap-1.5 text-[12px] text-[#5c6b7a]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                {l.label}
              </div>
            ))}
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <div className="mb-2 text-[13px] font-bold text-[#101828]">Node Inspector</div>
            {!selectedNode ? (
              <p className="text-[12.5px] text-[#8a97a3]">
                Click any node to inspect its role and diagnostics.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5 text-[12.5px]">
                <Row label="Event ID" value={selectedNode.id} />
                <Row label="Activity" value={selectedNode.activity} />
                <Row label="Hop" value={selectedNode.is_target ? 'target' : selectedNode.hop} />
                <Row label="Timestamp" value={formatDateTime(selectedNode.timestamp)} />
                {selectedNode.verdictKind ? (
                  <div className="mt-2 flex flex-col gap-1.5 border-t border-[#eef1f4] pt-2">
                    <Row label="Role" value={NODE_KIND_STYLE[selectedNode.verdictKind]?.label} />
                    {selectedNode.partners?.length > 0 && (
                      <Row label="Order-sensitive with" value={selectedNode.partners.join(', ')} />
                    )}
                  </div>
                ) : (
                  <p className="mt-2 border-t border-[#eef1f4] pt-2 text-[11.5px] text-[#8a97a3]">
                    No verdict for this event: real SAP data stops at stage 2b (no pricing fields to replay).
                  </p>
                )}
              </div>
            )}
          </Card>

          {result && isApplicable(result) && (
            <OrderSensitivityCard
              result={result}
              nodeStatus={nodeStatus}
              eventLookup={eventLookup}
              selectedPairs={selectedPairs}
              onToggle={(p) => {
                setSelectedConstraint(null)
                setSelectedRoute(null)
                setSelectedPairs((cur) => togglePair(cur, p))
              }}
              onClear={() => setSelectedPairs([])}
              onRun={(chosen) => navigate(scenarioPath(selectedCaseId, unionEvents(chosen)))}
            />
          )}

          {result && (
            <ConstraintExplanationList
              constraints={result.stage_2b_constraint_extraction.given_constraints}
              eventLookup={eventLookup}
              selected={selectedConstraint}
              onSelect={(c) => {
                clearSelections()
                setSelectedConstraint(c)
              }}
            />
          )}

          {result && !isApplicable(result) && (
            <PaymentRoutesCard
              routes={paymentRoutes}
              eventLookup={eventLookup}
              selectedRouteKey={selectedRoute?.key}
              onSelectRoute={(key, route) => {
                clearSelections()
                setSelectedRoute(key ? { key, eventIds: route.eventIds } : null)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-[#eef1f4] py-1 last:border-0">
      <span className="text-[#8a97a3]">{label}</span>
      <span className="font-semibold text-[#101828]">{value}</span>
    </div>
  )
}
