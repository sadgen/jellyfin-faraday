import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-black/90 text-gray-300 p-4 rounded-lg border border-red-500/20 text-center gap-3">
          <AlertTriangle size={32} className="text-amber-400" />
          <div className="text-sm font-semibold text-white">窗口渲染异常</div>
          <div className="text-xs text-gray-400 max-w-xs truncate font-mono">
            {this.state.error?.message || '未知错误'}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="px-3 py-1.5 bg-white/10 hover:bg-white/20 text-xs rounded-md transition flex items-center gap-1.5"
          >
            <RefreshCw size={12} />
            <span>重试</span>
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
