import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`[ErrorBoundary${this.props.name ? `(${this.props.name})` : ''}]:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div style={{
          padding: '20px',
          background: 'var(--bg-card)',
          border: '1px solid var(--red)',
          borderRadius: '10px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontFamily: 'Space Grotesk, sans-serif',
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>⚠️</div>
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--red)', marginBottom: '4px' }}>
            {this.props.name ? `Error in ${this.props.name}` : 'Something went wrong'}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace' }}>
            {this.state.error?.message || 'Unknown error'}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
