// Computes root-to-leaf "payment routes" through the real candidate graph
// -- nodes + the RAW discovery edges from the API ({source: parent_id,
// target: eid}, parent_id closer to the target), NOT the display-flipped
// edges the pages build for React Flow arrows. Call this on
// result.replay_graph directly, before any layout/flip step.
//
// A "leaf" is a candidate that never discovered anyone else (never
// appears as an edge's source) -- i.e. the farthest-upstream event on its
// own discovery chain. Its "route" is the chain from itself down to the
// target, walking parent pointers. A route's "value" is the sum of
// value_eur across every event on the chain (missing/non-monetary events
// count as 0) -- an honest sum given that only some activities (mainly
// invoices) carry a value_eur at all in this dataset; most of a route's
// total will usually come from the target itself.
export function computePaymentRoutes(graphView) {
  if (!graphView || !graphView.nodes?.length) {
    return { highest: null, lowest: null, routeCount: 0 }
  }

  const nodeById = {}
  graphView.nodes.forEach((n) => {
    nodeById[n.id] = n
  })

  const parentOf = {} // childId (eid) -> parentId (discoverer, closer to target)
  const hasChildren = new Set() // ids that appear as a parent at least once
  graphView.edges.forEach((e) => {
    parentOf[e.target] = e.source
    hasChildren.add(e.source)
  })

  const targetNode = graphView.nodes.find((n) => n.is_target)
  if (!targetNode) return { highest: null, lowest: null, routeCount: 0 }

  const leaves = graphView.nodes.filter((n) => !n.is_target && !hasChildren.has(n.id))
  if (leaves.length === 0) return { highest: null, lowest: null, routeCount: 0 }

  const routes = leaves.map((leaf) => {
    const chain = [leaf.id]
    let cur = leaf.id
    const guard = graphView.nodes.length + 1
    while (parentOf[cur] && cur !== targetNode.id && chain.length < guard) {
      cur = parentOf[cur]
      chain.push(cur)
    }
    // `chain` is built leaf -> ... -> target by construction (each step
    // walks toward the target via parentOf) -- that's already the
    // upstream-first reading that matches the rest of the app's graph
    // layout (leftmost = furthest hop, target = rightmost). No reversal.
    const eventIds = chain
    const total = eventIds.reduce((sum, id) => sum + (nodeById[id]?.value_eur || 0), 0)
    return { eventIds, total }
  })

  const highest = routes.reduce((a, b) => (b.total > a.total ? b : a))
  const lowest = routes.reduce((a, b) => (b.total < a.total ? b : a))

  return { highest, lowest, routeCount: routes.length }
}
