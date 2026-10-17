import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import ReactFlow, { Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'
import { AlertTriangle, ArrowRight, FlaskConical, TrendingDown, TrendingUp } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { clearApiCache, getScenario, runReplay } from '../lib/api'
import { useSelectedCase, usePersistentState } from '../lib/SelectedCaseContext'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import EventNode from '../components/graph/EventNode'
import ReplayTraceCard from '../components/ReplayTraceCard'
import RefreshButton from '../components/RefreshButton'
import { LoadingState, ErrorState } from '../components/StatusStates'
import { layoutGraph } from '../lib/graphLayout'
import { buildNodeStatus, badgeStatus, correctionLabel } from '../lib/verdict'
import {
  direction, formatPrecise, formatSigned, nodeEffects, orderLabel, parseScenarioParams, scenarioPath, shapleyRows,
} from '../lib/scenario'

const NODE_TYPES = { event: EventNode }

const LEGEND = [
  { label: 'corrected in this change', color: '#1a7f4c' },
  { label: 'cascaded (changed, not corrected)', color: '#92650a' },
  { label: 'unchanged', color: '#c2cad2' },
  { label: 'target', color: '#2a9d8f' },
]

// "Run change" lands here: the corrected case for one set of corrections (usually an order-sensitive
// pair), set against the previous case. Everything comes from GET /api/cases/{id}/scenario.
export default function Scenario() {
  const [params, setParams] = useSearchParams()
  const { selectedCaseId } = useSelectedCase()
  const { caseId: paramCase, subset, order } = parseScenarioParams(params)
  const caseId = paramCase || null
  const subsetKey = subset.join(',')
  const orderKey = order.join(',')
  const [traceNode, setTraceNode] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  // The change you last ran is remembered, so the sidebar's "Corrected Scenario" reopens it instead of
  // asking you to pick again.
  const [last, setLast] = usePersistentState('scenario:last', null) // { caseId, subset, order }
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
    if (hasParams) setLast({ caseId, subset, order })
  }, [caseId, subsetKey, orderKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const scenarioApi = useApi(
    useCallback(() => (caseId && subset.length ? getScenario(caseId, subset, order) : Promise.resolve(null)), [caseId, subsetKey, orderKey]), // eslint-disable-line react-hooks/exhaustive-deps
    [caseId, subsetKey, orderKey]
  )
  const replayApi = useApi(
    useCallback(() => (caseId && subset.length ? runReplay(caseId) : Promise.resolve(null)), [caseId, subsetKey]), // eslint-disable-line react-hooks/exhaustive-deps
    [caseId, subsetKey]
  )

  const s = scenarioApi.data
  const replay = replayApi.data
  const effects = nodeEffects(s)
  const nodeStatus = useMemo(() => buildNodeStatus(replay), [replay])
  const highlight = traceNode ? { type: 'nodes', ids: [traceNode] } : null
  const { nodes, edges } = useMemo(
    () => layoutGraph(replay?.replay_graph, highlight, nodeStatus, effects),
    [replay, nodeStatus, effects, traceNode] // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (!hasParams && last) return <Navigate replace to={scenarioPath(last.caseId, last.subset, last.order)} />
  if (!hasParams) {
    return (
      <Card>
        <div className="flex flex-col items-start gap-3">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[15px] font-bold text-[#101828]">
              <FlaskConical size={17} /> Corrected Scenario
            </div>
            <RefreshButton onClick={handleRefresh} />
          </div>
          <p className="max-w-xl text-[13px] leading-relaxed text-[#5c6b7a]">
            No change selected yet. Open a benchmark case in the Replay Console, choose one or more pairs in the{' '}
            <b>Pairs</b> tab and press <b>Run change</b>. This page then shows the corrected graph, the step-by-step replay, the new total and
            realised loss against the previous ones, and the Shapley split within that change.
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

  if (scenarioApi.loading || replayApi.loading)
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
  const pickOrder = (o) => setParams({ case: caseId, subset: subsetKey, order: o.join(',') })
  const nodeInfo = selectedNode && effects?.[selectedNode.id]

  return (
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
                correct {s.subset.map(label).join(' + ')}
              </span>
              {badge && <StatusBadge status={badge} />}
            </div>
            <div className="mt-1 text-[12px] text-[#8a97a3]">
              policy {s.policy_version} · synthetic benchmark case · {s.subset.length} events corrected together ·{' '}
              {s.legit_order_count} legitimate order{s.legit_order_count === 1 ? '' : 's'} · the previous case is the posted
              (uncorrected) one
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
            You are viewing a non-authoritative order. The policy applies{' '}
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
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[#8a97a3]">Loss avoided by this change</div>
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
              <div className="text-[14px] font-bold">Corrected graph</div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {LEGEND.map((l) => (
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
                <span className="text-[#8a97a3]">Click an event to see what the change did to it.</span>
              ) : (
                <div>
                  <span className="font-semibold text-[#101828]">{selectedNode.id}</span>
                  <span className="text-[#8a97a3]"> · {selectedNode.activity} · </span>
                  <span className="text-[#5c6b7a]">
                    {nodeInfo?.role === 'corrected' ? `corrected at step ${nodeInfo.step}` : nodeInfo?.role ?? 'target'}
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
                    <span className="text-[#8a97a3]"> · no field changed</span>
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
            nonAuthoritativeNote="This order is not authoritative for the verdict — shown for comparison only."
            onStepNode={setTraceNode}
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

          <ShapleyCard shapley={s.shapley} subsetVerdict={s.subset_verdict} />
        </div>
      </div>
    </div>
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

function ShapleyCard({ shapley, subsetVerdict }) {
  const rows = shapleyRows(shapley)
  return (
    <Card>
      <div className="mb-1 text-[13px] font-bold text-[#101828]">Shapley within this change</div>
      {shapley.status !== 'ok' ? (
        <div className="rounded-lg bg-status-blockedBg px-3 py-2 text-[12px] leading-snug text-status-blocked">
          Withheld. {shapley.reason}
        </div>
      ) : (
        <>
          <p className="mb-2 text-[11.5px] leading-relaxed text-[#8a97a3]">
            Splits the loss this change avoids ({formatPrecise(shapley.v_of_subset)}) between the corrected events. It is not
            the case-level attribution, which splits the whole case.
          </p>
          <ul className="flex flex-col gap-2">
            {rows.map((r) => (
              <li key={r.id}>
                <div className="flex items-baseline justify-between font-mono text-[12px]">
                  <span className="font-semibold text-[#101828]">{r.id}</span>
                  <span>{formatPrecise(r.value)} <span className="text-[#8a97a3]">({Math.round(r.share * 100)}%)</span></span>
                </div>
                <div className="mt-0.5 h-1.5 rounded-full bg-[#eef1f4]">
                  <div className="h-1.5 rounded-full bg-teal-500" style={{ width: `${Math.max(0, Math.min(100, r.share * 100))}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <div className={`mt-2 text-[11px] ${shapley.efficient ? 'text-status-pass' : 'text-status-blocked'}`}>
            sum {formatPrecise(shapley.total)} {shapley.efficient ? '= v(S) ✓' : '≠ v(S) — check'}
          </div>
        </>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer text-[11px] font-semibold text-[#5c6b7a]">Coalition values used</summary>
        <table className="mt-1 w-full text-[11px]">
          <tbody className="font-mono">
            {shapley.coalition_table.map((t) => (
              <tr key={t.key || 'empty'} className="border-t border-[#eef1f4]">
                <td className="py-0.5 pr-2">{t.key ? `{${t.subset.join(', ')}}` : '∅'}</td>
                <td className="py-0.5 pr-2 text-[10px] text-[#8a97a3]">{t.verdict}</td>
                <td className="py-0.5 text-right">{t.value === null ? 'withheld' : formatPrecise(t.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <p className="mt-2 text-[10.5px] text-[#8a97a3]">Shapley source: {shapley.source}.</p>
    </Card>
  )
}
