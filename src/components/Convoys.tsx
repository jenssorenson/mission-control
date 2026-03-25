import { ErrorBoundary } from './ErrorBoundary';

export default function Convoys() {
  return (
    <ErrorBoundary name="Convoys">
      <div style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '12px' }}>
        🚧 Convoys — work in progress
      </div>
    </ErrorBoundary>
  );
}
