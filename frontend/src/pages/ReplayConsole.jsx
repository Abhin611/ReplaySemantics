import ReplayFlow from '../components/ReplayFlow'

// Replay Console: pick a case and press Run Replay. Everything happens in <ReplayFlow>: the OCEL table turns into the graph,
// the stages run along one line, the pairs and the replay appear below it, and the verdict tabs close the run.
export default function ReplayConsole() {
  return <ReplayFlow />
}
