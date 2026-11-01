import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, FastForward, Loader2, Minus, PlayCircle, RotateCcw } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { clearApiCache, getCases, getHops, runReplay } from '../lib/api'
import { useSelectedCase, usePersistentState } from '../lib/SelectedCaseContext'
import { useReplaySpeed } from '../lib/useReplaySpeed'
import { STAGES, fullGraphLimits, pipelineItems, stageHighlight } from '../lib/flow'
import { scenarioPath, togglePair, unionEvents } from '../lib/scenario'
import { isApplicable, pairDetails, buildNodeStatus } from '../lib/verdict'
import Card from './Card'
import GraphStage from './GraphStage'
import ConstraintTabs from './ConstraintTabs'
import ReplayStrip from './ReplayStrip'
import TabBar from './TabBar'
import SpeedControl from './SpeedControl'
import RefreshButton from './RefreshButton'
import HowItWorks from './HowItWorks'
import VerdictCard from './VerdictCard'
import OrderSensitivityCard from './OrderSensitivityCard'
import EventDescriptionCard from './EventDescriptionCard'
import ConstraintExplanationList from './ConstraintExplanationList'
import PaymentRoutesCard from './PaymentRoutesCard'
import PipelineTimeline from './PipelineTimeline'
import { LoadingState, ErrorState } from './StatusStates'
import { computePaymentRoutes } from '../lib/paymentRoutes'

const NO_PAIRS = []
const limitsKey = (l) => `${l.maxHops}/${l.minEvents}/${l.maxEvents ?? 'all'}`

// The whole Replay Console flow, shared by the Replay Console and the Corrected Scenario page:
//
//   Run Replay -> the controls disappear -> the case appears as an OCEL table and becomes the graph, node by node
//   -> the page scrolls to the stages, which run along ONE horizontal line while the graph shows what each stage inspects
//   -> below the graph: the locked-by-process and order-not-fixed pairs -> the replay, in a horizontal strip
//   -> the verdict / pairs / event description / rules / stages tabs -> the controls come back at the top.
//
// While it animates only Skip animation, Refresh and the speed buttons are available.
// `fixed` (Corrected Scenario) = { caseId, limits }: the case and limits come from the page's address, and it runs by itself.
export default function ReplayFlow({ fixed = null, highlightIds = null, onEdit, children }) {
  const navigate = useNavigate()
  const { selectedCaseId, setSelectedCaseId } = useSelectedCase()
  const casesApi = useApi(useCallback(() => (fixed ? Promise.resolve({ cases: [] }) : getCases()), [!!fixed])) // eslint-disable-line react-hooks/exhaustive-deps
  const caseId = fixed ? fixed.caseId : selectedCaseId
  const [limitsByCase, setLimitsByCase] = usePersistentState('console:limits2', {})
  const limits = fixed ? fixed.limits : limitsByCase[caseId] || null
  const setLimits = (patch) => setLimitsByCase((m) => ({ ...m, [caseId]: { ...(m[caseId] || {}), ...patch } }))
  const [runs, setRuns] = usePersistentState('console:runs2', {})
  const [pairsByCase, setPairsByCase] = usePersistentState('console:pairs', {})
  const [tab, setTab] = usePersistentState('console:tab', 'verdict')
  const runKey = caseId && limits ? `${caseId}|${limitsKey(limits)}` : null
  const result = (runKey && runs[runKey]) || null
  const selectedPairs = (caseId && pairsByCase[caseId]) || NO_PAIRS
  const setSelectedPairs = (next) => setPairsByCase((m) => ({ ...m, [caseId]: typeof next === 'function' ? next(m[caseId] || NO_PAIRS) : next }))

  const { delay, speedKey, setSpeedKey } = useReplaySpeed()
  const [phase, setPhase] = useState(result ? 'done' : 'idle') // idle | build | stages | replay | done
  const [stageShown, setStageShown] = useState(STAGES.length)
  const [replayKey, setReplayKey] = useState(null)
  const [skipKey, setSkipKey] = useState(0)
  const [finishKey, setFinishKey] = useState(0)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState(null)
  const [traceNode, setTraceNode] = useState(null)
  const [eventNode, setEventNode] = useState(null)
  const [pick, setPick] = useState(null) // highlight chosen in the constraint tabs / rules
  const animating = phase === 'build' || phase === 'stages' || phase === 'replay'
  const applicable = isApplicable(result)

  const stageRef = useRef(null)
  const lineRef = useRef(null)
  const lowerRef = useRef(null)
  const tabsRef = useRef(null)
  const scrollTo = (ref, wait = 250) => setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), wait)

  // ---- limits: the first run of a case shows the WHOLE graph; the user narrows it afterwards ----
  const hopsApi = useApi(useCallback(() => (caseId && !fixed ? getHops(caseId) : Promise.resolve(null)), [caseId, !!fixed]), [caseId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (fixed || !caseId || limitsByCase[caseId] || !hopsApi.data || hopsApi.data.case_id !== caseId) return
    setLimits(fullGraphLimits(hopsApi.data))
  }, [caseId, hopsApi.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const cases = casesApi.data?.cases || []
  useEffect(() => {
    if (!fixed && !selectedCaseId && cases.length) setSelectedCaseId(cases[0].case_id)
  }, [cases, selectedCaseId, fixed]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRun = useCallback(async (force = true) => {
    if (!caseId || !limits) return
    setRunning(true); setRunError(null); setPick(null); setTraceNode(null); setEventNode(null); setSelectedPairs([])
    try {
      const data = await runReplay(caseId, { maxEvents: limits.maxEvents, minEvents: limits.minEvents, maxHops: limits.maxHops }, { force })
      setRuns((m) => ({ ...m, [`${caseId}|${limitsKey(limits)}`]: data }))
      if (delay === 0) { setPhase('done'); setStageShown(STAGES.length); setTab(isApplicable(data) ? 'verdict' : 'rules') } else {
        setStageShown(0); setPhase('build'); scrollTo(stageRef, 50)
      }
    } catch (err) { setRunError(err) } finally { setRunning(false) }
  }, [caseId, limits && limitsKey(limits), delay]) // eslint-disable-line react-hooks/exhaustive-deps

  // the Corrected Scenario page starts by itself the first time it sees a case
  const autoStarted = useRef(null)
  useEffect(() => {
    if (!fixed || !runKey || autoStarted.current === runKey) return
    autoStarted.current = runKey
    if (!result) handleRun(false)
  }, [runKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (result && phase === 'idle' && !running) setPhase('done') }, [result]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- sequence: build -> stages -> replay -> done ----
  const onBuilt = useCallback(() => { setPhase('stages'); setStageShown(0); scrollTo(lineRef, 150) }, [])
  useEffect(() => {
    if (phase !== 'stages' || !result) return undefined
    if (stageShown < STAGES.length) {
      const t = setTimeout(() => setStageShown((n) => n + 1), stageShown === 0 ? 600 : delay)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => {
      if (isApplicable(result)) { setPhase('replay'); setReplayKey(Date.now()); setTab('replay'); scrollTo(lowerRef, 200) } else finish(false)
    }, Math.max(900, delay * 0.7))
    return () => clearTimeout(t)
  }, [phase, stageShown, delay, result]) // eslint-disable-line react-hooks/exhaustive-deps

  const finish = (skipped = true) => {
    setPhase('done'); setStageShown(STAGES.length); setReplayKey(null); setTraceNode(null)
    setFinishKey((k) => k + 1)
    setTab(isApplicable(result) ? 'verdict' : 'rules')
    scrollTo(tabsRef, skipped ? 150 : 600)
  }
  const skip = () => { setSkipKey((k) => k + 1); finish(true) }
  const refresh = () => {
    clearApiCache(); setRuns({}); setPairsByCase({}); setPhase('idle'); setStageShown(STAGES.length); setReplayKey(null)
    setPick(null); setTraceNode(null); setEventNode(null); setRunError(null); casesApi.refetch(); hopsApi.refetch?.()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const watchAgain = () => { if (result && delay) { setPick(null); setStageShown(0); setPhase('build'); setSkipKey(0); scrollTo(stageRef, 50) } }

  // ---- what the graph highlights right now ----
  const highlight = useMemo(() => {
    if (phase === 'stages' && stageShown > 0) return stageHighlight(Math.min(stageShown, STAGES.length) - 1, result)
    if (phase === 'replay' && traceNode) return { type: 'nodes', ids: [traceNode] }
    if (phase !== 'done') return null
    if (pick) return pick
    if (tab === 'pairs' && selectedPairs.length) return { type: 'pairs', pairs: selectedPairs.map((p) => [p.a, p.b]) }
    if (tab === 'pairs' && highlightIds?.length) return { type: 'nodes', ids: highlightIds }
    if (tab === 'events' && eventNode) return { type: 'nodes', ids: [eventNode] }
    return null
  }, [phase, stageShown, traceNode, pick, tab, selectedPairs, eventNode, result, highlightIds])

  const eventLookup = useMemo(() => Object.fromEntries((result?.replay_graph?.nodes ?? []).map((n) => [n.id, n.activity])), [result])
  const nodeStatus = useMemo(() => buildNodeStatus(result), [result])
  const paymentRoutes = useMemo(() => computePaymentRoutes(result?.replay_graph), [result])
  const hopRange = useMemo(() => {
    const hs = (result?.replay_graph?.nodes ?? []).filter((n) => !n.is_target && !n.is_reference && typeof n.hop === 'number').map((n) => n.hop)
    return hs.length ? { min: Math.min(...hs), max: Math.max(...hs) } : null
  }, [result])

  const tabs = [
    { key: 'verdict', label: 'Verdict' },
    ...(applicable ? [{ key: 'pairs', label: 'Pairs', badge: pairDetails(result).length }, { key: 'events', label: 'Event description' }] : []),
    { key: 'rules', label: 'Rules', badge: result?.stage_2b_constraint_extraction?.given_constraints?.length },
    { key: 'stages', label: 'Stages' },
    ...(applicable ? [{ key: 'replay', label: 'Replay' }] : []),
  ]

  if (casesApi.loading && !fixed) return <LoadingState label="Loading cases…" />
  if (casesApi.error) return <ErrorState error={casesApi.error} onRetry={casesApi.refetch} />

  const field = 'w-24 rounded-lg border border-[#e2e6ea] bg-white px-3 py-2 text-[13px]'
  const setNum = (k) => (e) => setLimits({ [k]: e.target.value === '' ? null : Number(e.target.value) })
  const partial = result?.limits && !result.limits.complete
  const replayLabels = eventLookup

  return (
    <div className="flex flex-col gap-4">
      {/* ---- controls (hidden while it animates) ---- */}
      {!animating && !fixed && (
        <Card className="!p-3.5">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[260px] flex-1 flex-col gap-1 text-[11px] font-semibold text-[#5c6b7a]">Case
              <select value={caseId || ''} onChange={(e) => { setSelectedCaseId(e.target.value); setPhase('idle') }}
                className="rounded-lg border border-[#e2e6ea] bg-white px-3 py-2 text-[13px] text-[#101828]">
                {cases.map((c) => <option key={c.case_id} value={c.case_id}>{c.case_id} — {c.note}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#5c6b7a]">max_events
              <input type="number" min={1} className={field} value={limits?.maxEvents ?? ''} placeholder="all" onChange={setNum('maxEvents')} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#5c6b7a]">min_events
              <input type="number" min={1} className={field} value={limits?.minEvents ?? ''} onChange={setNum('minEvents')} />
            </label>
            <label className="flex flex-col gap-1 text-[11px] font-semibold text-[#5c6b7a]">max_hops
              <input type="number" min={1} max={10} className={field} value={limits?.maxHops ?? ''} onChange={setNum('maxHops')} />
            </label>
            <button onClick={() => handleRun(true)} disabled={running || !caseId || !limits}
              className="flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50">
              {running ? <Loader2 size={16} className="animate-spin" /> : <PlayCircle size={16} />} {running ? 'Running…' : 'Run Replay'}
            </button>
            <RefreshButton onClick={refresh} disabled={running} className="!py-2.5" />
            <SpeedControl value={speedKey} onChange={setSpeedKey} />
            {result && delay > 0 && (
              <button onClick={watchAgain} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e6ea] bg-white px-3 py-2 text-[12.5px] font-semibold hover:bg-[#f2f4f6]">
                <RotateCcw size={13} /> Watch again
              </button>
            )}
          </div>
          <div className="mt-2 text-[11.5px] text-[#8a97a3]">
            The first run of a case draws the whole graph (every reachable event). Narrow it with the three limits and run again.
          </div>
          {runError && <div className="mt-2 rounded-lg bg-status-blockedBg px-3 py-2 text-[13px] text-status-blocked">{runError.message}</div>}
        </Card>
      )}
      {animating && (
        <div className="sticky top-2 z-30 flex items-center justify-between gap-3 rounded-xl border border-[#e2e6ea] bg-white/90 px-4 py-2 shadow-card backdrop-blur" data-testid="anim-bar">
          <span className="flex items-center gap-2 text-[12.5px] font-semibold text-[#344054]">
            <span className="rs-live-dot h-2 w-2 rounded-full bg-teal-500" />
            {phase === 'build' ? 'Building the graph from the OCEL log' : phase === 'stages' ? 'Running the stages' : 'Replaying the events'}
          </span>
          <div className="flex items-center gap-3">
            <SpeedControl value={speedKey} onChange={setSpeedKey} />
            <RefreshButton onClick={refresh} />
            <button onClick={skip} className="inline-flex items-center gap-1.5 rounded-lg border border-[#e2e6ea] bg-white px-3 py-1.5 text-[12.5px] font-semibold hover:bg-[#f2f4f6]">
              <FastForward size={13} /> Skip animation
            </button>
          </div>
        </div>
      )}
      {fixed && runError && <div className="rounded-lg bg-status-blockedBg px-3 py-2 text-[13px] text-status-blocked">{runError.message}</div>}

      {partial && !animating && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900" data-testid="partial-banner">
          <AlertTriangle size={14} /> <b>Partial result.</b> {(result.limits.partial_reasons || []).join('; ')}.
          {!fixed && result.limits.suggestion?.max_hops > (limits?.maxHops ?? 0) && (
            <button className="rounded border border-amber-400 bg-white px-2 py-0.5 font-semibold hover:bg-amber-100" onClick={() => setLimits({ maxHops: result.limits.suggestion.max_hops })}>
              Set max_hops to {result.limits.suggestion.max_hops}
            </button>
          )}
        </div>
      )}

      {/* ---- the graph ---- */}
      <div ref={stageRef}>
        {result ? (
          <GraphStage result={result} highlight={highlight} building={phase === 'build'} delay={delay} skipKey={skipKey}
            onBuilt={onBuilt} onEdit={onEdit} title={caseId} hopRange={hopRange} />
        ) : (
          <HowItWorks />
        )}
      </div>

      {/* ---- the stages: one horizontal line ---- */}
      {result && (phase === 'stages' || phase === 'replay' || phase === 'done') && (
        <div ref={lineRef} className="rounded-2xl border border-[#e2e6ea] bg-white px-4 py-3 shadow-card" data-testid="stage-line">
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
            {STAGES.map((s, i) => {
              const sr = result[s.key]
              const reached = phase !== 'stages' || i < stageShown
              const active = phase === 'stages' && i === stageShown
              const done = reached && sr?.status === 'complete'
              const na = reached && sr?.status === 'not_applicable'
              return (
                <div key={s.key} className="flex items-center gap-1">
                  <div title={`${s.hint}${sr?.message ? ` — ${sr.message}` : ''}`}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold transition-all duration-500 ${done ? 'bg-status-passBg text-status-pass' : active ? 'rs-ring scale-105 bg-teal-50 text-teal-700 ring-1 ring-teal-300' : 'bg-[#eef1f4] text-[#8a97a3]'}`}>
                    {done ? <CheckCircle2 size={13} /> : active ? <Loader2 size={13} className="animate-spin" /> : na ? <Minus size={13} /> :
                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border border-current text-[9px]">{i + 1}</span>}
                    {s.label}
                  </div>
                  {i < STAGES.length - 1 && (
                    <span className="relative h-0.5 w-6 overflow-hidden rounded bg-[#e2e6ea]" aria-hidden="true">
                      <span className={`absolute inset-0 origin-left bg-teal-400 transition-transform duration-700 ${reached ? 'scale-x-100' : 'scale-x-0'}`} />
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {phase === 'stages' && stageShown < STAGES.length && (
            <div className="mt-2 text-[12px] text-[#5c6b7a]">{STAGES[stageShown].hint}</div>
          )}
        </div>
      )}

      {/* ---- below the graph: pairs, then the replay ---- */}
      <div ref={lowerRef} className="flex flex-col gap-4">
        {result && (phase === 'replay' || phase === 'done') && (
          <ConstraintTabs result={result} eventLookup={eventLookup} onSelect={(p) => { setPick(p); setSelectedPairs([]) ; setTab(tab) }} />
        )}
        {result && applicable && (phase === 'replay' || phase === 'done') && (
          <Card>
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <div className="text-[13px] font-bold text-[#101828]">Replay</div>
              <div className="text-[11.5px] text-[#8a97a3]">
                {result.starts_from ? `starts from the ${result.starts_from}; ` : ''}each card is the total after one more event is applied, in the order that was posted
              </div>
            </div>
            <ReplayStrip replay={result.stage_5_verdict.replay_of_all_corrections} labels={replayLabels}
              playKey={phase === 'replay' ? replayKey : null} finishKey={finishKey} delay={delay}
              onStepNode={(id) => setTraceNode(id)} onEnd={() => finish(false)} />
          </Card>
        )}
      </div>

      {/* ---- the tabs, once everything has run ---- */}
      {result && phase === 'done' && (
        <div ref={tabsRef} className="flex flex-col gap-3">
          <TabBar tabs={tabs.filter((t) => t.key !== 'replay')} active={tab === 'replay' ? 'verdict' : tab} onChange={(k) => { setTab(k); setPick(null) }} />
          {(tab === 'verdict' || tab === 'replay') && <VerdictCard result={result} />}
          {tab === 'pairs' && applicable && (
            <OrderSensitivityCard result={result} nodeStatus={nodeStatus} eventLookup={eventLookup} selectedPairs={selectedPairs}
              onToggle={(p) => { setPick(null); setSelectedPairs((cur) => togglePair(cur, p)) }} onClear={() => setSelectedPairs([])}
              onRun={(chosen) => navigate(scenarioPath(caseId, unionEvents(chosen), null, limits))} />
          )}
          {tab === 'events' && applicable && <EventDescriptionCard events={result.event_descriptions} selected={eventNode} onSelect={setEventNode} />}
          {tab === 'rules' && (
            <>
              <ConstraintExplanationList constraints={result.stage_2b_constraint_extraction.given_constraints} eventLookup={eventLookup}
                selected={pick?.type === 'constraint' ? pick : null} onSelect={(c) => setPick(c ? { type: 'constraint', before: c.before, after: c.after } : null)} />
              {!applicable && <PaymentRoutesCard routes={paymentRoutes} eventLookup={eventLookup} selectedRouteKey={pick?.key}
                onSelectRoute={(key, route) => setPick(key ? { type: 'route', key, eventIds: route.eventIds } : null)} />}
            </>
          )}
          {tab === 'stages' && <Card><PipelineTimeline items={pipelineItems(result)} shown={STAGES.length} animating={false} /></Card>}
        </div>
      )}
      {result && phase === 'done' && children}
    </div>
  )
}
