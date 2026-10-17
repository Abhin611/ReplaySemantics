import { createContext, useCallback, useContext, useReducer, useRef, useState } from 'react'

const SelectedCaseContext = createContext(null)

// The provider sits ABOVE the router's <Routes>, so it outlives every page. Besides the selected case it
// owns a small in-memory store that pages use (via usePersistentState) to keep their results and
// selections when you switch sidebar tabs: each page unmounts on navigation and would otherwise lose them.
// In-memory on purpose: a browser refresh starts clean, so nothing stale survives a backend restart.
export function SelectedCaseProvider({ children }) {
  const [selectedCaseId, setSelectedCaseId] = useState(null)
  const store = useRef(new Map())
  return (
    <SelectedCaseContext.Provider value={{ selectedCaseId, setSelectedCaseId, store: store.current }}>
      {children}
    </SelectedCaseContext.Provider>
  )
}

export function useSelectedCase() {
  const ctx = useContext(SelectedCaseContext)
  if (!ctx) throw new Error('useSelectedCase must be used within SelectedCaseProvider')
  return ctx
}

// Drop-in for useState whose value survives the page unmounting. `key` should be namespaced per page
// ('console:tab'). The setter accepts a value or an updater function, like useState's.
export function usePersistentState(key, initial) {
  const { store } = useSelectedCase()
  const [, bump] = useReducer((n) => n + 1, 0)
  if (!store.has(key)) store.set(key, typeof initial === 'function' ? initial() : initial)
  const setValue = useCallback(
    (next) => {
      const resolved = typeof next === 'function' ? next(store.get(key)) : next
      store.set(key, resolved)
      bump()
    },
    [store, key]
  )
  return [store.get(key), setValue]
}
