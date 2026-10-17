// src/lib/api.js
//
// Thin client for the REAL backend (src/api/app.py). Every function here
// maps 1:1 to an endpoint that actually runs your Month 1-2 pipeline
// against the live VBFA-derived OCEL 2.0 log and the synthetic benchmark -- nothing in this file is
// mocked. See src/data/mockData.js for the Month 3-5 screens that don't
// have a backend yet.

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
export function runReplay(caseId, { maxEvents = 8, minEvents = 3, maxHops = 3 } = {}, { force = false } = {}) {
  const params = new URLSearchParams({
    max_events: maxEvents,
    min_events: minEvents,
    max_hops: maxHops,
  })
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
export function getScenario(caseId, subset, order) {
  const p = new URLSearchParams({ subset: subset.join(',') })
  if (order && order.length) p.set('order', order.join(','))
  return request(`/api/cases/${encodeURIComponent(caseId)}/scenario?${p}`, { cached: true })
}

export { ApiError, API_BASE }
