import { createContext, useContext, useState } from 'react'

const SelectedCaseContext = createContext(null)

export function SelectedCaseProvider({ children }) {
  const [selectedCaseId, setSelectedCaseId] = useState(null)
  return (
    <SelectedCaseContext.Provider value={{ selectedCaseId, setSelectedCaseId }}>
      {children}
    </SelectedCaseContext.Provider>
  )
}

export function useSelectedCase() {
  const ctx = useContext(SelectedCaseContext)
  if (!ctx) throw new Error('useSelectedCase must be used within SelectedCaseProvider')
  return ctx
}
