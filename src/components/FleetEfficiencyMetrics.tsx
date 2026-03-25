import type { Agent, SubAgent } from '../types';
import { ErrorBoundary } from './ErrorBoundary';

interface Props {
  agents: Agent[];
  subAgents: SubAgent[];
}

export default function FleetEfficiencyMetrics({ subAgents }: Props) {
  if (subAgents.length === 0) return null;
  return (
    <ErrorBoundary name="FleetEfficiencyMetrics">
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>
        🚧 Fleet Efficiency Metrics — work in progress
      </div>
    </ErrorBoundary>
  );
}
