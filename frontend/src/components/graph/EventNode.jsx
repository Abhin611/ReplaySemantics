import { Handle, Position } from 'reactflow'
import { NODE_KIND_STYLE } from '../../lib/verdict'
import { formatSignedFine } from '../../lib/scenario'

// Renders one event as a labeled circle (id inside, activity + hop below),
// matching the Figma "E2 / GR-Posting" node style instead of React Flow's
// blank default box.
//
// Two things matter for React Flow to actually draw edges reliably:
// 1. The node's `width`/`height` (set explicitly where these nodes are
//    built, in layoutGraph()) must match what's rendered here -- if React
//    Flow has to auto-measure via ResizeObserver instead, edges can be
//    computed before that measurement lands, especially on small graphs
//    with few render cycles, and silently fail to draw.
// 2. Handle position is calculated relative to this component's outer
//    (returned) element, not wherever the <Handle> JSX sits in the tree --
//    so with labels stacked below the circle, a default 50%-vertical
//    handle lands well below the circle's actual center. We override
//    `top` explicitly to the circle's true center instead.
// Corrected-scenario overlay (n.scenario, set by layoutGraph on the Corrected Scenario page):
// corrected = this event's correction was applied in the change; cascaded = changed without being
// corrected itself; unchanged = untouched by the change.
const SCENARIO_STYLE = {
  corrected: { border: '#1a7f4c', bg: '#e5f6ec', text: '#14532d' },
  cascaded: { border: '#92650a', bg: '#fdf1d8', text: '#6b4a08' },
  unchanged: { border: '#c2cad2', bg: '#ffffff', text: '#8a97a3' },
}

// Step-by-step propagation overlay (n.flow, set by layoutGraph from buildFlow on the Corrected Scenario page).
const FLOW_STYLE = {
  active: { border: '#1a7f4c', bg: '#c9f0d8', text: '#14532d' },
  done: { border: '#1a7f4c', bg: '#e5f6ec', text: '#14532d' },
  queued: { border: '#7aa88d', bg: '#ffffff', text: '#4b6b57' },
  idle: { border: '#c2cad2', bg: '#ffffff', text: '#8a97a3' },
}
const AFFECTED_STYLE = { border: '#d97706', bg: '#fff1d6', text: '#7a3d00' }

export const NODE_WIDTH = 130
export const NODE_HEIGHT = 108
const CIRCLE_SIZE = 56
const CIRCLE_CENTER = CIRCLE_SIZE / 2

// n.highlighted (set by the page, not stored on the API's node payload)
// draws the amber "selected constraint" ring -- see ConstraintExplanationList.
// n.verdictKind (set from the real stage 3-4 verdict data, see lib/verdict.js buildNodeStatus) colours
// the node: order-sensitive & blocked / policy-ordered, order-independent, exempt, context.
// Absent for real VBFA events (no verdict exists there), which keep the plain styling.

export default function EventNode({ data }) {
  const n = data.node
  const isTarget = n.is_target
  const disconnected = !isTarget && n.connected_to_target === false
  const highlighted = !!n.highlighted
  const isRef = !!n.is_reference

  const sc = n.scenario || null
  const fl = n.flow || null
  const flowRing = fl && !isTarget ? (fl.affected && fl.state !== 'active' ? AFFECTED_STYLE : FLOW_STYLE[fl.state] ?? FLOW_STYLE.idle) : null
  const kind = !isTarget && !sc && n.verdictKind ? NODE_KIND_STYLE[n.verdictKind] : null

  const ring = isRef
    ? { border: '#1f3a5f', bg: '#eaf0f8', text: '#1f3a5f' }
    : isTarget
    ? { border: '#2a9d8f', bg: '#e6f6f4', text: '#0d4f47' }
    : flowRing
    ? flowRing
    : sc
    ? SCENARIO_STYLE[sc.role]
    : kind
    ? kind
    : disconnected
    ? { border: '#b3261e', bg: '#fbe4e2', text: '#7a1a14' }
    : { border: '#c2cad2', bg: '#ffffff', text: '#101828' }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        opacity: (fl ? fl.state === 'idle' && !fl.affected : sc && sc.role === 'unchanged') && !isTarget ? 0.5 : 1,
      }}
    >
      <Handle
        type="target"
        position={Position.Left}
        style={{ opacity: 0, top: CIRCLE_CENTER, transform: 'translate(-50%, -50%)' }}
      />
      <div
        style={{
          width: CIRCLE_SIZE,
          height: CIRCLE_SIZE,
          borderRadius: '50%',
          border: highlighted
            ? '3px solid #b5850f'
            : `${fl?.state === 'active' || fl?.affected ? 3 : 2}px ${isRef || n.verdictKind === 'exempt' || fl?.state === 'queued' ? 'dashed' : 'solid'} ${ring.border}`,
          background: highlighted ? '#fff6e0' : ring.bg,
          color: highlighted ? '#7a5b0a' : ring.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: 'JetBrains Mono, monospace',
          boxShadow: highlighted
            ? '0 0 0 5px rgba(181,133,15,0.25)'
            : isTarget
            ? '0 0 0 3px rgba(42,157,143,0.15)'
            : 'none',
          flexShrink: 0,
          transition: 'box-shadow 150ms ease, background 150ms ease, border 150ms ease',
        }}
        className={fl?.state === 'active' ? 'rs-pulse' : fl?.affected ? 'rs-affected' : undefined}
        title={sc ? `${n.id} — ${sc.role}` : kind ? `${n.id} — ${kind.label}` : n.id}
      >
        {isRef ? 'REF' : n.id}
      </div>
      <div
        style={{
          marginTop: 6,
          fontSize: 10.5,
          textAlign: 'center',
          color: '#5c6b7a',
          fontFamily: 'JetBrains Mono, monospace',
          lineHeight: 1.3,
          maxWidth: NODE_WIDTH - 4,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={n.activity}
      >
        {n.activity || (isTarget ? 'target' : '')}
      </div>
      {n.brief && (
        <div
          style={{ fontSize: 9.5, color: '#475467', fontWeight: 600, fontFamily: 'JetBrains Mono, monospace', maxWidth: NODE_WIDTH + 24,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          title={n.brief}
        >
          {n.brief}
        </div>
      )}
      <div style={{ fontSize: 9.5, color: '#a3adb6', fontFamily: 'JetBrains Mono, monospace' }}>
        {isRef ? 'start · fixed values' : isTarget
          ? fl?.deltaText
            ? `★ target · total ${fl.deltaText}`
            : '★ target'
          : fl
          ? fl.affected
            ? `hop ${n.hop} · Δ ${formatSignedFine(fl.affected.gap)}`
            : fl.state === 'active'
            ? `hop ${n.hop} · applying (step ${fl.step})`
            : fl.state === 'done'
            ? `hop ${n.hop} · corrected (step ${fl.step})`
            : fl.state === 'queued'
            ? `hop ${n.hop} · queued (step ${fl.step})`
            : `hop ${n.hop}`
          : sc
          ? sc.role === 'corrected'
            ? `corrected · step ${sc.step}`
            : sc.role === 'cascaded'
            ? 'cascaded'
            : `hop ${n.hop} · unchanged`
          : n.verdictKind === 'blocked' || n.verdictKind === 'ordered'
          ? `hop ${n.hop} · ⇄ ${n.partners?.length ?? 0}`
          : n.verdictKind === 'exempt'
          ? `hop ${n.hop} · exempt`
          : `hop ${n.hop}`}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, top: CIRCLE_CENTER, transform: 'translate(50%, -50%)' }}
      />
    </div>
  )
}
