import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    console.error('ErrorBoundary caught:', error)
    this.lastError = error
  }

  private lastError: Error | null = null

  render() {
    if (this.state.hasError) {
      const detail = this.lastError?.message
      return this.props.fallback ?? (
        <div style={{ padding: 12, color: '#888', fontSize: 13 }}>
          Something went wrong rendering this component.
          {detail ? <div style={{ marginTop: 8, fontSize: 12, opacity: 0.85 }}>{detail}</div> : null}
        </div>
      )
    }
    return this.props.children
  }
}
