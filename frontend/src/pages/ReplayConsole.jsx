import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import { CheckCircle2, Circle, PlayCircle } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { getCases, runReplay } from '../lib/api'
import { useSelectedCase } from '../lib/SelectedCaseContext'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import EventNode from '../components/graph/EventNode'
import ConstraintSummaryCard from '../components/ConstraintSummaryCard'
import ConstraintExplanationList from '../components/ConstraintExplanationList'
import PaymentRoutesCard from '../components/PaymentRoutesCard'
import VerdictCard from '../components/VerdictCard'
import OrderSensitivityCard from '../components/OrderSensitivityCard'
import ReplayTraceCard from '../components/ReplayTraceCard'
import TabBar from '../components/TabBar'
import { LoadingState, ErrorState } from '../components/StatusStates'
import { formatEur, formatDateTime } from '../lib/format'
import { computePaymentRoutes } from '../lib/paymentRoutes'
import { layoutGraph } from '../lib/graphLayout'
import { buildNodeStatus, isApplicable, pairDetails, NODE_KIND_STYLE } from '../lib/verdict'

const NODE_TYPES = { event: EventNode }

const STAGES = [
  { key: 'stage_1_extraction', label: 'Extraction' },
  { key: 'stage_2_candidate_identification', label: 'Candidate Identification' },
  { key: 'stage_2b_constraint_extraction', label: 'Order Constraints' },
  { key: 'stage_3_confluence_checks', label: 'Confluence Checks' },
  { key: 'stage_4_policy_resolution', label: 'Policy Resolution' },
  { key: 'stage_5_verdict', label: 'Verdict' },
]

// Live once a benchmark case has a real verdict (see lib/verdict.js buildNodeStatus); real VBFA
// results have no verdict, so the legend then explains the plain graph instead.
const VERDICT_LEGEND = ['independent', 'ordered', 'blocked', 'exempt', 'context'].map((k) => ({
  label: NODE_KIND_STYLE[k].label,
  color: NODE_KIND_STYLE[k].border,
}))
const PLAIN_LEGEND = [
  { label: 'Target event', color: '#2a9d8f' },
  { label: 'Candidate event', color: '#c2cad2' },
  { label: 'Pruned parent (not connected to target)', color: '#b3261e' },
]

export default function ReplayConsole() {
  const { selectedCaseId, setSelectedCaseId } = useSelectedCase()
  const casesApi = useApi(useCallback(() => getCases(), []))
  const [maxEvents, setMaxEvents] = useState(8)
  const [minEvents, setMinEvents] = useState(3)
  const [maxHops, setMaxHops] = useState(3)
  const [result, setResult] = useState(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [selectedConstraint, setSelectedConstraint] = useState(null)
  const [selectedRoute, setSelectedRoute] = useState(null) // { key: 'highest' | 'lowest', eventIds }
  const [selectedPair, setSelectedPair] = useState(null) // order-sensitive pair {a, b, ...}
  const [traceNode, setTraceNode] = useState(null) // event applied at the current replay step
  const [tab, setTab] = useState('verdict')

  const cases = casesApi.data?.cases || []

  useEffect(() => {
    if (!selectedCaseId && cases.length) setSelectedCaseId(cases[0].case_id)
  }, [cases, selectedCaseId, setSelectedCaseId])

  const activeCase = cases.find((c) => c.case_id === selectedCaseId)

  const handleRun = async () => {
    if (!selectedCaseId) return
    setRunning(true)
    setRunError(null)
    setSelectedNode(null)
    setSelectedConstraint(null)
    setSelectedRoute(null)
    setSelectedPair(null)
    setTraceNode(null)
    try {
      const data = await runReplay(selectedCaseId, { maxEvents, minEvents, maxHops })
      setResult(data)
    } catch (err) {
      setRunError(err)
    } finally {
      setRunning(false)
    }
  }

  // Only one highlight is active at a time -- picking a constraint clears
  // any selected route and vice versa (see the two onSelect handlers
  // passed to the cards below), so this is a simple either/or.
  // A highlight belongs to the tab it was made in: it shows only while that tab is open, so the
  // graph never carries an unexplained gold ring.
  const highlightSpec =
    tab === 'rules' && selectedConstraint
      ? { type: 'constraint', before: selectedConstraint.before, after: selectedConstraint.after }
      : tab === 'rules' && selectedRoute
      ? { type: 'route', eventIds: selectedRoute.eventIds }
      : tab === 'pairs' && selectedPair
      ? { type: 'pair', a: selectedPair.a, b: selectedPair.b }
      : tab === 'replay' && traceNode
      ? { type: 'nodes', ids: [traceNode] }
      : null

  // Verdict colouring comes from the real stage 3-4 output; null for real VBFA results.
  const nodeStatus = useMemo(() => buildNodeStatus(result), [result])

  const { nodes, edges } = useMemo(
    () => layoutGraph(result?.replay_graph, highlightSpec, nodeStatus),
    [result, nodeStatus, selectedConstraint, selectedRoute, selectedPair, traceNode, tab]
  )

  // Right-hand tabs. Real SAP results have no verdict, pairs or replay, so they get fewer tabs and
  // open on the order rules instead.
  const applicable = isApplicable(result)
  const tabs = [
    { key: 'verdict', label: 'Verdict' },
    ...(applicable
      ? [
          { key: 'pairs', label: 'Pairs', badge: pairDetails(result).length },
          { key: 'replay', label: 'Replay' },
        ]
      : []),
    { key: 'rules', label: 'Rules', badge: result?.stage_2b_constraint_extraction?.given_constraints?.length },
    { key: 'stages', label: 'Stages' },
  ]
  useEffect(() => {
    setTab(result && !isApplicable(result) ? 'rules' : 'verdict')
  }, [result])

  // Exactly one highlight at a time: choosing anything clears the others.
  const clearSelections = () => {
    setSelectedConstraint(null)
    setSelectedRoute(null)
    setSelectedPair(null)
    setTraceNode(null)
  }

  const eventLookup = useMemo(() => {
    const lookup = {}
    result?.replay_graph?.nodes?.forEach((n) => {
      lookup[n.id] = n.activity
    })
    return lookup
  }, [result])

  const paymentRoutes = useMemo(() => computePaymentRoutes(result?.replay_graph), [result])

  const onNodeClick = (_evt, node) => setSelectedNode(node.data.node)

  const completedStages = result
    ? STAGES.filter((s) => result[s.key]?.status === 'complete').length
    : 0

  if (casesApi.loading) return <LoadingState label="Loading cases…" />
  if (casesApi.error) return <ErrorState error={casesApi.error} onRetry={casesApi.refetch} />

  return (
    <div className="flex flex-col gap-4">
      {/* Stepper */}
      <Card className="!p-4">
        <div className="flex flex-wrap items-center gap-2">
          {STAGES.map((s, i) => {
            const stageResult = result?.[s.key]
            const done = stageResult?.status === 'complete'
            return (
              <div key={s.key} className="flex items-center gap-2">
                <div
                  className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold ${
                    done
                      ? 'bg-status-passBg text-status-pass'
                      : 'bg-[#eef1f4] text-[#8a97a3]'
                  }`}
                  title={stageResult?.message}
                >
                  {done ? (
                    <CheckCircle2 size={14} />
                  ) : (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px]">
                      {i + 1}
                    </span>
                  )}
                  {s.label}
                </div>
                {i < STAGES.length - 1 && <span className="text-[#c2cad2]">—</span>}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        {/* Main panel */}
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Case">
                  <select
                    value={selectedCaseId || ''}
                    onChange={(e) => setSelectedCaseId(e.target.value)}
                    className="rounded-lg border border-[#e2e6ea] px-3 py-2 text-[13px]"
                  >
                    {cases.map((c) => (
                      <option key={c.case_id} value={c.case_id}>
                        {c.case_id} — {c.note}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="max_events">
                  <input
                    type="number"
                    min={1}
                    value={maxEvents}
                    onChange={(e) => setMaxEvents(Number(e.target.value))}
                    className="w-20 rounded-lg border border-[#e2e6ea] px-3 py-2 text-[13px]"
                  />
                </Field>
                <Field label="min_events">
                  <input
                    type="number"
                    min={1}
                    value={minEvents}
                    onChange={(e) => setMinEvents(Number(e.target.value))}
                    className="w-20 rounded-lg border border-[#e2e6ea] px-3 py-2 text-[13px]"
                  />
                </Field>
                <Field label="max_hops">
                  <input
                    type="number"
                    min={1}
                    value={maxHops}
                    onChange={(e) => setMaxHops(Number(e.target.value))}
                    className="w-20 rounded-lg border border-[#e2e6ea] px-3 py-2 text-[13px]"
                  />
                </Field>
              </div>
              <button
                onClick={handleRun}
                disabled={running || !selectedCaseId}
                className="flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
              >
                <PlayCircle size={16} />
                {running ? 'Running…' : 'Run Replay'}
              </button>
            </div>
            {activeCase && (
              <div className="mt-3 text-[12.5px] text-[#8a97a3]">
                {activeCase.source === 'benchmark (synthetic)' ? (
                  <>
                    Synthetic benchmark case · policy {activeCase.policy_version} · max_events / min_events /
                    max_hops apply to real VBFA cases only
                  </>
                ) : (
                  <>
                    {activeCase.max_candidates_at_default_hops} candidates reachable at max_hops=3
                    (true ceiling, before max_events trims the result) · value {formatEur(activeCase.value_eur)} ·
                    real SAP data: stages 1–2b only
                  </>
                )}
              </div>
            )}
            {runError && (
              <div className="mt-3 rounded-lg bg-status-blockedBg px-3 py-2 text-[13px] text-status-blocked">
                {runError.message}
              </div>
            )}
          </Card>

          <Card className="!p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-[#e2e6ea] px-5 py-2.5">
              <div className="text-[14px] font-bold">{selectedCaseId || 'Select a case'}</div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {(nodeStatus ? VERDICT_LEGEND : PLAIN_LEGEND).map((l) => (
                  <div key={l.label} className="flex items-center gap-1.5 text-[11.5px] text-[#5c6b7a]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                    {l.label}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ height: 'clamp(340px, calc(100vh - 400px), 620px)' }}>
              {result ? (
                <ReactFlow
                  key={`${selectedCaseId}-${nodes.length}`}
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={NODE_TYPES}
                  onNodeClick={onNodeClick}
                  fitView
                  fitViewOptions={{ padding: 0.25 }}
                  minZoom={0.05}
                  maxZoom={1.5}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background color="#eef1f4" gap={20} />
                  <Controls showInteractive={false} />
                </ReactFlow>
              ) : (
                <div className="flex h-full items-center justify-center text-[13px] text-[#8a97a3]">
                  Run a replay to see the candidate graph.
                </div>
              )}
            </div>
            <div className="border-t border-[#e2e6ea] px-5 py-2.5 text-[12.5px]">
              {!selectedNode ? (
                <span className="text-[#8a97a3]">
                  {result ? 'Click an event on the graph to inspect it.' : 'Run a replay, then click any event to inspect it.'}
                </span>
              ) : (
                <div className="flex flex-wrap gap-x-6 gap-y-1">
                  <Chip label="Event" value={`${selectedNode.id} · ${selectedNode.activity}`} />
                  <Chip label="Hop" value={selectedNode.is_target ? 'target' : selectedNode.hop} />
                  {selectedNode.value_eur != null && <Chip label="Value" value={formatEur(selectedNode.value_eur)} />}
                  <Chip label="Time" value={formatDateTime(selectedNode.timestamp)} />
                  <Chip label="Connected" value={selectedNode.connected_to_target ? 'yes' : 'no (pruned parent)'} />
                  {selectedNode.verdictKind && (
                    <Chip label="Role" value={NODE_KIND_STYLE[selectedNode.verdictKind]?.label} />
                  )}
                  {selectedNode.partners?.length > 0 && (
                    <Chip label="Order-sensitive with" value={selectedNode.partners.join(', ')} />
                  )}
                </div>
              )}
            </div>
          </Card>

          {result && (
            <ConstraintSummaryCard
              constraintData={result.stage_2b_constraint_extraction}
              eventLookup={eventLookup}
            />
          )}
        </div>

        {/* Right panel: tabs keep it to one screen; sticky, scrolls inside */}
        <div className="lg:sticky lg:top-2 lg:self-start">
          <TabBar tabs={tabs} active={tab} onChange={setTab} />
          <div className="mt-3 flex flex-col gap-4 lg:max-h-[calc(100vh-10.5rem)] lg:overflow-y-auto lg:pr-1">
            <div className={tab === 'verdict' ? 'flex flex-col gap-4' : 'hidden'}>
              {result ? (
                <VerdictCard result={result} />
              ) : (
                <Card>
                  <p className="text-[12.5px] text-[#8a97a3]">Run a replay to see the verdict.</p>
                </Card>
              )}
            </div>

            {result && isApplicable(result) && (
              <div className={tab === 'pairs' ? 'flex flex-col gap-4' : 'hidden'}>
                <OrderSensitivityCard
                  result={result}
                  nodeStatus={nodeStatus}
                  eventLookup={eventLookup}
                  selected={selectedPair}
                  onSelect={(p) => {
                    clearSelections()
                    setSelectedPair(p)
                  }}
                />
              </div>
            )}

            {result && isApplicable(result) && (
              <div className={tab === 'replay' ? 'flex flex-col gap-4' : 'hidden'}>
                <ReplayTraceCard
                  replay={result.stage_5_verdict.replay_of_all_corrections}
                  nodeStatus={nodeStatus}
                  onStepNode={(id) => {
                    if (id) {
                      clearSelections()
                      setTraceNode(id)
                    } else {
                      setTraceNode(null)
                    }
                  }}
                />
              </div>
            )}

            <div className={tab === 'rules' ? 'flex flex-col gap-4' : 'hidden'}>
              {result ? (
                <ConstraintExplanationList
                  constraints={result.stage_2b_constraint_extraction.given_constraints}
                  eventLookup={eventLookup}
                  selected={selectedConstraint}
                  onSelect={(c) => {
                    clearSelections()
                    setSelectedConstraint(c)
                  }}
                />
              ) : (
                <Card>
                  <p className="text-[12.5px] text-[#8a97a3]">Run a replay to see the order rules.</p>
                </Card>
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

            <div className={tab === 'stages' ? 'flex flex-col gap-4' : 'hidden'}>
          <Card>
            <div className="mb-2 text-[13px] font-bold text-[#101828]">Stage Summary</div>
            {!result ? (
              <p className="text-[12.5px] text-[#8a97a3]">Run a replay to see stage output.</p>
            ) : (
              <div className="flex flex-col gap-3 text-[12.5px]">
                <div>
                  <div className="font-semibold text-[#101828]">Stage 1 · Extraction</div>
                  <div className="text-[#5c6b7a]">
                    Target: {result.stage_1_extraction.target_event.activity} (
                    {formatEur(result.stage_1_extraction.target_event.value_eur)})
                  </div>
                </div>
                <div>
                  <div className="font-semibold text-[#101828]">
                    Stage 2 · Candidate Identification
                  </div>
                  <div className="text-[#5c6b7a]">
                    {result.stage_2_candidate_identification.num_candidates} kept of{' '}
                    {result.stage_2_candidate_identification.total_discovered} discovered ·{' '}
                    {result.stage_2_candidate_identification.hops_used} hops used
                  </div>
                  {result.stage_2_candidate_identification.warnings?.length > 0 && (
                    <div className="mt-1 rounded-md bg-status-orderedBg px-2 py-1 text-status-ordered">
                      {result.stage_2_candidate_identification.warnings.join('; ')}
                    </div>
                  )}
                </div>
                <div>
                  <div className="font-semibold text-[#101828]">
                    Stage 2b · Order Constraints
                  </div>
                  <div className="text-[#5c6b7a]">
                    {result.stage_2b_constraint_extraction.num_constraints} locked ·{' '}
                    {result.stage_2b_constraint_extraction.num_permutable_pairs} permutable
                  </div>
                </div>
                {STAGES.filter((s) => ['stage_3_confluence_checks', 'stage_4_policy_resolution', 'stage_5_verdict'].includes(s.key)).map((s) => {
                  const done = result[s.key]?.status === 'complete'
                  return (
                    <div key={s.key}>
                      <div className={`font-semibold ${done ? 'text-[#101828]' : 'text-[#8a97a3]'}`}>
                        {s.label}
                      </div>
                      <div className={done ? 'text-[#5c6b7a]' : 'text-[#8a97a3]'}>
                        {result[s.key]?.status === 'not_applicable'
                          ? 'Not applicable to real SAP data (no pricing fields to replay).'
                          : result[s.key]?.message}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#5c6b7a]">
      {label}
      {children}
    </label>
  )
}

function Chip({ label, value }) {
  return (
    <span className="text-[#5c6b7a]">
      <span className="text-[#8a97a3]">{label}: </span>
      <span className="font-semibold text-[#101828]">{value}</span>
    </span>
  )
}
