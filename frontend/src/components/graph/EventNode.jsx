import { Handle, Position } from 'reactflow'

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

export default function EventNode({ data }) {
  const n = data.node
  const isTarget = n.is_target
  const disconnected = !isTarget && n.connected_to_target === false

  const ring = isTarget
    ? { border: '#2a9d8f', bg: '#e6f6f4', text: '#0d4f47' }
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
          border: `2px solid ${ring.border}`,
          background: ring.bg,
          color: ring.text,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: 'JetBrains Mono, monospace',
          boxShadow: isTarget ? '0 0 0 3px rgba(42,157,143,0.15)' : 'none',
          flexShrink: 0,
        }}
        title={n.id}
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
        {isTarget ? '★ target' : `hop ${n.hop}`}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        style={{ opacity: 0, top: CIRCLE_CENTER, transform: 'translate(50%, -50%)' }}
      />
    </div>
  )
}
