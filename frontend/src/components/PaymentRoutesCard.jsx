import { TrendingUp, TrendingDown } from 'lucide-react'
import Card from './Card'
import { formatEur } from '../lib/format'

// Shows the two extremes among the real root-to-target chains in the
// candidate graph -- highest and lowest summed value_eur -- as an ordered
// event-id list, same plain-text-list treatment as the permutable pairs
// in ConstraintSummaryCard rather than an extra graph overlay.
//
// Clicking a route highlights its events (and the direct edges between
// consecutive events in the chain) on the graph -- same mechanism as
// clicking a line in ConstraintExplanationList, unified in the page's
// layoutGraph(). `selectedRouteKey` is 'highest' | 'lowest' | null,
// tracked by key rather than by comparing arrays since routes.highest/
// routes.lowest are stable references for a given result.
export default function PaymentRoutesCard({ routes, eventLookup = {}, selectedRouteKey, onSelectRoute }) {
  if (!routes || !routes.highest) return null

  const label = (id) => (eventLookup[id] ? `${id} · ${eventLookup[id]}` : id)
  const sameRoute = routes.lowest === routes.highest

  const select = (key, route) => onSelectRoute?.(selectedRouteKey === key ? null : key, route)

  return (
    <Card>
      <div className="mb-1 text-[13px] font-bold text-[#101828]">Payment Routes</div>
      <p className="mb-3 text-[11.5px] leading-relaxed text-[#8a97a3]">
        Every root-to-target chain in this candidate graph, ranked by summed value_eur across
        its events ({routes.routeCount} route{routes.routeCount === 1 ? '' : 's'} in this set).
        Click a route to highlight it on the graph.
      </p>
      <div className="flex flex-col gap-4">
        <RouteRow
          route={routes.highest}
          icon={TrendingUp}
          tone="text-status-pass"
          title="Highest-value route"
          label={label}
          selected={selectedRouteKey === 'highest'}
          onClick={() => select('highest', routes.highest)}
        />
        {!sameRoute && (
          <RouteRow
            route={routes.lowest}
            icon={TrendingDown}
            tone="text-status-blocked"
            title="Lowest-value route"
            label={label}
            selected={selectedRouteKey === 'lowest'}
            onClick={() => select('lowest', routes.lowest)}
          />
        )}
      </div>
    </Card>
  )
}

function RouteRow({ route, icon: Icon, tone, title, label, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-lg border px-2.5 py-2 text-left transition-colors ${
        selected
          ? 'border-amber-400 bg-amber-50'
          : 'border-[#e2e6ea] bg-white hover:border-teal-300 hover:bg-teal-50'
      }`}
    >
      <div className={`mb-2 flex items-center justify-between text-[12px] font-semibold ${tone}`}>
        <span className="flex items-center gap-1.5">
          <Icon size={13} />
          {title}
        </span>
        <span>{formatEur(route.total)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {route.eventIds.map((id, i) => (
          <span key={id} className="flex items-center gap-1.5">
            <span className="rounded-md border border-[#e2e6ea] bg-[#f8f9fb] px-2 py-1 font-mono font-semibold text-[#101828]">
              {label(id)}
            </span>
            {i < route.eventIds.length - 1 && <span className="text-[#c2cad2]">&rarr;</span>}
          </span>
        ))}
      </div>
    </button>
  )
}
