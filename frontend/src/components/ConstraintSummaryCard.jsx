import { useState } from 'react'
import { GitBranch, Shuffle, ChevronDown, ChevronUp } from 'lucide-react'
import Card from './Card'

// Displays the REAL output of constraint_extraction.py
// (stage_2b_constraint_extraction in the /replay response) -- not mock
// data, so no <PreviewTag /> here, unlike the Month 4+ screens.
//
// Two lists, side by side:
//   - given_constraints: pairs the log itself already orders (shared
//     object, distinct timestamps). These get merged into policy.json
//     as hard rules -- Month 4's checker never needs to test them.
//   - permutable_pairs: everything else. These are exactly what Month
//     4's order-behaviour testing needs to run against.
//
// Deliberately NOT drawn as extra edges on the candidate graph: most
// permutable pairs are same-hop siblings with no discovery edge between
// them (see e977 -- 8 candidates, 28 permutable pairs among them), so
// overlaying all of them as graph edges would mean drawing a near-
// complete graph on top of the real traversal structure and would
// visually swamp it. A list scales to that combinatorial count; a
// graph overlay doesn't.
const PREVIEW_LIMIT = 6

export default function ConstraintSummaryCard({ constraintData, eventLookup = {} }) {
  const [showAllConstraints, setShowAllConstraints] = useState(false)
  const [showAllPairs, setShowAllPairs] = useState(false)

  if (!constraintData) return null

  const {
    given_constraints = [],
    permutable_pairs = [],
    num_constraints = given_constraints.length,
    num_permutable_pairs = permutable_pairs.length,
  } = constraintData

  const constraintsToShow = showAllConstraints
    ? given_constraints
    : given_constraints.slice(0, PREVIEW_LIMIT)
  const pairsToShow = showAllPairs ? permutable_pairs : permutable_pairs.slice(0, PREVIEW_LIMIT)

  const label = (id) => (eventLookup[id] ? `${id} · ${eventLookup[id]}` : id)

  return (
    <Card>
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[13px] font-bold text-[#101828]">Order Constraints</div>
        <div className="text-[11px] font-semibold text-[#8a97a3]">stage 2b · live</div>
      </div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-[#8a97a3]">
        Structural pre-check only, from the candidate graph itself &mdash; narrows what
        the confluence checker (stage 3) needs to test. A pair listed as permutable can
        still turn out order-sensitive there if its correction math doesn&apos;t commute.
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-teal-700">
            <GitBranch size={13} />
            Locked by process ({num_constraints})
          </div>
          {given_constraints.length === 0 ? (
            <p className="text-[11.5px] text-[#8a97a3]">
              No shared-object order-locks in this candidate set.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {constraintsToShow.map((c, i) => (
                <li
                  key={`${c.before}-${c.after}-${i}`}
                  className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2 font-mono text-[11.5px] font-semibold text-teal-800">
                    <span className="truncate">{label(c.before)}</span>
                    <span className="shrink-0 text-teal-500">&rarr;</span>
                    <span className="truncate text-right">{label(c.after)}</span>
                  </div>
                  <div className="mt-0.5 text-[10.5px] text-teal-600">
                    {c.shared_object ? `via shared object ${c.shared_object}` : 'target is this case\u2019s endpoint'}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {given_constraints.length > PREVIEW_LIMIT && (
            <ToggleMore
              show={showAllConstraints}
              onClick={() => setShowAllConstraints((v) => !v)}
              count={given_constraints.length}
            />
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold text-blue-700">
            <Shuffle size={13} />
            Order not fixed ({num_permutable_pairs})
          </div>
          {permutable_pairs.length === 0 ? (
            <p className="text-[11.5px] text-[#8a97a3]">
              Every pair is structurally ordered &mdash; nothing left to test for
              order-sensitivity.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {pairsToShow.map((p, i) => (
                <li
                  key={`${p.a}-${p.b}-${i}`}
                  className="flex items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1.5 font-mono text-[11.5px] font-semibold text-blue-800"
                >
                  <span className="truncate">{label(p.a)}</span>
                  <span className="shrink-0 text-blue-400">&hArr;</span>
                  <span className="truncate text-right">{label(p.b)}</span>
                </li>
              ))}
            </ul>
          )}
          {permutable_pairs.length > PREVIEW_LIMIT && (
            <ToggleMore
              show={showAllPairs}
              onClick={() => setShowAllPairs((v) => !v)}
              count={permutable_pairs.length}
            />
          )}
        </div>
      </div>
    </Card>
  )
}

function ToggleMore({ show, onClick, count }) {
  return (
    <button
      onClick={onClick}
      className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-[#5c6b7a] hover:text-[#101828]"
    >
      {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      {show ? 'Show fewer' : `Show all ${count}`}
    </button>
  )
}
