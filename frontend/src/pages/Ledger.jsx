import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Layers, PlayCircle } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { clearApiCache, getAnalysis, getCases, getHops, getPairRun } from '../lib/api'
import ChangePanel from '../components/ChangePanel'
import { useSelectedCase, usePersistentState } from '../lib/SelectedCaseContext'
import Card from '../components/Card'
import RefreshButton from '../components/RefreshButton'
import StatusBadge from '../components/StatusBadge'
import { LoadingState, ErrorState, EmptyState } from '../components/StatusStates'
import { formatPrecise, formatSignedFine } from '../lib/scenario'
import { hopProfileText, lossShares, pairBadge, partialNotice } from '../lib/ledger'
import { fullGraphLimits } from '../lib/flow'

const SYNTHETIC = 'benchmark (synthetic)'
const STEP_MS = 420 // the flow reveals one step at a time, like the pipeline on the Replay Console

function Section({ n, title, children, shown = true }) {
  if (!shown) return null
  return (
    <Card className="rs-fade">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-navy-900 text-[12px] font-bold text-white">{n}</span>
        <h3 className="text-[15px] font-semibold text-[#101828]">{title}</h3>
      </div>
      {children}
    </Card>
  )
}

function Kv({ label, value, tone }) {
  return (
    <div className="rounded-lg border border-[#e2e6ea] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-[#8a97a3]">{label}</div>
      <div className={`text-[15px] font-semibold ${tone || 'text-[#101828]'}`}>{value}</div>
    </div>
  )
}

function NodeCard({ node, facts }) {
  const isPosted = node.role === 'posted'
  const border = node.role === 'context' ? 'border-[#e2e6ea] bg-[#f7f9fa]' : node.deviates || node.posted?.stale ? 'border-amber-300 bg-amber-50/40' : 'border-[#e2e6ea] bg-white'
  return (
    <div className={`rounded-lg border p-3 text-[12.5px] ${border}`} data-node={node.node_id}>
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-[#101828]">{node.node_id} · {node.activity}</div>
        <span className="rounded bg-[#eef1f4] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#5c6b7a]">hop {node.hop ?? '?'}</span>
      </div>
      <div className="mt-0.5 text-[11px] uppercase tracking-wide text-[#8a97a3]">
        {node.role === 'exempt' ? 'approved exception' : node.role === 'context' ? 'context (no financial effect)' : node.role === 'posted' ? 'posted amount' : 'input'}
      </div>
      {Object.entries(node.inputs || {}).map(([k, v]) => (
        <div key={k} className="mt-1.5 flex justify-between gap-2">
          <span className="text-[#5c6b7a]">{k} (recorded)</span>
          <span className="font-semibold text-[#101828]">
            {formatPrecise(node.was?.[k])}
            {String(node.was?.[k]) !== String(v) && <span className="ml-1.5 font-normal text-[#8a97a3]">authorised {formatPrecise(v)}</span>}
          </span>
        </div>
      ))}
      {isPosted && node.posted && (
        <div className="mt-2 rounded-md bg-white/70 px-2 py-1.5 ring-1 ring-[#e2e6ea]">
          <div className="flex justify-between"><span className="text-[#5c6b7a]">posted {node.posted.field}</span><span className="font-semibold">{formatPrecise(node.posted.value)}</span></div>
          <div className="flex justify-between"><span className="text-[#5c6b7a]">compliant value</span><span className="font-semibold">{formatPrecise(node.posted.should_be)}</span></div>
          <div className={`flex justify-between ${node.posted.stale ? 'text-amber-700' : 'text-status-pass'}`}>
            <span>gap</span><span className="font-semibold">{node.posted.stale ? formatSignedFine(node.posted.gap) : 'none (not stale)'}</span>
          </div>
        </div>
      )}
      {facts && (
        <div className="mt-2 rounded-md bg-[#f7f9fa] px-2 py-1.5 text-[11.5px] text-[#5c6b7a] ring-1 ring-[#eef1f4]">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-[#8a97a3]">recorded in the log</div>
          <div>{facts.timestamp}</div>
          {facts.objects?.length > 0 && <div className="truncate" title={facts.objects.map((o) => `${o.type} ${o.id}`).join(', ')}>{facts.objects.map((o) => `${o.type} ${o.id}`).join(', ')}</div>}
          {Object.entries(facts.attributes || {}).map(([k, v]) => <div key={k}>{k}: <b>{String(v)}</b></div>)}
        </div>
      )}
    </div>
  )
}

function PairRun({ run }) {
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="pair-run">
      {run.orders.map((o) => (
        <div key={o.order.join('>')} className={`rounded-lg border p-3 ${o.authoritative ? 'border-status-pass bg-status-passBg/30' : 'border-[#e2e6ea]'}`}>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[13px] font-semibold">{o.order.join(' then ')}</div>
            <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${o.authoritative ? 'bg-status-passBg text-status-pass' : 'bg-[#eef1f4] text-[#5c6b7a]'}`}>
              {o.authoritative ? 'authoritative' : o.exploratory ? 'exploratory' : 'not authoritative'}
            </span>
          </div>
          {o.steps.map((s) => (
            <div key={s.index} className="mb-2 rounded-md bg-white/70 p-2 text-[12px] ring-1 ring-[#eef1f4]">
              <div className="font-semibold">{s.index + 1}. {s.node_id} · {s.activity}: {s.field} {formatPrecise(s.posted_before)} → {formatPrecise(s.new_value)}</div>
              <div className="text-[#5c6b7a]">total {formatPrecise(s.net_after)} ({formatSignedFine(s.delta_net)}) · loss {formatPrecise(s.loss_after)}</div>
              {s.dependents.map((d) => (
                <div key={d.node_id} className={`mt-1 flex justify-between ${d.stale ? 'text-amber-700' : 'text-[#5c6b7a]'}`}>
                  <span>{d.node_id} {d.corrected ? '(applied earlier)' : '(not yet)'}: stored {formatPrecise(d.posted)} vs its formula now {formatPrecise(d.should_be)}</span>
                  <span className="font-semibold">{d.stale ? formatSignedFine(d.gap) : 'ok'}</span>
                </div>
              ))}
            </div>
          ))}
          <div className="text-[13px]">final total <b>{formatPrecise(o.final_net)}</b> · loss <b>{formatPrecise(o.final_loss)}</b>
            {o.matches_compliant_total && <CheckCircle2 size={13} className="ml-1 inline text-status-pass" />}</div>
        </div>
      ))}
    </div>
  )
}

export default function Ledger() {
  const { selectedCaseId, setSelectedCaseId } = useSelectedCase()
  const casesApi = useApi(useCallback(() => getCases(), []))
  const cases = (casesApi.data?.cases || []).filter((c) => c.source === SYNTHETIC)
  // the first run of a case shows the WHOLE graph; the limits are the user's to narrow afterwards
  const [limitsByCase, setLimitsByCase] = usePersistentState('ledger:limits2', {})
  const limits = limitsByCase[selectedCaseId] || { minEvents: 3, maxEvents: null, maxHops: 3 }
  const { minEvents, maxEvents, maxHops } = limits
  const patchLimits = (p) => setLimitsByCase((m) => ({ ...m, [selectedCaseId]: { ...limits, ...p } }))
  const setMinEvents = (v) => patchLimits({ minEvents: v })
  const setMaxEvents = (v) => patchLimits({ maxEvents: v })
  const setMaxHops = (v) => patchLimits({ maxHops: v })
  const [ran, setRan] = usePersistentState('ledger:ran', null) // { caseId, limits } of the last run
  const [step, setStep] = useState(6)
  const [pair, setPair] = useState(null)

  useEffect(() => {
    if (!selectedCaseId && cases.length) setSelectedCaseId(cases[0].case_id)
  }, [cases.length, selectedCaseId]) // eslint-disable-line react-hooks/exhaustive-deps

  const active = ran && ran.caseId === selectedCaseId ? ran : null
  const hopsApi = useApi(useCallback(() => (selectedCaseId ? getHops(selectedCaseId) : Promise.resolve(null)), [selectedCaseId]), [selectedCaseId])
  useEffect(() => {
    if (selectedCaseId && hopsApi.data && hopsApi.data.case_id === selectedCaseId && !limitsByCase[selectedCaseId]) setLimitsByCase((m) => ({ ...m, [selectedCaseId]: fullGraphLimits(hopsApi.data) }))
  }, [selectedCaseId, hopsApi.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const analysisApi = useApi(
    useCallback(() => (active ? getAnalysis(active.caseId, active.limits) : Promise.resolve(null)), [active?.caseId, JSON.stringify(active?.limits)]), // eslint-disable-line react-hooks/exhaustive-deps
    [active?.caseId, JSON.stringify(active?.limits)]
  )
  const a = analysisApi.data
  const pairApi = useApi(
    useCallback(() => (a && pair ? getPairRun(a.case_id, pair[0], pair[1], active.limits) : Promise.resolve(null)), [a?.case_id, pair?.join(','), JSON.stringify(active?.limits)]), // eslint-disable-line react-hooks/exhaustive-deps
    [a?.case_id, pair?.join(','), JSON.stringify(active?.limits)]
  )

  // each time a (new) analysis arrives, reveal the six steps one by one, and reset the change panel to its defaults
  useEffect(() => {
    if (!a?.replayable) return undefined
    setPair(null)
    setStep(1)
    const t = setInterval(() => setStep((s) => { if (s >= 6) { clearInterval(t); return 6 } return s + 1 }), STEP_MS)
    return () => clearInterval(t)
  }, [a?.case_id, JSON.stringify(a?.limits?.limits)]) // eslint-disable-line react-hooks/exhaustive-deps

  const notice = partialNotice(a?.limits)
  const run = () => setRan({ caseId: selectedCaseId, limits: { ...limits } })
  const refresh = () => { clearApiCache(); setRan(null); setPair(null) }
  if (casesApi.loading) return <LoadingState label="Loading cases…" />
  if (casesApi.error) return <ErrorState error={casesApi.error} onRetry={casesApi.refetch} />
  if (!cases.length) return <EmptyState label="No benchmark generated. Run: python -m policy_engine.benchmark.generator --out data/benchmark --seed 7" />

  const hp = hopsApi.data
  const shares = a?.replayable ? lossShares(a.totals) : null
  const input = 'w-20 rounded-lg border border-[#e2e6ea] px-3 py-2 text-[13px]'

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-[12px] font-semibold text-[#5c6b7a]">Case
            <select value={selectedCaseId || ''} onChange={(e) => { setSelectedCaseId(e.target.value); setRan(null) }}
              className="mt-1 block rounded-lg border border-[#e2e6ea] px-3 py-2 text-[13px] font-normal text-[#101828]">
              {cases.map((c) => (
                <option key={c.case_id} value={c.case_id}>
                  {c.case_id}{c.blocked ? ' · BLOCKED' : ''} · {c.hops ?? '?'} hop(s)
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12px] font-semibold text-[#5c6b7a]">min_events
            <input className={`${input} mt-1 block`} type="number" min={1} value={minEvents} onChange={(e) => setMinEvents(Number(e.target.value))} />
          </label>
          <label className="text-[12px] font-semibold text-[#5c6b7a]">max_events
            <input className={`${input} mt-1 block`} type="number" min={1} placeholder="none" value={maxEvents ?? ''}
              onChange={(e) => setMaxEvents(e.target.value === '' ? null : Number(e.target.value))} />
          </label>
          <label className="text-[12px] font-semibold text-[#5c6b7a]">max_hops
            <input className={`${input} mt-1 block`} type="number" min={1} max={8} value={maxHops} onChange={(e) => setMaxHops(Number(e.target.value))} />
          </label>
          <button onClick={run} disabled={!selectedCaseId}
            className="flex items-center gap-2 rounded-lg bg-navy-900 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50">
            <PlayCircle size={16} /> Run replay
          </button>
          <RefreshButton onClick={refresh} className="!py-2.5" />
        </div>
        {hp && (
          <div className="mt-3 text-[12px] text-[#5c6b7a]" data-testid="hop-profile">
            <Layers size={13} className="mr-1 inline" /> Reachable from the target: {hopProfileText(hp)}.{' '}
            {hp.suggested_max_hops && hp.suggested_max_hops !== maxHops && (
              <button className="font-semibold text-teal-700 underline" onClick={() => setMaxHops(hp.suggested_max_hops)}>use suggested max_hops = {hp.suggested_max_hops}</button>
            )}
          </div>
        )}
      </Card>

      {!active && <EmptyState label="Pick a case and press Run replay." />}
      {active && analysisApi.loading && <LoadingState label="Replaying every subset of the posted amounts…" />}
      {active && analysisApi.error && <ErrorState error={analysisApi.error} onRetry={analysisApi.refetch} />}

      {notice && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900" data-testid="partial-banner">
          <AlertTriangle size={14} /> <b>Partial result.</b> {notice.reasons.join('; ')}.
          {notice.suggestedHops > active.limits.maxHops && (
            <button className="rounded border border-amber-400 bg-white px-2 py-0.5 font-semibold hover:bg-amber-100"
              onClick={() => { setMaxHops(notice.suggestedHops); setRan({ caseId: selectedCaseId, limits: { ...limits, maxHops: notice.suggestedHops } }) }}>
              Re-run with max_hops = {notice.suggestedHops}
            </button>
          )}
        </div>
      )}

      {a && !a.replayable && <Card><div className="text-[13px] text-[#5c6b7a]">{a.description.text.join(' ')}</div></Card>}

      {a?.replayable && (
        <>
          <Section n={1} title="Nodes — recorded inputs and the amounts that were posted" shown={step >= 1}>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {a.reference_node && (
                <div className="rounded-lg border border-dashed border-[#1f3a5f] bg-[#eaf0f8]/60 p-3 text-[12.5px]" data-node="REF">
                  <div className="font-semibold text-[#1f3a5f]">REF · {a.reference_node.title}</div>
                  <div className="mt-0.5 text-[11px] uppercase tracking-wide text-[#8a97a3]">start node · fixed values</div>
                  {a.reference_node.lines.map((l) => (
                    <div key={l.label} className="mt-1 flex justify-between gap-2"><span className="text-[#5c6b7a]">{l.label}</span><span className="font-semibold text-[#101828]">{l.text}</span></div>
                  ))}
                  <p className="mt-2 text-[11px] leading-snug text-[#5c6b7a]">{a.reference_node.meaning}</p>
                </div>
              )}
              {a.nodes.map((n) => <NodeCard key={n.node_id} node={n} facts={n.role === 'context' || n.role === 'input' || n.role === 'exempt' ? a.event_facts?.[n.node_id] : null} />)}
            </div>
          </Section>

          <Section n={2} title="Final node — posted total, compliant total and the loss split" shown={step >= 2}>
            <div className="grid gap-2 sm:grid-cols-4">
              <Kv label="posted total" value={formatPrecise(a.totals.posted_total)} />
              <Kv label="compliant total" value={formatPrecise(a.totals.compliant_total)} />
              <Kv label="realised loss" value={formatPrecise(a.totals.realised_loss)} tone="text-status-blocked" />
              <Kv label="total with inputs fixed only" value={formatPrecise(a.totals.corrected_inputs_total)} />
            </div>
            <div className="mt-3 text-[12.5px] text-[#5c6b7a]">Explained by stale posted amounts: <b>{formatPrecise(a.totals.loss_from_stale_amounts)}</b> ({shares.stale}%) ·
              remainder from price / quantity / FX / adjustment inputs: <b>{formatPrecise(a.totals.loss_from_inputs)}</b> ({shares.inputs}%)</div>
            <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-[#eef1f4]" aria-label="loss split">
              <div className="bg-amber-500" style={{ width: `${shares.stale}%` }} title="stale amounts" />
              <div className="bg-teal-600" style={{ width: `${shares.inputs}%` }} title="inputs" />
            </div>
          </Section>

          <Section n={3} title="Policy summary — every subset of the posted amounts, replayed" shown={step >= 3}>
            <div className="flex flex-wrap items-center gap-2" data-testid="policy-summary">
              {Object.entries(a.policy_summary.counts).map(([k, v]) => (
                <span key={k} className="flex items-center gap-1.5 text-[13px]"><StatusBadge status={k.replace('_', '-')} /> × {v}</span>
              ))}
              <span className="text-[12.5px] text-[#5c6b7a]">{a.policy_summary.text} · policy {a.policy_version}</span>
            </div>
          </Section>

          <Section n={4} title="Swappable pairs — order-sensitive, posted amounts, not locked by the log (swapped with their recorded values)" shown={step >= 4}>
            {a.pairs.length === 0 ? (
              <div className="text-[13px] text-[#5c6b7a]">No pair can be swapped{a.locked_pairs.length ? ` (${a.locked_pairs.map((p) => p.join('/')).join(', ')} are fixed by the log)` : ''}.</div>
            ) : (
              <div className="space-y-2">
                {a.pairs.map((p) => {
                  const b = pairBadge(p)
                  return (
                    <div key={p.pair.join()} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[13px] ${pair?.join() === p.pair.join() ? 'border-teal-600 bg-teal-50' : 'border-[#e2e6ea]'}`}>
                      <div><b>{p.pair.join(' / ')}</b> <span className="text-[#5c6b7a]">· {Number(p.difference) === 0 ? 'swapping changes no value' : `orders differ by ${formatPrecise(p.difference)}`}</span></div>
                      <div className={`text-[12px] font-semibold ${b.tone === 'blocked' ? 'text-status-blocked' : 'text-status-ordered'}`}>{b.text}</div>
                      <button onClick={() => setPair(p.pair)} className="rounded-md bg-navy-900 px-3 py-1 text-[12px] font-semibold text-white hover:bg-navy-800">Run pair</button>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          <Section n={5} title={`Description — ${a.description.headline}`} shown={step >= 5}>
            <div className="space-y-1.5 text-[13px] text-[#101828]" data-testid="description">
              {a.description.text.map((t, i) => <p key={i}>{t}</p>)}
            </div>
          </Section>

          <Section n={6} title="Run a pair — both orders swapped, step by step" shown={step >= 6}>
            {!pair && <div className="text-[13px] text-[#5c6b7a]">Choose “Run pair” in step 4.</div>}
            {pair && pairApi.loading && <LoadingState label="Running both orders…" />}
            {pair && pairApi.error && <ErrorState error={pairApi.error} />}
            {pair && pairApi.data && (<>
              <div className="mb-2 text-[13px] text-[#101828]">{pairApi.data.summary}</div>
              <PairRun run={pairApi.data} />
            </>)}
          </Section>

          <ChangePanel caseId={a.case_id} limits={active.limits} analysis={a} defaultSwap={a.swap_default || []} panelId="ledger-edit" />
        </>
      )}
    </div>
  )
}
