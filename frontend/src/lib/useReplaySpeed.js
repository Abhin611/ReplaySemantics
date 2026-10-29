import { usePersistentState } from './SelectedCaseContext'

// One playback speed for every animated replay in the app (Replay Console, Corrected Scenario, ...).
// "1x" is the 2-second pause between stages; "Instant" skips the animation and shows everything at once.
export const SPEEDS = [
  { key: '0.5x', label: '0.5×', ms: 4000 },
  { key: '1x', label: '1×', ms: 2000 },
  { key: '2x', label: '2×', ms: 1000 },
  { key: 'instant', label: 'Instant', ms: 0 },
]

export function useReplaySpeed() {
  const [speedKey, setSpeedKey] = usePersistentState('ui:replaySpeed', '1x')
  const speed = SPEEDS.find((s) => s.key === speedKey) || SPEEDS[1]
  return { speed, delay: speed.ms, speedKey, setSpeedKey }
}
