import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import { AlertTriangle, ArrowRight, FlaskConical, TrendingDown, TrendingUp } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { clearApiCache, getAnalysis, getHops, getScenario, recordAction, runReplay } from '../lib/api'
import { limitsBody } from '../lib/history'
import ReplayFlow from '../components/ReplayFlow'
import ChangePanel from '../components/ChangePanel'
import { fullGraphLimits } from '../lib/flow'
import { useSelectedCase, usePersistentState } from '../lib/SelectedCaseContext'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import EventNode from '../components/graph/EventNode'
import ReplayTraceCard from '../components/ReplayTraceCard'
import PropagationReport from '../components/PropagationReport'
import RefreshButton from '../components/RefreshButton'
import { LoadingState, ErrorState } from '../components/StatusStates'
import { layoutGraph } from '../lib/graphLayout'
import { buildNodeStatus, badgeStatus, correctionLabel } from '../lib/verdict'
import {
  buildFlow, direction, formatPrecise, formatSigned, nodeEffects, orderLabel, parseScenarioParams, scenarioPath,
} from '../lib/scenario'

const NODE_TYPES = { event: EventNode }

const LEGEND = [
  { label: 'applied in this swap', color: '#1a7f4c' },
  { label: 'cascaded (changed, not in the swap)', color: '#92650a' },
  { label: 'unchanged', color: '#c2cad2' },
  { label: 'target', color: '#2a9d8f' },
]
// shown while the step-through plays: the propagation overlay
const FLOW_LEGEND = [
  { label: 'being applied now', color: '#1a7f4c' },
  { label: 'applied earlier', color: '#9ad1b1' },
  { label: 'queued', color: '#7aa88d' },
  { label: 'dependent left out of date (Δ)', color: '#d97706' },
]

// "Run change" lands here: the corrected case for one set of corrections (usually an order-sensitive
// pair), set against the previous case. Everything comes from GET /api/cases/{id}/scenario.
export default function Scenario() {
  const [params, setParams] = useSearchParams()
  const { selectedCaseId } = useSelectedCase()
  const { caseId: paramCase, subset, order, limits: urlLimits } = parseScenarioParams(params)
  const caseId = paramCase || null
  const subsetKey = subset.join(',')
  const orderKey = order.join(',')
  const [traceNode, setTraceNode] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  // The change you last ran is remembered, so the sidebar's "Swap Scenario" reopens it instead of
  // asking you to pick again.
  const [last, setLast] = usePersistentState('scenario:last', null) // { caseId, subset, order }
  const [watched, setWatched] = usePersistentState('scenario:watched', null) // key of the change whose animation has played
  const navigate = useNavigate()
  const hasParams = !!caseId && subset.length > 0
  // Refresh: forget the remembered change and every cached response, and go back to the empty page, so the
  // old change stops reopening from the sidebar. Also the way out if the remembered change no longer loads.
  const handleRefresh = () => {
    clearApiCache()
    setLast(null)
    setTraceNode(null)
    setSelectedNode(null)
    navigate('/scenario', { replace: true })
  }
  const refreshRow = (
    <div className="mb-3 flex justify-end">
      <RefreshButton onClick={handleRefresh} />
    </div>
  )
  useEffect(() => {
    if (hasParams) setLast({ caseId, subset, order, limits: urlLimits })
  }, [caseId, subsetKey, orderKey, JSON.stringify(urlLimits)]) // eslint-disable-line react-hooks/exhaustive-deps

  // the candidate set the console used travels in the address; an old link without it shows the WHOLE graph
  const hopsApi = useApi(useCallback(() => (caseId && !urlLimits ? getHops(caseId) : Promise.resolve(null)), [caseId, !!urlLimits]), [caseId, !!urlLimits]) // eslint-disable-line react-hooks/exhaustive-deps
  const limits = urlLimits || (hopsApi.data ? fullGraphLimits(hopsApi.data) : null)
  const limKey = limits ? `${limits.maxHops}/${limits.minEvents}/${limits.maxEvents}` : ''
  const analysisApi = useApi(
    useCallback(() => (caseId && limits ? getAnalysis(caseId, limits) : Promise.resolve(null)), [caseId, limKey]), // eslint-disable-line react-hooks/exhaustive-deps
    [caseId, limKey]
  )
  const scenarioApi = useApi(
    useCallback(() => (caseId && subset.length && limits ? getScenario(caseId, subset, order, limits) : Promise.resolve(null)), [caseId, subsetKey, orderKey, limKey]), // eslint-disable-line react-hooks/exhaustive-deps
    [caseId, subsetKey, orderKey, limKey]
  )
  const replayApi = useApi(
    useCallback(() => (caseId && subset.length && limits ? runReplay(caseId, limits) : Promise.resolve(null)), [caseId, subsetKey, limKey]), // eslint-disable-line react-hooks/exhaustive-deps
    [caseId, subsetKey, limKey]
  )

  const s = scenarioApi.data
  // each order the user opens is an action in their history (the server ignores an exact repeat)
  useEffect(() => {
    if (s && limits) recordAction({ kind: 'swap', case_id: caseId, subset, order: s.selected_order, limits: limitsBody(limits) })
  }, [s]) // eslint-disable-line react-hooks/exhaustive-deps
  const replay = replayApi.data
  const effects = nodeEffects(s)
  const nodeStatus = useMemo(() => buildNodeStatus(replay), [replay])
  const targetId = replay?.replay_graph?.nodes?.find((n) => n.is_target)?.id ?? null
  const flow = useMemo(() => buildFlow(s?.influence, traceNode, targetId), [s, traceNode, targetId])
  const { nodes, edges } = useMemo(
    () => layoutGraph(replay?.replay_graph, null, nodeStatus, effects, flow),
    [replay, nodeStatus, effects, flow] // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (!hasParams && last) return <Navigate replace to={scenarioPath(last.caseId, last.subset, last.order, last.limits)} />
  if (!hasParams) {
    return (
      <Card>
        <div className="flex flex-col items-start gap-3">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[15px] font-bold text-[#101828]">
              <FlaskConical size={17} /> Swap Scenario
            </div>
            <RefreshButton onClick={handleRefresh} />
          </div>
          <p className="max-w-xl text-[13px] leading-relaxed text-[#5c6b7a]">
            No change selected yet. Open a benchmark case in the Replay Console, choose one or more pairs in the{' '}
            <b>Pairs</b> tab and press <b>Run change</b>. This page then shows each order on the recorded values, step by step, with the new total and
            realised loss against the original graph.
          </p>
          <Link
            to="/replay-console"
            className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-navy-800"
          >
            Go to Replay Console
          </Link>
          {selectedCaseId && <span className="text-[11.5px] text-[#8a97a3]">Selected case: {selectedCaseId}</span>}
        </div>
      </Card>
    )
  }

  if (scenarioApi.loading || replayApi.loading || (!limits && !hopsApi.error))
    return (
      <div>
        {refreshRow}
        <LoadingState label="Running the change…" />
      </div>
    )
  if (scenarioApi.error)
    return (
      <div>
        {refreshRow}
        <ErrorState error={scenarioApi.error} onRetry={scenarioApi.refetch} />
      </div>
    )
  if (!s) return null

  const sel = s.selected
  const badge = badgeStatus(s.subset_verdict)
  const eventLookup = {}
  replay?.replay_graph?.nodes?.forEach((n) => { eventLookup[n.id] = n.activity })
  const label = (id) => {
    const c = correctionLabel(nodeStatus?.[id]?.correction)
    return c ? `${id} (${c})` : id
  }
  const pickOrder = (o) => setParams(new URLSearchParams(scenarioPath(caseId, subset, o, limits).split('?')[1]))
  const nodeInfo = selectedNode && effects?.[selectedNode.id]

  const goEdit = () => document.getElementById('scenario-edit')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <ReplayFlow fixed={{ caseId, limits }} highlightIds={subset} onEdit={goEdit}>
    <div className="flex flex-col gap-4">
      {/* Header: what was changed, and which order */}
      <Card className="!p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <FlaskConical size={16} className="text-teal-500" />
              <span className="text-[15px] font-bold text-[#101828]">{caseId}</span>
              <span className="text-[#c2cad2]">·</span>
              <span className="font-mono text-[13px] font-semibold">
                swap {s.subset.map(label).join(' + ')}
              </span>
              {badge && <StatusBadge status={badge} />}
            </div>
            <div className="mt-1 text-[12px] text-[#8a97a3]">
              policy {s.policy_version} · synthetic benchmark case · {s.subset.length} events in this swap ·{' '}
              {s.legit_order_count} legitimate order{s.legit_order_count === 1 ? '' : 's'} · the previous case is the original graph
              (every value as recorded); only an edit or a different order can change a value
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/replay-console" className="text-[12px] font-semibold text-teal-500 hover:underline">
              ← back to Pairs
            </Link>
            <RefreshButton onClick={handleRefresh} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11.5px] font-semibold text-[#5c6b7a]">
            {s.legit_order_count > s.orders.length ? 'Distinct outcomes (one example order each):' : 'Order applied:'}
          </span>
          {s.orders.map((o) => {
            const on = o.contains_selected
            return (
              <button
                key={o.order.join(',')}
                onClick={() => pickOrder(o.order)}
                title={o.order_count > 1 ? `${o.order_count} legitimate orders give this total` : undefined}
                className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[12px] ${
                  on ? 'border-navy-900 bg-navy-900 text-white' : 'border-[#e2e6ea] bg-white text-[#101828] hover:bg-[#f2f4f6]'
                }`}
              >
                {on ? orderLabel(s.selected_order) : orderLabel(o.order)}
                {o.order_count > 1 && (
                  <span className={`rounded px-1 font-sans text-[10px] font-semibold ${on ? 'bg-white/20' : 'bg-[#eef1f4] text-[#5c6b7a]'}`}>
                    ×{o.order_count}
                  </span>
                )}
                {o.authoritative && (
                  <span className={`rounded px-1 text-[10px] font-sans font-semibold ${on ? 'bg-white/20' : 'bg-status-passBg text-status-pass'}`}>
                    policy order
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {s.exploratory && (
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-status-blockedBg px-3 py-2 text-[12px] leading-snug text-status-blocked">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              {s.note} The orders differ by <b className="font-mono">{formatPrecise(s.order_spread)}</b>.
            </span>
          </div>
        )}
        {s.groups_truncated && (
          <div className="mt-2 text-[11px] text-[#8a97a3]">
            {s.order_groups_total} distinct outcomes exist; the {s.orders.length} most common are listed.
          </div>
        )}
        {!s.exploratory && !s.orders_agree && !sel.authoritative && (
          <div className="mt-3 rounded-lg bg-status-orderedBg px-3 py-2 text-[12px] text-status-ordered">
            You are viewing a swapped order. The policy applies{' '}
            <b className="font-mono">{orderLabel(s.authoritative_order)}</b>; that is the outcome the verdict stands behind.
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex flex-col gap-4">
          {/* New vs previous */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Stat
              title="Total"
              now={sel.net}
              was={s.baseline.net}
              delta={sel.delta_net}
              goodWhen="up"
              foot={`compliant total ${formatPrecise(s.baseline.compliant_net)} · ${
                sel.reaches_compliant_net ? 'reached' : `${formatPrecise(Math.abs(Number(sel.gap_to_compliant)))} short`
              }`}
            />
            <Stat
              title="Realised loss"
              now={sel.loss}
              was={s.baseline.loss}
              delta={sel.delta_loss}
              goodWhen="down"
              foot={s.exploratory ? 'exploratory — not an authoritative loss' : 'loss after this change'}
            />
            <Card className="!p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8a97a3]">Loss removed by this order</div>
              <div className="mt-1 font-mono text-[20px] font-bold text-[#101828]">{formatPrecise(sel.value)}</div>
              <div className="mt-1 text-[11.5px] text-[#5c6b7a]">
                v({s.subset.join(', ')}) = previous loss − new loss
                {s.exploratory ? ' (exploratory)' : ''}
              </div>
            </Card>
          </div>

          {/* Corrected graph */}
          <Card className="!p-0 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-[#e2e6ea] px-5 py-2.5">
              <div className="text-[14px] font-bold">
                Graph after this order
                <span className="ml-2 text-[11px] font-normal text-[#8a97a3]">
                  columns = hops (furthest on the left){flow ? ' · press Play to follow the change' : ''}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {(flow ? FLOW_LEGEND : LEGEND).map((l) => (
                  <div key={l.label} className="flex items-center gap-1.5 text-[11.5px] text-[#5c6b7a]">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} />
                    {l.label}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ height: 'clamp(300px, calc(100vh - 470px), 520px)' }}>
              {replay?.replay_graph ? (
                <ReactFlow
                  key={`${caseId}-${subsetKey}-${nodes.length}`}
                  nodes={nodes}
                  edges={edges}
                  nodeTypes={NODE_TYPES}
                  onNodeClick={(_e, node) => setSelectedNode(node.data.node)}
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
                  {replayApi.error ? replayApi.error.message : 'Graph unavailable.'}
                </div>
              )}
            </div>
            <div className="border-t border-[#e2e6ea] px-5 py-2.5 text-[12.5px]">
              {!selectedNode ? (
                <span className="text-[#8a97a3]">
                  {flow
                    ? `Step ${flow.step + 1}: the green pulsing node is being applied; amber nodes are the dependents that differ because of the order, with the amount.`
                    : 'Click an event to see what the change did to it, or press Play on the right to watch the change travel through the graph.'}
                </span>
              ) : (
                <div>
                  <span className="font-semibold text-[#101828]">{selectedNode.id}</span>
                  <span className="text-[#8a97a3]"> · {selectedNode.activity} · </span>
                  <span className="text-[#5c6b7a]">
                    {nodeInfo?.role === 'corrected' ? `applied at step ${nodeInfo.step}` : nodeInfo?.role ?? 'target'}
                  </span>
                  {nodeInfo?.changes?.length > 0 ? (
                    <ul className="mt-1 font-mono text-[11.5px] text-[#5c6b7a]">
                      {nodeInfo.changes.map((c) => (
                        <li key={c.field}>
                          {c.field}: {formatPrecise(c.before)} → <b className="text-[#101828]">{formatPrecise(c.after)}</b>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-[#8a97a3]"> · same as posted</span>
                  )}
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4 lg:sticky lg:top-2 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
          <ReplayTraceCard
            key={orderKey + subsetKey}
            replay={sel}
            nodeStatus={nodeStatus}
            title="How the change builds the new total"
            authoritativeNote="Recorded values applied in the policy order."
            nonAuthoritativeNote="Recorded values applied in this order. It is not authoritative for the verdict — shown for comparison only."
            onStepNode={setTraceNode}
            autoPlayKey={watched === caseId + orderKey + subsetKey ? null : caseId + orderKey + subsetKey}
            onAutoPlayEnd={() => setWatched(caseId + orderKey + subsetKey)}
          />

          <Card>
            <div className="mb-1 text-[13px] font-bold text-[#101828]">Order comparison</div>
            <p className="mb-2 text-[11.5px] leading-relaxed text-[#8a97a3]">
              {s.orders_agree
                ? `All ${s.legit_order_count} legitimate order${s.legit_order_count === 1 ? '' : 's'} give the same total.`
                : `${s.legit_order_count} legitimate orders give ${s.order_groups_total} distinct totals, spread over ${formatPrecise(
                    s.order_spread
                  )}.`}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-[#8a97a3]">
                    <th className="pb-1 pr-2 font-semibold">Order</th>
                    <th className="pb-1 pr-2 text-right font-semibold">Total</th>
                    <th className="pb-1 text-right font-semibold">Loss</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {s.orders.map((o) => (
                    <tr key={o.order.join(',')} className="border-t border-[#eef1f4] align-top">
                      <td className="py-1.5 pr-2">
                        {orderLabel(o.order)}
                        {o.order_count > 1 && (
                          <div className="font-sans text-[10px] text-[#8a97a3]">
                            +{o.order_count - 1} more order{o.order_count - 1 === 1 ? '' : 's'}, same total
                          </div>
                        )}
                        {o.authoritative && <div className="font-sans text-[10px] font-semibold text-status-pass">policy order</div>}
                      </td>
                      <td className="py-1.5 pr-2 text-right">
                        {formatPrecise(o.net)}
                        <div className="text-[10px] text-[#8a97a3]">{formatSigned(o.delta_net)}</div>
                      </td>
                      <td className="py-1.5 text-right">
                        {formatPrecise(o.loss)}
                        <div className="text-[10px] text-[#8a97a3]">{formatSigned(o.delta_loss)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10.5px] text-[#8a97a3]">Small figures under each value are the change against the previous case.</p>
          </Card>
        </div>
      </div>

      <PropagationReport scenario={s} caseId={caseId} onFocusNode={setTraceNode} />
      <ChangePanel caseId={caseId} limits={limits} analysis={analysisApi.data} defaultSwap={s.selected_order} panelId="scenario-edit" />
    </div>
    </ReplayFlow>
  )
}

function Stat({ title, now, was, delta, goodWhen, foot }) {
  const dir = direction(delta)
  const good = dir === 'flat' ? null : (dir === 'up') === (goodWhen === 'up')
  const Icon = dir === 'down' ? TrendingDown : TrendingUp
  return (
    <Card className="!p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8a97a3]">{title}</div>
      <div className="mt-1 flex items-center gap-2 font-mono text-[12px] text-[#8a97a3]">
        <span className="line-through decoration-[#c2cad2]">{formatPrecise(was)}</span>
        <ArrowRight size={12} />
      </div>
      <div className="font-mono text-[20px] font-bold text-[#101828]">{formatPrecise(now)}</div>
      <div className={`mt-1 flex items-center gap-1 font-mono text-[12px] font-semibold ${good === null ? 'text-[#5c6b7a]' : good ? 'text-status-pass' : 'text-status-blocked'}`}>
        {dir !== 'flat' && <Icon size={13} />}
        {formatSigned(delta)} vs previous
      </div>
      <div className="mt-1 text-[11px] text-[#8a97a3]">{foot}</div>
    </Card>
  )
}
