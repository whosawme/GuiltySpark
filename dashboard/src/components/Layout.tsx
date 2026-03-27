import { NavLink } from 'react-router-dom';
import type { WsStatus } from '../hooks/useWebSocket.ts';

interface Props {
  children: React.ReactNode;
  wsStatus: WsStatus;
  pendingCount: number;
}

const NAV = [
  { to: '/monitor',  label: 'Live Monitor',      icon: '⬤' },
  { to: '/map',      label: 'Substitution Map',  icon: '⇄' },
  { to: '/audit',    label: 'Audit Log',          icon: '≡' },
  { to: '/config',   label: 'Configuration',      icon: '⚙' },
  { to: '/sessions', label: 'Sessions',           icon: '◻' },
];

const STATUS_COLOR: Record<WsStatus, string> = {
  connected:    'bg-gs-green',
  connecting:   'bg-gs-yellow',
  disconnected: 'bg-gs-red',
  error:        'bg-gs-red',
};

const STATUS_LABEL: Record<WsStatus, string> = {
  connected:    'live',
  connecting:   'connecting…',
  disconnected: 'reconnecting…',
  error:        'error',
};

export default function Layout({ children, wsStatus, pendingCount }: Props) {
  return (
    <div className="flex h-screen bg-gs-bg overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-gs-surface border-r border-gs-border flex flex-col">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-gs-border">
          <div className="flex items-center gap-2">
            <span className="text-gs-accent text-lg">⚡</span>
            <span className="text-gs-heading font-semibold text-sm tracking-wide">GuiltySpark</span>
          </div>
          <div className="text-xs text-gs-text mt-0.5 opacity-60">privacy layer</div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-gs-accent/10 text-gs-accent'
                    : 'text-gs-text hover:bg-white/5 hover:text-gs-heading'
                }`
              }
            >
              <span className="text-xs opacity-70">{icon}</span>
              <span>{label}</span>
              {to === '/monitor' && pendingCount > 0 && (
                <span className="ml-auto bg-gs-yellow text-black text-xs font-semibold px-1.5 py-0.5 rounded-full">
                  {pendingCount}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* WS status */}
        <div className="px-4 py-3 border-t border-gs-border flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[wsStatus]} ${wsStatus === 'connected' ? 'pulse-dot' : ''}`} />
          <span className="text-xs text-gs-text">{STATUS_LABEL[wsStatus]}</span>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}
