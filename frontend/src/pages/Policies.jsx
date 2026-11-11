import { useCallback, useEffect, useState } from 'react'
import { ArrowLeftRight, ArrowRight, CheckCircle2, ShieldCheck } from 'lucide-react'
import { useApi } from '../lib/useApi'
import { getPolicies } from '../lib/api'
import Card from '../components/Card'
import { LoadingState, ErrorState } from '../components/StatusStates'

// The real, versioned policy files (policy_engine/policies/P-*.json). A policy does two jobs:
//   1. defines the correction rules (what "compliant" means, what each correction restores);
//   2. says which corrections must be applied BEFORE which others (canonical orderings).
// Job 2 is what decides POLICY-ORDERED vs BLOCKED: when two corrections interact and the policy
// has no rule ordering them, the confluence checker cannot pick an order and the case is BLOCKED.

const human = (id) => id.replace(/_correction$/, '').replace(/_/g, ' ')

export default function Policies() {
  const api = useApi(useCallback(() => getPolicies(), []))
  const [selected, setSelected] = useState(null)
  const policies = api.data?.policies ?? []

  useEffect(() => {
    if (!selected && policies.length) {
      setSelected((policies.find((p) => p.policy_version === 'P-2026-Q3-001') ?? policies[0]).policy_version)
    }
  }, [policies, selected])

  if (api.loading) return <LoadingState label="Loading policies…" />
  if (api.error) return <ErrorState error={api.error} onRetry={api.refetch} />

  const policy = policies.find((p) => p.policy_version === selected)
  if (!policy) return null

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
      <div className="rs-cascade flex flex-col gap-3 lg:sticky lg:top-[calc(var(--nav-h)+4px)] lg:self-start">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[#667585]">
          {policies.length} policy versions
        </div>
        {policies.map((p) => (
          <PolicyListItem
            key={p.policy_version}
            policy={p}
            active={p.policy_version === selected}
            onClick={() => setSelected(p.policy_version)}
          />
        ))}
      </div>
      {/* the key replays the entrance each time another policy is opened */}
      <PolicyDetail key={policy.policy_version} policy={policy} />
    </div>
  )
}

function coverageTone(cov) {
  if (cov.ordered_pairs === 0) return { text: 'text-status-blocked', bg: 'bg-status-blockedBg', bar: 'bg-status-blocked', label: 'no ordering' }
  if (cov.unordered_pairs.length === 0) return { text: 'text-status-pass', bg: 'bg-status-passBg', bar: 'bg-status-pass', label: 'fully ordered' }
  return { text: 'text-status-ordered', bg: 'bg-status-orderedBg', bar: 'bg-amber-500', label: 'partly ordered' }
}

// How much of the policy's job is done: ordered pairs out of all pairs.
function CoverageBar({ cov, tone, className = '' }) {
  const share = cov.total_pairs ? (cov.ordered_pairs / cov.total_pairs) * 100 : 0
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-[#e8ecf0] ${className}`} role="img" aria-label={`${cov.ordered_pairs} of ${cov.total_pairs} correction pairs ordered`}>
      <div className={`rs-grow-x h-full rounded-full ${tone.bar}`} style={{ width: `${Math.max(share, share ? 3 : 0)}%` }} />
    </div>
  )
}

function PolicyListItem({ policy, active, onClick }) {
  const tone = coverageTone(policy.coverage)
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rs-lift rounded-2xl border p-4 text-left shadow-card ${
        active ? 'border-teal-500/70 bg-white shadow-[0_0_0_3px_rgba(42,157,143,0.12)]' : 'border-[#e3e7ec] bg-white hover:border-teal-400'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] font-bold text-[#101828]">{policy.policy_version}</span>
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.bg} ${tone.text}`}>
          {tone.label}
        </span>
      </div>
      <p className="mt-2 text-[12px] leading-snug text-[#5c6b7a]">{policy.description}</p>
      <CoverageBar cov={policy.coverage} tone={tone} className="mt-3" />
      <div className="mt-2 text-[11px] text-[#667585]">
        {policy.coverage.ordered_pairs} of {policy.coverage.total_pairs} correction pairs ordered
        {policy.used_by_cases !== null && ` · ${policy.used_by_cases} benchmark cases`}
      </div>
    </button>
  )
}

function PolicyDetail({ policy }) {
  const label = Object.fromEntries(policy.corrections.map((c) => [c.correction_id, c.activity]))
  const cov = policy.coverage
  const tone = coverageTone(cov)

  return (
    <div className="rs-stagger flex min-w-0 flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-[17px] font-extrabold tracking-[-0.02em] text-[#101828]">
              <ShieldCheck size={18} className="text-teal-500" />
              {policy.policy_version}
            </h2>
            <p className="mt-1.5 max-w-[640px] text-[13px] leading-relaxed text-[#5c6b7a]">{policy.description}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${tone.bg} ${tone.text}`}>
            {cov.ordered_pairs} / {cov.total_pairs} pairs ordered
          </span>
        </div>

        <div className="rs-cascade mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Effective from" value={policy.effective_from} />
          <Fact
            label="Discount stacking"
            value={`${policy.stacking.mode} · cap ${Math.round(Number(policy.stacking.max_total_discount) * 100)}%`}
          />
          <Fact label="Rounding" value={`${policy.rounding.decimals} decimals · ${policy.rounding.mode}`} />
          <Fact
            label="Used by"
            value={policy.used_by_cases === null ? '—' : `${policy.used_by_cases} benchmark cases`}
            hint={policy.used_by_cases === null ? 'no benchmark generated' : 'synthetic'}
          />
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 text-[14px] font-bold text-[#101828]">Canonical correction order</h3>
        <p className="mb-5 max-w-[80ch] text-[12.5px] leading-relaxed text-[#5c6b7a]">
          Rules saying which correction must be applied before another. The order the log already fixes always
          wins; these rules apply only where the log is silent.
        </p>
        {policy.canonical_orderings.length === 0 ? (
          <div className="rounded-2xl border border-status-blocked/25 bg-status-blockedBg px-4 py-3.5 text-[12.5px] leading-relaxed text-status-blocked">
            <span className="font-bold">This policy defines no ordering rules.</span> Whenever two corrections
            interact and the log does not fix their order, nothing decides which comes first, so the confluence
            checker marks the case BLOCKED and withholds attribution.
          </div>
        ) : (
          <ol className="rs-cascade relative flex flex-col">
            {policy.canonical_orderings.map((r, i) => (
              <li key={r.rule_id} className="relative flex gap-4 pb-5 last:pb-0">
                {/* the line that ties one rule to the next: the rules are a sequence */}
                {i < policy.canonical_orderings.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-[13px] top-7 w-px bg-[#dfe4e9]" />}
                <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-teal-500/40 bg-teal-500/10 text-[12px] font-bold text-teal-700">
                  {i + 1}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13.5px] font-bold text-[#101828]">
                    <span className="rounded-md bg-[#eef1f4] px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-[#5c6b7a]">
                      {r.rule_id}
                    </span>
                    {r.before ? (
                      <>
                        {label[r.before] ?? human(r.before)}
                        <span className="inline-flex items-center gap-1 font-normal text-[#667585]">before <ArrowRight size={12} /></span>
                        {label[r.after] ?? human(r.after)}
                      </>
                    ) : (
                      <>
                        Within {label[r.within] ?? human(r.within)}
                        <span className="font-normal text-[#667585]">·</span>
                        {String(r.by).replace(/_/g, ' ')}
                      </>
                    )}
                  </div>
                  <div className="mt-1 text-[12.5px] leading-relaxed text-[#5c6b7a]">{r.rationale}</div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 flex items-center gap-2 text-[14px] font-bold text-[#101828]">
          <ArrowLeftRight size={15} className="text-[#5c6b7a]" /> Pairs this policy does not order ({cov.unordered_pairs.length} of{' '}
          {cov.total_pairs})
        </h3>
        {cov.unordered_pairs.length === 0 ? (
          <p className="mt-2 flex items-center gap-2 text-[12.5px] font-semibold text-status-pass"><CheckCircle2 size={15} /> Every pair of corrections has a defined order.</p>
        ) : (
          <>
            <p className="mb-3 max-w-[80ch] text-[12.5px] leading-relaxed text-[#5c6b7a]">
              If two corrections in this list interact (their order changes the total) and the log does not fix their
              order, the case cannot be resolved and is BLOCKED. Pairs whose order does not change the total are
              unaffected.
            </p>
            <div className="flex max-h-[220px] flex-wrap gap-1.5 overflow-y-auto">
              {cov.unordered_pairs.map(([a, b]) => (
                <span
                  key={`${a}-${b}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#e2e6ea] bg-[#edf1f5] px-2.5 py-1 font-mono text-[11px] text-[#5c6b7a]"
                >
                  {human(a)} <ArrowLeftRight size={11} className="text-[#667585]" /> {human(b)}
                </span>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card className="!p-0 overflow-hidden">
        <h3 className="border-b border-[#e2e6ea] px-5 py-3.5 text-[14px] font-bold text-[#101828]">
          Corrections ({policy.corrections.length})
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead>
              <tr className="border-b border-[#e2e6ea] text-[11px] uppercase tracking-wide text-[#667585]">
                <th className="px-5 py-2.5 font-semibold">Correction</th>
                <th className="px-5 py-2.5 font-semibold">Fixes events of type</th>
                <th className="px-5 py-2.5 font-semibold">Cost</th>
                <th className="px-5 py-2.5 font-semibold">What it restores</th>
              </tr>
            </thead>
            <tbody className="rs-rows">
              {policy.corrections.map((c) => (
                <tr key={c.correction_id} className="border-b border-[#eef1f4] last:border-0 hover:bg-[#edf1f5]">
                  <td className="px-5 py-2.5 font-mono text-[11.5px] font-semibold text-[#101828]">{c.correction_id}</td>
                  <td className="px-5 py-2.5 text-[#5c6b7a]">{c.activity}</td>
                  <td className="px-5 py-2.5 text-[#5c6b7a]">{c.remediation_cost}</td>
                  <td className="px-5 py-2.5 text-[#5c6b7a]">{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function Fact({ label, value, hint }) {
  return (
    <div className="rs-tile">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#667585]">{label}</div>
      <div className="mt-1 text-[12.5px] font-bold text-[#101828]">{value}</div>
      {hint && <div className="mt-0.5 text-[10.5px] text-[#667585]">{hint}</div>}
    </div>
  )
}
