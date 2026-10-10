import { Handle, Position } from 'reactflow'
import { NODE_KIND_STYLE } from '../../lib/verdict'

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
export const NODE_WIDTH = 130
export const NODE_HEIGHT = 92
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

  const kind = !isTarget && n.verdictKind ? NODE_KIND_STYLE[n.verdictKind] : null

  const ring = isTarget
    ? { border: '#2a9d8f', bg: '#e6f6f4', text: '#0d4f47' }
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
            : `2px ${n.verdictKind === 'exempt' ? 'dashed' : 'solid'} ${ring.border}`,
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
        title={kind ? `${n.id} — ${kind.label}` : n.id}
      >
        {n.id}
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
      <div style={{ fontSize: 9.5, color: '#a3adb6', fontFamily: 'JetBrains Mono, monospace' }}>
        {isTarget
          ? '★ target'
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
