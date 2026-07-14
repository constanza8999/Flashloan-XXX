import React from 'react'

const QUICK_ACTIONS = [
  {
    id: 'send-bsc',
    title: 'Send BSC Tokens',
    desc: 'Transfer BEP20 tokens on Binance Smart Chain with EIP-1559 fee estimation',
    icon: '⛓',
    color: '#F0B90B',
  },
  {
    id: 'send-eth',
    title: 'Send ETH via Flashbots',
    desc: 'Send ERC20 tokens on Ethereum mainnet with MEV protection via Flashbots Protect',
    icon: '🛡',
    color: '#627EEA',
  },
  {
    id: 'token-info',
    title: 'Token Info Lookup',
    desc: 'Query token decimals, symbol, and wallet balance from any contract address',
    icon: '◎',
    color: '#00D4AA',
  },
  {
    id: 'auto-bot',
    title: 'Auto-Send Bot',
    desc: 'Schedule automatic token transfers at regular intervals with full control',
    icon: '⚡',
    color: '#FF6B35',
  },
  {
    id: 'mempool',
    title: 'Mempool Watcher',
    desc: 'Monitor pending transactions on BSC or Ethereum in real-time',
    icon: '👁',
    color: '#A855F7',
  },
  {
    id: 'flash-send',
    title: 'Flash Send',
    desc: 'Quick hardcoded USDT send with Telegram notification (legacy)',
    icon: '⚙',
    color: '#EC4899',
  },
]

const NETWORK_INFO = [
  { label: 'BSC RPCs', value: '5 endpoints', detail: 'Including publicnode.com' },
  { label: 'ETH RPCs', value: '3 endpoints', detail: 'Including Flashbots Protect' },
  { label: 'Supported Tokens', value: '14 BSC • 10 ETH', detail: 'USDT, USDC, DAI, WBNB, WBTC, etc.' },
  { label: 'Chain IDs', value: 'BSC: 56 • ETH: 1', detail: 'Mainnet only' },
]

export default function Dashboard({ onNavigate }) {
  return (
    <div className="dashboard">
      <div className="dashboard-hero">
        <div className="hero-badge">Multi-Chain Suite</div>
        <h1 className="hero-title">Token Transfer Toolkit</h1>
        <p className="hero-desc">
          A comprehensive multi-chain token transfer interface supporting <strong>Binance Smart Chain</strong>{' '}
          and <strong>Ethereum</strong> with Flashbots MEV protection, auto-bot scheduling, mempool monitoring, and more.
        </p>
      </div>

      <div className="network-strip">
        {NETWORK_INFO.map((item, i) => (
          <div key={i} className="network-chip">
            <span className="chip-label">{item.label}</span>
            <span className="chip-value">{item.value}</span>
            <span className="chip-detail">{item.detail}</span>
          </div>
        ))}
      </div>

      <section className="section">
        <h2 className="section-title">Quick Actions</h2>
        <div className="quick-actions-grid">
          {QUICK_ACTIONS.map(action => (
            <button
              key={action.id}
              className="quick-action-card"
              onClick={() => onNavigate(action.id)}
              style={{ '--accent': action.color }}
            >
              <span className="qac-icon">{action.icon}</span>
              <div className="qac-body">
                <h3 className="qac-title">{action.title}</h3>
                <p className="qac-desc">{action.desc}</p>
              </div>
              <span className="qac-arrow">→</span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Security Notes</h2>
        <div className="security-cards">
          <div className="security-card warning">
            <span className="sec-icon">⚠️</span>
            <div>
              <strong>Never expose private keys</strong>
              <p>Keys are only used in-browser for signing. They are never sent to any server.</p>
            </div>
          </div>
          <div className="security-card info">
            <span className="sec-icon">ℹ️</span>
            <div>
              <strong>Flashbots Protect</strong>
              <p>ETH sends are routed through Flashbots Protect for MEV protection. Real gas fees apply.</p>
            </div>
          </div>
          <div className="security-card info">
            <span className="sec-icon">🔢</span>
            <div>
              <strong>Decimal Awareness</strong>
              <p>USDT is 6 decimals on ETH, 18 decimals on BSC. The app auto-detects and validates this.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
