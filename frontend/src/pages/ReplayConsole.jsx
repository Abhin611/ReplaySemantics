import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import { CheckCircle2, ChevronDown, ChevronRight, FastForward, Loader2, Minus, PlayCircle, RotateCcw } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { clearApiCache, getCases, runReplay } from '../lib/api'
import { useSelectedCase, usePersistentState } from '../lib/SelectedCaseContext'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import EventNode from '../components/graph/EventNode'
import ConstraintSummaryCard from '../components/ConstraintSummaryCard'
import ConstraintExplanationList from '../components/ConstraintExplanationList'
import PaymentRoutesCard from '../components/PaymentRoutesCard'
import VerdictCard from '../components/VerdictCard'
import OrderSensitivityCard from '../components/OrderSensitivityCard'
import ReplayTraceCard from '../components/ReplayTraceCard'
import HowItWorks from '../components/HowItWorks'
import EventDescriptionCard from '../components/EventDescriptionCard'
import TabBar from '../components/TabBar'
import SpeedControl from '../components/SpeedControl'
import PipelineTimeline from '../components/PipelineTimeline'
import { useReplaySpeed } from '../lib/useReplaySpeed'
import RefreshButton from '../components/RefreshButton'
import { LoadingState, ErrorState } from '../components/StatusStates'
import { formatEur, formatDateTime } from '../lib/format'
import { computePaymentRoutes } from '../lib/paymentRoutes'
import { layoutGraph } from '../lib/graphLayout'
import { scenarioPath, togglePair, unionEvents } from '../lib/scenario'
import { buildNodeStatus, isApplicable, pairDetails, badgeStatus, NODE_KIND_STYLE } from '../lib/verdict'

const NODE_TYPES = { event: EventNode }
const NO_PAIRS = []

const STAGES = [
  { key: 'stage_1_extraction', label: 'Extraction', hint: 'Finds the posted invoice event the loss sits on.' },
  { key: 'stage_2_candidate_identification', label: 'Candidate Identification', hint: 'Traces back to the events that could have caused the loss.' },
  { key: 'stage_2b_constraint_extraction', label: 'Order Constraints', hint: 'Works out which events have a fixed order in the log and which do not.' },
  { key: 'stage_3_confluence_checks', label: 'Confluence Checks', hint: 'Swaps the events that have no fixed order and checks whether the total changes.' },
  { key: 'stage_4_policy_resolution', label: 'Policy Resolution', hint: 'Lets the policy fix an order wherever swapping changed the total.' },
  { key: 'stage_5_verdict', label: 'Verdict', hint: 'PASS, POLICY-ORDERED or BLOCKED for the whole case.' },
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
  const navigate = useNavigate()
  const casesApi = useApi(useCallback(() => getCases(), []))
  // Kept in the app-level store so they survive switching sidebar tabs (this page unmounts on navigation).
  const [maxEvents, setMaxEvents] = usePersistentState('console:maxEvents', 8)
  const [minEvents, setMinEvents] = usePersistentState('console:minEvents', 3)
  const [maxHops, setMaxHops] = usePersistentState('console:maxHops', 3)
  const [runs, setRuns] = usePersistentState('console:runs', {}) // case id -> its last replay result
  const [pairsByCase, setPairsByCase] = usePersistentState('console:pairs', {})
  const [tab, setTab] = usePersistentState('console:tab', 'verdict')
  const [showConstraints, setShowConstraints] = useState(false) // order-constraints card under the graph
  const [eventNode, setEventNode] = useState(null) // event picked on the Event description tab
  const result = (selectedCaseId && runs[selectedCaseId]) || null
  const selectedPairs = (selectedCaseId && pairsByCase[selectedCaseId]) || NO_PAIRS
  const setSelectedPairs = (next) =>
    setPairsByCase((m) => ({
      ...m,
      [selectedCaseId]: typeof next === 'function' ? next(m[selectedCaseId] || NO_PAIRS) : next,
    }))
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [selectedConstraint, setSelectedConstraint] = useState(null)
  const [selectedRoute, setSelectedRoute] = useState(null) // { key: 'highest' | 'lowest', eventIds }
  const [traceNode, setTraceNode] = useState(null) // event applied at the current replay step

  // ---- Animated run -------------------------------------------------------------------------------
  // The backend answers in well under a second, so the stages are staged on screen instead: the six
  // pipeline stages land one at a time (Stages tab), then the replay steps through its corrections
  // (Replay tab), then the Verdict tab opens. `delay` is the shared playback speed (1x = 2 s per stage).
  const { delay, speedKey, setSpeedKey } = useReplaySpeed()
  const [anim, setAnim] = useState({ phase: 'idle', shown: STAGES.length, replayKey: null }) // phase: idle | pipeline | replay
  const [finishKey, setFinishKey] = useState(0)
  const [runStamp, setRunStamp] = useState(0) // bumps per run so the graph fades its nodes in again
  const animating = anim.phase !== 'idle'

  const startAnimation = (data) => {
    setRunStamp((n) => n + 1)
    if (delay === 0) {
      setAnim({ phase: 'idle', shown: STAGES.length, replayKey: null })
      setTab(isApplicable(data) ? 'verdict' : 'rules')
      return
    }
    setAnim({ phase: 'pipeline', shown: 0, replayKey: null })
    setTab('stages')
  }

  // Skip / cancel: everything appears at its final state.
  const finishAnimation = (openTab = true) => {
    setAnim({ phase: 'idle', shown: STAGES.length, replayKey: null })
    setFinishKey((k) => k + 1)
    if (openTab) setTab(isApplicable(result) ? 'verdict' : 'rules')
  }

  // Watch the same run again without asking the backend.
  const replayAnimation = () => {
    if (!result || delay === 0) return
    clearSelections()
    setRunStamp((n) => n + 1)
    setAnim({ phase: 'pipeline', shown: 0, replayKey: null })
    setTab('stages')
  }

  // Pipeline phase: reveal a stage every `delay` (the first after a short beat), then hand over to the replay.
  useEffect(() => {
    if (anim.phase !== 'pipeline' || !result) return undefined
    const total = STAGES.length
    if (anim.shown < total) {
      const t = setTimeout(() => setAnim((a) => ({ ...a, shown: a.shown + 1 })), anim.shown === 0 ? 700 : delay)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      if (isApplicable(result)) {
        setAnim((a) => ({ ...a, phase: 'replay', replayKey: Date.now() }))
        setTab('replay')
      } else {
        setAnim({ phase: 'idle', shown: total, replayKey: null })
        setTab('rules')
      }
    }, Math.max(700, delay * 0.6))
    return () => clearTimeout(t)
  }, [anim.phase, anim.shown, delay, result]) // eslint-disable-line react-hooks/exhaustive-deps

  // The replay card tells us how its automatic run ended.
  const onReplayEnd = (reason) => {
    setAnim({ phase: 'idle', shown: STAGES.length, replayKey: null })
    if (reason === 'done') setTimeout(() => setTab((t) => (t === 'replay' ? 'verdict' : t)), 1200)
  }

  // Taking over (opening another tab) ends the show.
  const changeTab = (k) => {
    if (animating && k !== tab) finishAnimation(false)
    setTab(k)
  }

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
    setSelectedPairs([])
    setTraceNode(null)
    setAnim({ phase: 'idle', shown: STAGES.length, replayKey: null })
    const caseId = selectedCaseId
    try {
      // Run Replay always asks the backend afresh (force); everything else reuses the cached result
      const data = await runReplay(caseId, { maxEvents, minEvents, maxHops }, { force: true })
      setRuns((prev) => ({ ...prev, [caseId]: data }))
      startAnimation(data)
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
      : tab === 'pairs' && selectedPairs.length
      ? { type: 'pairs', pairs: selectedPairs.map((p) => [p.a, p.b]) }
      : tab === 'replay' && traceNode
      ? { type: 'nodes', ids: [traceNode] }
      : tab === 'events' && eventNode
      ? { type: 'nodes', ids: [eventNode] }
      : null

  // Verdict colouring comes from the real stage 3-4 output; null for real VBFA results.
  const nodeStatus = useMemo(() => buildNodeStatus(result), [result])

  const { nodes, edges } = useMemo(
    () => layoutGraph(result?.replay_graph, highlightSpec, nodeStatus),
    [result, nodeStatus, selectedConstraint, selectedRoute, selectedPairs, traceNode, tab]
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
          { key: 'events', label: 'Event description' },
        ]
      : []),
    { key: 'rules', label: 'Rules', badge: result?.stage_2b_constraint_extraction?.given_constraints?.length },
    { key: 'stages', label: 'Stages' },
  ]
  // Choose the opening tab when a DIFFERENT result appears, not when the page is re-opened with the same one
  // (that would throw away the tab you were on).
  const shownResult = useRef(result)
  useEffect(() => {
    if (shownResult.current === result) return
    shownResult.current = result
    if (anim.phase !== 'idle') return // the animated run chooses its own tabs
    setTab(result && !isApplicable(result) ? 'rules' : 'verdict')
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  // Exactly one highlight at a time: choosing anything clears the others.
  const clearSelections = () => {
    setSelectedConstraint(null)
    setSelectedRoute(null)
    setSelectedPairs([])
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

  // Refresh: forget every case's result and selection on this page and re-read the case list, so a new
  // case can be run from a clean page. The case dropdown and the max_* inputs are inputs, so they stay.
  const handleRefresh = () => {
    clearApiCache()
    setRuns({})
    setPairsByCase({})
    setAnim({ phase: 'idle', shown: STAGES.length, replayKey: null })
    setTab('verdict')
    setSelectedNode(null)
    setSelectedConstraint(null)
    setSelectedRoute(null)
    setTraceNode(null)
    setRunError(null)
    casesApi.refetch()
  }

  const completedStages = result
    ? STAGES.filter((s) => result[s.key]?.status === 'complete').length
    : 0

  if (casesApi.loading) return <LoadingState label="Loading cases…" />
  if (casesApi.error) return <ErrorState error={casesApi.error} onRetry={casesApi.refetch} />

  return (
    <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">
      {/* Command bar: pick a case, run it, and watch the six stages complete. One compact card. */}
      <Card className="!p-3.5">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Case" className="min-w-[260px] flex-1">
            <select
              value={selectedCaseId || ''}
              onChange={(e) => setSelectedCaseId(e.target.value)}
              className="rounded-lg border border-[#e2e6ea] bg-white px-3 py-2 text-[13px] text-[#101828]"
            >
              {cases.map((c) => (
                <option key={c.case_id} value={c.case_id}>
                  {c.case_id} — {c.note}
                </option>
              ))}
            </select>
          </Field>
          {activeCase && activeCase.source !== 'benchmark (synthetic)' && (
            <>
              <Field label="max_events">
                <input type="number" min={1} value={maxEvents} onChange={(e) => setMaxEvents(Number(e.target.value))}
                  className="w-20 rounded-lg border border-[#e2e6ea] px-3 py-2 text-[13px]" />
              </Field>
              <Field label="min_events">
                <input type="number" min={1} value={minEvents} onChange={(e) => setMinEvents(Number(e.target.value))}
                  className="w-20 rounded-lg border border-[#e2e6ea] px-3 py-2 text-[13px]" />
              </Field>
              <Field label="max_hops">
                <input type="number" min={1} value={maxHops} onChange={(e) => setMaxHops(Number(e.target.value))}
                  className="w-20 rounded-lg border border-[#e2e6ea] px-3 py-2 text-[13px]" />
              </Field>
            </>
          )}
          <button
            onClick={handleRun}
            disabled={running || !selectedCaseId}
            className="flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
          >
            <PlayCircle size={16} />
            {running ? 'Running…' : 'Run Replay'}
          </button>
          <RefreshButton onClick={handleRefresh} disabled={running} className="!py-2.5" />
        </div>

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
          {STAGES.map((s, i) => {
            const stageResult = result?.[s.key]
            const reached = !!result && (!animating || i < anim.shown)
            const active = animating && anim.phase === 'pipeline' && i === anim.shown
            const done = reached && stageResult?.status === 'complete'
            const na = reached && stageResult?.status === 'not_applicable'
            return (
              <div key={s.key} className="flex items-center gap-1">
                <div
                  className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-all duration-500 ${
                    done
                      ? 'bg-status-passBg text-status-pass'
                      : active
                      ? 'rs-ring scale-105 bg-teal-50 text-teal-700 ring-1 ring-teal-300'
                      : 'bg-[#eef1f4] text-[#8a97a3]'
                  }`}
                  title={`${s.hint}${stageResult?.message ? ` — ${stageResult.message}` : ''}`}
                >
                  {done ? (
                    <CheckCircle2 size={13} className={animating ? 'rs-pop' : ''} />
                  ) : active ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : na ? (
                    <Minus size={13} />
                  ) : (
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px]">{i + 1}</span>
                  )}
                  {s.label}
                </div>
                {i < STAGES.length - 1 && (
                  <span className="relative h-0.5 w-5 overflow-hidden rounded bg-[#e2e6ea]" aria-hidden="true">
                    <span
                      className={`absolute inset-0 origin-left bg-teal-400 transition-transform duration-700 ${
                        reached ? 'scale-x-100' : 'scale-x-0'
                      }`}
                    />
                  </span>
                )}
              </div>
            )
          })}
        </div>

        {/* Playback: speed, skip while it plays, watch-again afterwards */}
        <div className="flex items-center gap-3">
          <SpeedControl value={speedKey} onChange={setSpeedKey} />
          <div className="flex items-center gap-2">
            {animating ? (
              <button
                type="button"
                onClick={() => finishAnimation()}
                className="rs-pop inline-flex items-center gap-1.5 rounded-lg border border-[#e2e6ea] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#101828] transition-colors hover:bg-[#f2f4f6]"
              >
                <FastForward size={13} /> Skip animation
              </button>
            ) : (
              result &&
              delay > 0 && (
                <button
                  type="button"
                  onClick={replayAnimation}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e6ea] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#101828] transition-colors hover:bg-[#f2f4f6]"
                >
                  <RotateCcw size={13} /> Watch again
                </button>
              )
            )}
          </div>
        </div>
        </div>

        {((activeCase && activeCase.source !== 'benchmark (synthetic)') || runError) && (
          <div className="mt-2.5 text-[11.5px] leading-snug text-[#8a97a3]">
            {activeCase?.source === 'benchmark (synthetic)' ? (
              <>Synthetic benchmark case · policy {activeCase.policy_version} · hover a stage above to see what it does</>
            ) : activeCase ? (
              <>
                {activeCase.max_candidates_at_default_hops} candidates reachable at max_hops=3 (true ceiling, before max_events trims the
                result) · value {formatEur(activeCase.value_eur)} · real SAP data: stages 1–2b only
              </>
            ) : null}
          </div>
        )}
        {runError && (
          <div className="mt-2.5 rounded-lg bg-status-blockedBg px-3 py-2 text-[13px] text-status-blocked">{runError.message}</div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_440px] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_520px]">
        {/* Main panel: the graph takes whatever height is left, so it is always in view */}
        <div className="flex flex-col gap-3 lg:min-h-0">
          <Card className="flex flex-col !p-0 overflow-hidden lg:min-h-0 lg:flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-[#e2e6ea] px-5 py-2">
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
            <div key={`run-${runStamp}`} className={`${animating ? 'rs-graph-in' : ''} relative h-[420px] lg:h-auto lg:min-h-0 lg:flex-1`}>
              <div className="absolute inset-0 overflow-y-auto">
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
                <HowItWorks />
              )}
              </div>
            </div>
            <div className="shrink-0 border-t border-[#e2e6ea] px-5 py-2 text-[12.5px]">
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
            <div className="lg:max-h-[45%] lg:shrink-0 lg:overflow-y-auto">
              <button
                type="button"
                onClick={() => setShowConstraints((x) => !x)}
                className="flex w-full items-center gap-2 rounded-xl border border-[#e2e6ea] bg-white px-4 py-2.5 text-left shadow-card hover:bg-[#fafbfc]"
              >
                {showConstraints ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                <span className="text-[13px] font-bold text-[#101828]">Order constraints and permutable pairs</span>
                <span className="ml-auto text-[11.5px] text-[#8a97a3]">
                  {result.stage_2b_constraint_extraction?.num_constraints ?? 0} locked ·{' '}
                  {result.stage_2b_constraint_extraction?.num_permutable_pairs ?? 0} permutable
                </span>
              </button>
              {showConstraints && (
                <div className="mt-3">
                  <ConstraintSummaryCard constraintData={result.stage_2b_constraint_extraction} eventLookup={eventLookup} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right panel: tabs keep it to one screen; sticky, scrolls inside */}
        <div className="flex min-h-0 flex-col">
          <TabBar tabs={tabs} active={tab} onChange={changeTab} />
          <div className="mt-3 flex min-h-0 flex-col gap-4 lg:flex-1 lg:overflow-y-auto lg:pr-1">
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
                  selectedPairs={selectedPairs}
                  onToggle={(p) => {
                    // pairs may be combined; any other highlight is dropped
                    setSelectedConstraint(null)
                    setSelectedRoute(null)
                    setTraceNode(null)
                    setSelectedPairs((cur) => togglePair(cur, p))
                  }}
                  onClear={() => setSelectedPairs([])}
                  onRun={(chosen) => navigate(scenarioPath(selectedCaseId, unionEvents(chosen)))}
                />
              </div>
            )}

            {result && isApplicable(result) && (
              <div className={tab === 'replay' ? 'flex flex-col gap-4' : 'hidden'}>
                <ReplayTraceCard
                  replay={result.stage_5_verdict.replay_of_all_corrections}
                  nodeStatus={nodeStatus}
                  autoPlayKey={anim.phase === 'replay' ? anim.replayKey : null}
                  finishKey={finishKey}
                  onAutoPlayEnd={onReplayEnd}
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

            {applicable && (
              <div className={tab === 'events' ? 'flex flex-col gap-4' : 'hidden'}>
                <EventDescriptionCard events={result?.event_descriptions} selected={eventNode} onSelect={setEventNode} />
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
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="text-[13px] font-bold text-[#101828]">Stage Summary</div>
                  {animating && anim.phase === 'pipeline' && (
                    <span className="flex items-center gap-1.5 rounded-full bg-teal-50 px-2 py-0.5 text-[10.5px] font-semibold text-teal-700">
                      <span className="rs-live-dot h-1.5 w-1.5 rounded-full bg-teal-500" /> running stage {Math.min(anim.shown + 1, STAGES.length)} of {STAGES.length}
                    </span>
                  )}
                </div>
                {!result ? (
                  <p className="text-[12.5px] text-[#8a97a3]">Run a replay to see stage output.</p>
                ) : (
                  <PipelineTimeline
                    items={pipelineItems(result)}
                    shown={animating ? anim.shown : STAGES.length}
                    animating={animating && anim.phase === 'pipeline'}
                  />
                )}
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// One timeline entry per pipeline stage, worded from the real stage payloads.
function pipelineItems(result) {
  const s1 = result.stage_1_extraction
  const s2 = result.stage_2_candidate_identification
  const s2b = result.stage_2b_constraint_extraction
  const msg = (k) => result[k]?.message
  return [
    { key: 'stage_1_extraction', label: 'Stage 1 · Extraction', status: s1?.status,
      body: s1?.target_event ? `Target: ${s1.target_event.activity} (${formatEur(s1.target_event.value_eur)})` : msg('stage_1_extraction') },
    { key: 'stage_2_candidate_identification', label: 'Stage 2 · Candidate Identification', status: s2?.status,
      body: `${s2?.num_candidates} kept of ${s2?.total_discovered} discovered · ${s2?.hops_used} hops used`,
      warning: s2?.warnings?.length ? s2.warnings.join('; ') : null },
    { key: 'stage_2b_constraint_extraction', label: 'Stage 2b · Order Constraints', status: s2b?.status,
      body: `${s2b?.num_constraints} locked · ${s2b?.num_permutable_pairs} permutable` },
    { key: 'stage_3_confluence_checks', label: 'Stage 3 · Confluence Checks', status: result.stage_3_confluence_checks?.status, body: msg('stage_3_confluence_checks') },
    { key: 'stage_4_policy_resolution', label: 'Stage 4 · Policy Resolution', status: result.stage_4_policy_resolution?.status, body: msg('stage_4_policy_resolution') },
    { key: 'stage_5_verdict', label: 'Stage 5 · Verdict', status: result.stage_5_verdict?.status, body: msg('stage_5_verdict'),
      badge: result.stage_5_verdict?.status === 'complete' ? badgeStatus(result.stage_5_verdict.classification) : null },
  ]
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`flex flex-col gap-1 text-[11px] font-semibold text-[#5c6b7a] ${className}`}>
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
