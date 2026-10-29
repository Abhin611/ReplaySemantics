import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import Card from './Card'
import CalcTable from './CalcTable'
import SpeedControl from './SpeedControl'
import AnimatedNumber from './AnimatedNumber'
import { useReplaySpeed } from '../lib/useReplaySpeed'
import { traceSteps, correctionLabel, observedExplanation } from '../lib/verdict'
import { formatAmount } from '../lib/format'

// Step through R_P(X, E): the corrections applied one at a time, with the case total after each.
// The step's event is highlighted on the graph (onStepNode). `replay` is
// stage_5_verdict.replay_of_all_corrections from the real backend.
//
// Animation: when `autoPlayKey` changes to a non-null value the card restarts at the observed total and
// reveals one stage per `delay` (the shared 1x = 2 s speed). `finishKey` jumps to the last stage (Skip).
// `onAutoPlayEnd(reason)` fires when an automatic run ends: 'done', 'skipped' or 'interrupted' (the person
// took over with the buttons).
export default function ReplayTraceCard({
  replay, nodeStatus, onStepNode, title = 'Replay step-through', nonAuthoritativeNote,
  autoPlayKey = null, finishKey = 0, onAutoPlayEnd,
}) {
  const steps = useMemo(() => traceSteps(replay), [replay])
  const { delay, speedKey, setSpeedKey } = useReplaySpeed()
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [open, setOpen] = useState({}) // earlier stages the person expanded by hand
  const autoRef = useRef(false) // the current play was started automatically, not with the Play button
  const last = steps.length - 1
  const endRef = useRef(onAutoPlayEnd)
  endRef.current = onAutoPlayEnd

  // Stop playing; if it was an automatic run, tell the page how it ended.
  const halt = (reason) => {
    setPlaying(false)
    if (autoRef.current) {
      autoRef.current = false
      endRef.current?.(reason)
    }
  }
  const manual = (fn) => () => {
    halt('interrupted')
    fn()
  }

  useEffect(() => {
    setI(0)
    setPlaying(false)
    autoRef.current = false
  }, [replay])

  // An automatic run (Run Replay / Run change): start from the observed total and play on.
  useEffect(() => {
    if (autoPlayKey == null || last < 1) return
    autoRef.current = true
    if (delay === 0) {
      setI(last)
      halt('done')
      return
    }
    setI(0)
    setPlaying(true)
  }, [autoPlayKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Skip: jump to the final stage.
  useEffect(() => {
    if (!finishKey) return
    setI(last)
    halt('skipped')
  }, [finishKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!playing) return undefined
    if (delay === 0) {
      setI(last)
      halt('done')
      return undefined
    }
    if (i >= last) {
      halt('done')
      return undefined
    }
    const t = setTimeout(() => setI((x) => Math.min(last, x + 1)), delay)
    return () => clearTimeout(t)
  }, [playing, i, last, delay]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onStepNode?.(steps[i]?.nodeId ?? null)
    setOpen({}) // only the newest stage stays open; earlier ones fold to one line
  }, [i, steps]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bring the newest stage into view by scrolling only the panel that holds this card (not the whole page),
  // leaving the case bar and graph where they are. Skipped on first load / reset.
  const newestRef = useRef(null)
  useEffect(() => {
    const el = newestRef.current
    if (i === 0 || !el) return
    let p = el.parentElement
    while (p && !(['auto', 'scroll'].includes(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight)) p = p.parentElement
    if (!p) return
    const HEADER = 120 // the pinned controls + chips
    const t = setTimeout(
      () => p.scrollBy({ top: el.getBoundingClientRect().top - p.getBoundingClientRect().top - HEADER, behavior: 'smooth' }),
      delay ? 380 : 0 // let the arrow draw and the box land first
    )
    return () => clearTimeout(t)
  }, [i]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!replay || steps.length <= 1) return null
  const animate = delay > 0

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[13px] font-bold text-[#101828]">{title}</div>
        {playing && (
          <span className="flex items-center gap-1.5 rounded-full bg-teal-50 px-2 py-0.5 text-[10.5px] font-semibold text-teal-700">
            <span className="rs-live-dot h-1.5 w-1.5 rounded-full bg-teal-500" /> replaying
          </span>
        )}
      </div>
      <p className="mb-2 text-[11.5px] leading-relaxed text-[#8a97a3]">
        {replay.order_is_authoritative
          ? 'Corrections applied in the authoritative order.'
          : nonAuthoritativeNote || 'Illustrative canonical order only — the case is BLOCKED, so this is not an authoritative outcome.'}
      </p>

      {/* Controls and stage chips stay pinned while the flowchart below grows */}
      <div className="sticky top-0 z-10 -mx-5 mb-3 border-b border-[#eef1f4] bg-white px-5 pb-2.5 pt-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <IconBtn onClick={manual(() => setI(0))} label="Reset" disabled={i === 0}><RotateCcw size={14} /></IconBtn>
            <IconBtn onClick={manual(() => setI((x) => Math.max(0, x - 1)))} label="Previous step" disabled={i === 0}><ChevronLeft size={14} /></IconBtn>
            <IconBtn
              onClick={() => {
                if (playing) return halt('interrupted')
                if (i >= last) return
                setPlaying(true)
              }}
              label={playing ? 'Pause' : 'Play'}
              disabled={i >= last}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </IconBtn>
            <IconBtn onClick={manual(() => setI((x) => Math.min(last, x + 1)))} label="Next step" disabled={i >= last}><ChevronRight size={14} /></IconBtn>
          </div>
          <SpeedControl value={speedKey} onChange={setSpeedKey} />
        </div>

        <div className="mt-2 flex items-end justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {steps.map((s) => (
              <button
                key={s.index}
                onClick={manual(() => setI(s.index))}
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-all duration-300 ${
                  s.index === i
                    ? 'scale-110 border-amber-400 bg-amber-50 font-bold text-amber-900 shadow-sm'
                    : s.index < i
                    ? 'border-teal-300 bg-teal-50 text-teal-800'
                    : 'border-[#e2e6ea] text-[#8a97a3]'
                }`}
                title={s.index === 0 ? 'observed (as posted)' : `apply ${s.nodeId}`}
              >
                {s.index === 0 ? 'X' : s.nodeId}
              </button>
            ))}
          </div>
          <div className="text-right text-[11px] text-[#8a97a3]">
            compliant total {formatAmount(replay.compliant_net)}
            {i === last && (
              <div className={`rs-pop ${replay.reaches_compliant_net ? 'font-semibold text-status-pass' : 'font-semibold text-status-ordered'}`}>
                {replay.reaches_compliant_net ? 'reached ✓' : 'not reached'}
              </div>
            )}
          </div>
        </div>

        {/* Progress: the bar fills as stages land; the thin line under it counts down to the next one */}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#eef1f4]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-teal-400 to-teal-500 transition-[width] duration-700 ease-out"
            style={{ width: `${last ? (i / last) * 100 : 0}%` }}
          />
        </div>
        <div className="mt-0.5 h-px overflow-hidden bg-transparent">
          {playing && i < last && delay > 0 && (
            <div key={`${i}-${delay}`} className="rs-countdown h-full bg-teal-300" style={{ animationDuration: `${delay}ms` }} />
          )}
        </div>
      </div>

      {/* Flowchart: each stage stays on screen; the next one is drawn in below an arrow as the replay advances. */}
      <div className="flex flex-col items-stretch">
        {steps.slice(0, i + 1).map((st, k) => {
          const before = steps[k - 1]
          const isCur = k === i
          const expanded = isCur || open[st.index]
          return (
            <div key={st.index} ref={isCur ? newestRef : null} className="flex flex-col items-stretch">
              {before && <StageArrow label={`apply ${st.nodeId}`} animate={animate && isCur} />}
              {expanded ? (
                <StageBox
                  step={st}
                  before={before}
                  isCur={isCur}
                  animate={animate && isCur}
                  correction={nodeStatus?.[st.nodeId]?.correction}
                  breakdown={replay.observed_breakdown}
                  prevCalc={before?.calculation}
                  onClick={() => {
                    if (!isCur) return setOpen((o) => ({ ...o, [st.index]: false }))
                    halt('interrupted')
                    onStepNode?.(st.nodeId ?? null)
                  }}
                />
              ) : (
                <StageRow
                  step={st}
                  before={before}
                  onClick={() => {
                    halt('interrupted')
                    onStepNode?.(st.nodeId ?? null)
                    setOpen((o) => ({ ...o, [st.index]: true }))
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// Amounts get thousands grouping; rates, quantities, modes etc. are shown exactly as stored.
const EXACT_FIELDS = new Set(['rate', 'fx_rate', 'decimals', 'mode', 'quantity', 'unit_price', 'slot'])
function fmtField(field, value) {
  if (!EXACT_FIELDS.has(field)) return formatAmount(value)
  const n = Number(value)
  return Number.isNaN(n) ? String(value) : String(n) // 0.180000 -> 0.18, ROUND_DOWN stays text
}

function IconBtn({ children, onClick, label, disabled }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      disabled={disabled}
      className="rounded-md border border-[#e2e6ea] p-1.5 text-[#5c6b7a] hover:bg-[#f2f4f6] disabled:opacity-30"
    >
      {children}
    </button>
  )
}

// One stage of the flowchart: the case total after this step, what moved, and the realised loss.
function StageBox({ step, before, isCur, animate, correction, breakdown, prevCalc, onClick }) {
  const delta = before ? Number(step.net) - Number(before.net) : null
  return (
    <button
      type="button"
      onClick={onClick}
      style={animate && before ? { animationDelay: '0.32s' } : undefined}
      className={`${animate ? (before ? 'rs-box-in' : 'rs-stage-in') : ''} w-full rounded-lg border px-3 py-2 text-left text-[12px] transition-all duration-500 ${
        isCur ? 'border-amber-400 bg-amber-50 shadow-[0_0_0_3px_rgba(251,191,36,0.18)]' : 'border-teal-300 bg-teal-50/60 hover:bg-teal-50'
      }`}
    >
      <div className="flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-wide text-[#8a97a3]">
        <span>{step.index === 0 ? 'Stage 0 · Observed (as posted)' : `Stage ${step.index} · ${step.nodeId}`}</span>
        {isCur && animate && step.index > 0 && <span className="rs-live-dot h-1.5 w-1.5 rounded-full bg-amber-500" />}
      </div>
      <div className="font-mono text-[16px] font-bold text-[#101828]">
        {before && animate ? (
          <AnimatedNumber from={before.net} value={step.net} format={formatAmount} ms={1100} />
        ) : (
          formatAmount(step.net)
        )}
      </div>
      {step.index === 0 &&
        (step.calculation ? (
          <>
            <div className="mt-0.5 text-[11px] text-[#5c6b7a]">How this posted total was calculated:</div>
            <CalcTable rows={step.calculation.rows} animate={animate} dense />
          </>
        ) : (
          <div className="mt-0.5 text-[11px] leading-relaxed text-[#5c6b7a]">{observedExplanation(breakdown, formatAmount)}</div>
        ))}
      {delta !== null && (
        <div className="text-[11px] text-[#5c6b7a]">
          {delta === 0 ? 'no change in total' : `${delta > 0 ? '+' : ''}${formatAmount(delta)} vs previous stage`}
          {correction && ` · ${correctionLabel(correction)}`}
        </div>
      )}
      {step.loss != null && (
        <div className="mt-0.5 text-[11px] text-[#5c6b7a]">
          realised loss <span className="font-mono font-semibold text-[#101828]">{formatAmount(step.loss)}</span>
          {before?.loss != null && Number(step.loss) !== Number(before.loss) && (
            <> ({Number(step.loss) - Number(before.loss) > 0 ? '+' : '−'}{formatAmount(Math.abs(Number(step.loss) - Number(before.loss)))} vs previous stage)</>
          )}
        </div>
      )}
      {step.applied === false && (
        <div className="text-[11px] text-[#8a97a3]">
          {step.reason === 'exempt' ? 'approved exception — correction skipped' : 'context event — nothing to correct'}
        </div>
      )}
      {step.changed.length > 0 && (
        <ul className="mt-1 text-[11px] text-[#5c6b7a]">
          {step.changed.slice(0, 4).map((c, k) => (
            <li key={k} className="font-mono">
              {c.node}.{c.field}: {fmtField(c.field, c.before)} → {fmtField(c.field, c.after)}
            </li>
          ))}
        </ul>
      )}
      {step.index > 0 && step.calculation && (
        <>
          <div className="mt-1.5 text-[11px] text-[#5c6b7a]">Total recalculated (changed lines highlighted):</div>
          <CalcTable rows={step.calculation.rows} prevRows={prevCalc?.rows} animate={animate} dense />
        </>
      )}
    </button>
  )
}

// An earlier stage folded to a single line: which stage, the total it reached, and how far it moved. Click to unfold.
function StageRow({ step, before, onClick }) {
  const delta = before ? Number(step.net) - Number(before.net) : null
  return (
    <button
      type="button"
      onClick={onClick}
      title="Click to show this stage's calculation"
      className="flex w-full items-center gap-2 rounded-lg border border-teal-200 bg-teal-50/50 px-3 py-1.5 text-left text-[12px] transition-colors hover:bg-teal-50"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal-500" />
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-[#8a97a3]">
        {step.index === 0 ? 'Stage 0 · Observed' : `Stage ${step.index} · ${step.nodeId}`}
      </span>
      <span className="ml-auto font-mono text-[12px] font-bold text-[#101828]">{formatAmount(step.net)}</span>
      {delta !== null && delta !== 0 && (
        <span className={`font-mono text-[10.5px] ${delta > 0 ? 'text-status-pass' : 'text-status-blocked'}`}>
          {delta > 0 ? '+' : '−'}{formatAmount(Math.abs(delta))}
        </span>
      )}
    </button>
  )
}

// Connector between two stages: a vertical line that draws downward into an arrowhead, labelled with the event applied.
function StageArrow({ label, animate }) {
  return (
    <div className="flex items-center gap-2 pl-6" aria-hidden="true">
      <svg width="14" height="20" viewBox="0 0 14 20" className="shrink-0 text-teal-600">
        <line x1="7" y1="0" x2="7" y2="13" stroke="currentColor" strokeWidth="1.8" pathLength="1" className={animate ? 'rs-line-draw' : ''} />
        <path d="M2 10 L7 19 L12 10 Z" fill="currentColor" className={animate ? 'rs-head-pop' : ''} />
      </svg>
      <span className={`font-mono text-[10.5px] text-[#8a97a3] ${animate ? 'rs-label-in' : ''}`}>{label}</span>
    </div>
  )
}
