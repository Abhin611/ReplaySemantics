import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, { Background, Controls, MarkerType } from 'reactflow'
import 'reactflow/dist/style.css'
import { useApi } from '../lib/useApi'
import { getCases, runReplay } from '../lib/api'
import { useSelectedCase } from '../lib/SelectedCaseContext'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import PreviewTag from '../components/PreviewTag'
import EventNode from '../components/graph/EventNode'
import ConstraintSummaryCard from '../components/ConstraintSummaryCard'
import ConstraintExplanationList from '../components/ConstraintExplanationList'
import PaymentRoutesCard from '../components/PaymentRoutesCard'
import { LoadingState, ErrorState } from '../components/StatusStates'
import { formatDateTime } from '../lib/format'
import { computePaymentRoutes } from '../lib/paymentRoutes'
import { previewStatusFor, previewPolicyVersionFor } from '../data/mockData'

const NODE_TYPES = { event: EventNode }

const LEGEND = [
  { label: 'PASS', color: '#1a7f4c' },
  { label: 'POLICY-ORDERED', color: '#92650a' },
  { label: 'BLOCKED', color: '#b3261e' },
]

// `highlight` (optional) marks matching nodes with `highlighted: true` and
// restyles matching edges -- driven by clicking a line in
// ConstraintExplanationList ({type:'constraint', before, after}) or a
// route in PaymentRoutesCard ({type:'route', eventIds}, the whole
// leaf-to-target chain).
function pairKey(a, b) {
  return [a, b].sort().join('::')
}

function buildHighlight(highlight) {
  if (!highlight) return null
  if (highlight.type === 'route') {
    const ids = new Set(highlight.eventIds)
    const edgeKeys = new Set()
    for (let i = 0; i < highlight.eventIds.length - 1; i++) {
      edgeKeys.add(pairKey(highlight.eventIds[i], highlight.eventIds[i + 1]))
    }
    return { ids, edgeKeys }
  }
  // {type: 'constraint', before, after}
  return {
    ids: new Set([highlight.before, highlight.after]),
    edgeKeys: new Set([pairKey(highlight.before, highlight.after)]),
  }
}

// Lay nodes out left-to-right by hop distance -- farthest hop on the left,
// target on the right (mirrors the "backward traversal toward a realized
// loss" model, and matches ReplayConsole's layout).
function layoutGraph(graphView, highlightSpec) {
  if (!graphView) return { nodes: [], edges: [] }
  const highlight = buildHighlight(highlightSpec)
  const byHop = {}
  graphView.nodes.forEach((n) => {
    const hop = n.is_target ? -1 : n.hop ?? 99
    byHop[hop] = byHop[hop] || []
    byHop[hop].push(n)
  })
  const hops = Object.keys(byHop)
    .map(Number)
    .sort((a, b) => b - a) // furthest hop first (left), target (-1) last (right)

  const COL_GAP = 260
  const ROW_GAP = 92
  const nodes = []
  hops.forEach((hop, colIdx) => {
    const col = colIdx // array is already ordered farthest -> target
    const rows = byHop[hop]
    const colHeight = (rows.length - 1) * ROW_GAP
    rows.forEach((n, rowIdx) => {
      nodes.push({
        id: n.id,
        position: { x: col * COL_GAP, y: rowIdx * ROW_GAP - colHeight / 2 },
        data: { node: highlight ? { ...n, highlighted: highlight.ids.has(n.id) } : n },
        type: 'event',
        draggable: true,
      })
    })
  })

  // Flip source/target for display -- see the comment in ReplayConsole.jsx.
  // The API's edge direction is discovery order (near-target -> upstream);
  // we want arrows to read upstream -> target, left to right.
  const edges = graphView.edges.map((e, i) => {
    // Checked via the direction-agnostic pairKey against the RAW
    // (unflipped) source/target -- a route's consecutive-link edgeKeys
    // and a constraint's {before, after} both resolve the same way.
    const isHighlighted = highlight && highlight.edgeKeys.has(pairKey(e.source, e.target))
    return {
      id: `${e.source}-${e.target}-${i}`,
      source: e.target,
      target: e.source,
      label: e.shared_objects?.length > 1 ? `${e.shared_objects.length} shared objects` : undefined,
      labelStyle: { fontSize: 9, fill: '#5c6b7a', fontWeight: 600 },
      labelBgStyle: { fill: '#f4f6f8' },
      labelBgPadding: [3, 2],
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isHighlighted ? '#b5850f' : '#64748b',
        width: isHighlighted ? 24 : 20,
        height: isHighlighted ? 24 : 20,
      },
      style: {
        stroke: isHighlighted ? '#b5850f' : '#64748b',
        strokeWidth: isHighlighted ? 3.5 : 2,
      },
      zIndex: isHighlighted ? 10 : 0,
    }
  })

  return { nodes, edges }
}

export default function ReplayGraph() {
  const { selectedCaseId, setSelectedCaseId } = useSelectedCase()
  const casesApi = useApi(useCallback(() => getCases(), []))
  const cases = casesApi.data?.cases || []
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedNode, setSelectedNode] = useState(null)
  const [selectedConstraint, setSelectedConstraint] = useState(null)
  const [selectedRoute, setSelectedRoute] = useState(null) // { key: 'highest' | 'lowest', eventIds }

  useEffect(() => {
    if (!selectedCaseId && cases.length) setSelectedCaseId(cases[0].case_id)
  }, [cases, selectedCaseId, setSelectedCaseId])

  useEffect(() => {
    if (!selectedCaseId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelectedNode(null)
    setSelectedConstraint(null)
    setSelectedRoute(null)
    runReplay(selectedCaseId)
      .then((data) => {
        if (!cancelled) setResult(data)
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
  }, [selectedCaseId])

  // Only one highlight is active at a time -- picking a constraint clears
  // any selected route and vice versa (see the two onSelect handlers
  // passed to the cards below), so this is a simple either/or.
  const highlightSpec = selectedConstraint
    ? { type: 'constraint', before: selectedConstraint.before, after: selectedConstraint.after }
    : selectedRoute
    ? { type: 'route', eventIds: selectedRoute.eventIds }
    : null

  const { nodes, edges } = useMemo(
    () => layoutGraph(result?.replay_graph, highlightSpec),
    [result, selectedConstraint, selectedRoute]
  )
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
              {selectedCaseId && (
                <StatusBadge status={previewStatusFor(selectedCaseId)} />
              )}
              <PreviewTag label="Verdict is preview" />
            </div>
            <div className="text-[12.5px] text-[#8a97a3]">
              {selectedCaseId && previewPolicyVersionFor(selectedCaseId)}
              {activeCase && ` · ${formatDateTime(activeCase.timestamp)}`}
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

          <div className="flex items-center gap-4 border-t border-[#e2e6ea] px-5 py-3">
            {LEGEND.map((l) => (
              <div key={l.label} className="flex items-center gap-1.5 text-[12px] text-[#5c6b7a]">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color, opacity: 0.4 }} />
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
                Click any node to inspect its verdict and diagnostics.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5 text-[12.5px]">
                <Row label="Event ID" value={selectedNode.id} />
                <Row label="Activity" value={selectedNode.activity} />
                <Row label="Hop" value={selectedNode.is_target ? 'target' : selectedNode.hop} />
                <Row label="Timestamp" value={formatDateTime(selectedNode.timestamp)} />
                <div className="mt-2 flex items-center justify-between border-t border-[#eef1f4] pt-2">
                  <span className="text-[#8a97a3]">Verdict</span>
                  <span className="flex items-center gap-1.5">
                    <StatusBadge status="IDLE" />
                    <PreviewTag label="Month 4" />
                  </span>
                </div>
              </div>
            )}
          </Card>

          {result && (
            <ConstraintExplanationList
              constraints={result.stage_2b_constraint_extraction.given_constraints}
              eventLookup={eventLookup}
              selected={selectedConstraint}
              onSelect={(c) => {
                setSelectedRoute(null)
                setSelectedConstraint(c)
              }}
            />
          )}

          {result && (
            <PaymentRoutesCard
              routes={paymentRoutes}
              eventLookup={eventLookup}
              selectedRouteKey={selectedRoute?.key}
              onSelectRoute={(key, route) => {
                setSelectedConstraint(null)
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
