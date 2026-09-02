import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, { Background, Controls, MarkerType } from 'reactflow'
import 'reactflow/dist/style.css'
import { CheckCircle2, Circle, PlayCircle } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { getCases, runReplay } from '../lib/api'
import { useSelectedCase } from '../lib/SelectedCaseContext'
import Card from '../components/Card'
import StatusBadge from '../components/StatusBadge'
import PreviewTag from '../components/PreviewTag'
import EventNode from '../components/graph/EventNode'
import { LoadingState, ErrorState } from '../components/StatusStates'
import { formatEur, formatDateTime } from '../lib/format'

const NODE_TYPES = { event: EventNode }

const STAGES = [
  { key: 'stage_1_extraction', label: 'Extraction' },
  { key: 'stage_2_candidate_identification', label: 'Candidate Identification' },
  { key: 'stage_3_confluence_checks', label: 'Confluence Checks' },
  { key: 'stage_4_policy_resolution', label: 'Policy Resolution' },
  { key: 'stage_5_verdict', label: 'Verdict' },
]

const LEGEND = [
  { label: 'Idle', color: '#8a97a3', live: true },
  { label: 'Candidate', color: '#2563eb', live: false },
  { label: 'Conflict', color: '#92650a', live: false },
  { label: 'Resolved', color: '#1a7f4c', live: false },
  { label: 'Blocked', color: '#b3261e', live: false },
]

// Lay nodes out left-to-right by hop distance (target = rightmost column).
function layoutGraph(graphView, targetId) {
  if (!graphView) return { nodes: [], edges: [] }
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
    // `hops` is already sorted furthest-first, so the array index IS the
    // column: farthest hop -> col 0 (left), target (-1) -> last col (right).
    const col = colIdx
    const rows = byHop[hop]
    // Center each column vertically so a single-node target column
    // sits level with the middle of a taller candidate column.
    const colHeight = (rows.length - 1) * ROW_GAP
    rows.forEach((n, rowIdx) => {
      nodes.push({
        id: n.id,
        position: { x: col * COL_GAP, y: rowIdx * ROW_GAP - colHeight / 2 },
        data: { node: n },
        type: 'event',
        // Not setting width/height here deliberately -- letting React
        // Flow auto-measure via its own ResizeObserver, matching how
        // every official custom-node example does it.
        draggable: true,
      })
    })
  })

  // The API's edge direction is "discovery order": source = the event
  // closer to the target that discovered target = the farther/earlier
  // event (i.e. source is near-target, target is upstream). That's the
  // right way to describe *how the backward BFS found things*, but it's
  // the wrong way to *draw* it: we want arrows to read left-to-right,
  // upstream cause -> target/loss event, matching the hop layout above.
  // So we flip source/target here, for display only.
  //
  // Only label an edge when there's more than one shared object -- a
  // label on every single edge (a) is mostly noise since almost every
  // edge has exactly one shared doc, and (b) its background chip is wide
  // enough to fully cover a short line between adjacent columns, which is
  // why edges could look completely missing even though they were drawn.
  const edges = graphView.edges.map((e, i) => ({
    id: `${e.source}-${e.target}-${i}`,
    source: e.target,
    target: e.source,
    label: e.shared_objects?.length > 1 ? `${e.shared_objects.length} shared objects` : undefined,
    labelStyle: { fontSize: 9, fill: '#5c6b7a', fontWeight: 600 },
    labelBgStyle: { fill: '#f4f6f8' },
    labelBgPadding: [3, 2],
    animated: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b', width: 20, height: 20 },
    style: { stroke: '#64748b', strokeWidth: 2 },
  }))

  return { nodes, edges }
}

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
    try {
      const data = await runReplay(selectedCaseId, { maxEvents, minEvents, maxHops })
      setResult(data)
    } catch (err) {
      setRunError(err)
    } finally {
      setRunning(false)
    }
  }

  const { nodes, edges } = useMemo(
    () => layoutGraph(result?.replay_graph, selectedCaseId),
    [result, selectedCaseId]
  )

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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_300px]">
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
                {activeCase.max_candidates_at_default_hops} candidates reachable at max_hops=3
                (true ceiling, before max_events trims the result) · value{' '}
                {formatEur(activeCase.value_eur)}
              </div>
            )}
            {runError && (
              <div className="mt-3 rounded-lg bg-status-blockedBg px-3 py-2 text-[13px] text-status-blocked">
                {runError.message}
              </div>
            )}
          </Card>

          <Card className="!p-0 overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#e2e6ea] px-5 py-3">
              <div className="text-[14px] font-bold">
                {selectedCaseId || 'Select a case'}
              </div>
              {activeCase && (
                <div className="text-[12.5px] text-[#8a97a3]">
                  {formatDateTime(activeCase.timestamp)}
                </div>
              )}
            </div>
            <div style={{ height: 560 }}>
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
            <div className="flex flex-wrap items-center gap-4 border-t border-[#e2e6ea] px-5 py-3">
              {LEGEND.map((l) => (
                <div key={l.label} className="flex items-center gap-1.5 text-[12px] text-[#5c6b7a]">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: l.color, opacity: l.live ? 1 : 0.4 }}
                  />
                  {l.label}
                  {!l.live && <PreviewTag label="Month 4" className="ml-0.5" />}
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Right panel */}
        <div className="flex flex-col gap-4">
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
                {STAGES.slice(2).map((s) => (
                  <div key={s.key}>
                    <div className="font-semibold text-[#8a97a3]">{s.label}</div>
                    <div className="text-[#8a97a3]">{result[s.key]?.message}</div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-2 text-[13px] font-bold text-[#101828]">Diagnostic</div>
            {!selectedNode ? (
              <p className="text-[12.5px] text-[#8a97a3]">
                Run a replay, then click any node to inspect it.
              </p>
            ) : (
              <div className="flex flex-col gap-1.5 text-[12.5px]">
                <Row label="Event ID" value={selectedNode.id} />
                <Row label="Activity" value={selectedNode.activity} />
                <Row label="Hop" value={selectedNode.is_target ? 'target' : selectedNode.hop} />
                <Row label="Value" value={formatEur(selectedNode.value_eur)} />
                <Row label="Timestamp" value={formatDateTime(selectedNode.timestamp)} />
                <Row
                  label="Connected"
                  value={selectedNode.connected_to_target ? 'yes' : 'no (pruned parent)'}
                />
              </div>
            )}
          </Card>
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

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between border-b border-[#eef1f4] py-1 last:border-0">
      <span className="text-[#8a97a3]">{label}</span>
      <span className="font-semibold text-[#101828]">{value}</span>
    </div>
  )
}
