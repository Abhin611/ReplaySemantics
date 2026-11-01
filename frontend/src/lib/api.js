// src/lib/api.js
//
// Thin client for the REAL backend (src/api/app.py). Every function here
// maps 1:1 to an endpoint that actually runs your Month 1-2 pipeline
// against the live VBFA-derived OCEL 2.0 log and the synthetic benchmark -- nothing in this file is
// mocked. See src/data/mockData.js for the Month 3-5 screens that don't
// have a backend yet.

import { limitsQuery } from './ledger.js'

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

// Every endpoint used here is deterministic for a running backend, so GET results are cached for the
// life of the page: switching tabs back to a page you already ran is instant, with no second run.
// A browser refresh clears the cache. Callers must treat cached results as read-only.
const cache = new Map()

// Forget every cached response (used by the pages' Refresh buttons, so the next load asks the backend again).
export function clearApiCache() {
  cache.clear()
}

function request(path, { cached = false, force = false } = {}) {
  if (cached && !force && cache.has(path)) return cache.get(path)
  const promise = fetchJson(path)
  if (cached) {
    cache.set(path, promise)
    promise.catch(() => cache.delete(path)) // never cache a failure
  }
  return promise
}

async function fetchJson(path) {
  let res
  try {
    res = await fetch(`${API_BASE}${path}`)
  } catch (err) {
    throw new ApiError(
      `Could not reach the backend at ${API_BASE}. Is "uvicorn api.app:app --reload" running?`,
      0
    )
  }
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.detail || detail
    } catch {
      /* ignore parse failure */
    }
    throw new ApiError(detail, res.status)
  }
  return res.json()
}

// GET /api/health
export function getHealth() {
  return request('/api/health')
}

// GET /api/dashboard
export function getDashboard() {
  return request('/api/dashboard')
}

// GET /api/cases
export function getCases() {
  return request('/api/cases', { cached: true })
}

// GET /api/cases/{case_id}/replay?max_events=&min_events=&max_hops=
export function runReplay(caseId, { maxEvents = null, minEvents = 3, maxHops = 3 } = {}, { force = false } = {}) {
  // max_events: null = no limit (the default); the limits apply to every case, benchmark or real SAP
  const params = new URLSearchParams({ min_events: minEvents, max_hops: maxHops })
  if (maxEvents !== null && maxEvents !== undefined && maxEvents !== '') params.set('max_events', maxEvents)
  return request(`/api/cases/${encodeURIComponent(caseId)}/replay?${params}`, { cached: true, force })
}

// GET /api/benchmark/verdicts -- real verdict per synthetic benchmark case (404 if no benchmark generated)
export function getBenchmarkVerdicts() {
  return request('/api/benchmark/verdicts', { cached: true })
}

// GET /api/policies -- the real versioned policy files (ordering rules, corrections, coverage)
export function getPolicies() {
  return request('/api/policies', { cached: true })
}

// GET /api/cases/{case_id}/scenario?subset=e1,e2[&order=e2,e1] -- "run this change": replay a set of
// corrections and compare the corrected case with the previous one (benchmark cases only)
export function getScenario(caseId, subset, order, limits) {
  const p = new URLSearchParams({ subset: subset.join(',') })
  if (order && order.length) p.set('order', order.join(','))
  if (limits) for (const [k, v] of limitsQuery(limits)) p.set(k, v)  // same candidate set as the console that opened it
  return request(`/api/cases/${encodeURIComponent(caseId)}/scenario?${p}`, { cached: true })
}

// GET /api/cases/{id}/analysis -- corrected-ledger view: nodes, loss split, policy summary, swappable pairs, class
export function getAnalysis(caseId, limits, { force = false } = {}) {
  return request(`/api/cases/${encodeURIComponent(caseId)}/analysis?${limitsQuery(limits)}`, { cached: true, force })
}

// GET /api/cases/{id}/pair?a=&b= -- both orders of one swappable pair, step by step
export function getPairRun(caseId, a, b, limits) {
  const p = limitsQuery(limits)
  p.set('a', a)
  p.set('b', b)
  return request(`/api/cases/${encodeURIComponent(caseId)}/pair?${p}`, { cached: true })
}

// GET /api/cases/{id}/hops -- reachable events per hop (public log only)
export function getHops(caseId) {
  return request(`/api/cases/${encodeURIComponent(caseId)}/hops`, { cached: true })
}

// POST /api/cases/{id}/change -- several input edits (one cascade) + a swap order, in a chosen sequence
export async function postChange(caseId, body, limits) {
  let res
  try {
    res = await fetch(`${API_BASE}/api/cases/${encodeURIComponent(caseId)}/change?${limitsQuery(limits)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError(`Could not reach the backend at ${API_BASE}.`, 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.detail || res.statusText, res.status)
  return data
}

export { ApiError, API_BASE }
