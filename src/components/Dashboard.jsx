import React from 'react'
import { useWeb3 } from '../context/Web3Context'

const QUICK_ACTIONS = [
  {
    id: 'arbitrage',
    title: 'Arbitrage Dashboard',
    desc: 'Real-time DEX price monitoring and cross-DEX arbitrage opportunity detection',
    icon: '📊',
    color: '#3B82F6',
  },
  {
    id: 'mev-bot',
    title: 'MEV Strategy Bot',
    desc: 'Advanced MEV protection via Flashbots, bundle building, and private mempools',
    icon: '🤖',
    color: '#8B5CF6',
  },
  {
    id: 'withdraw',
    title: 'Profit Withdraw',
    desc: 'Withdraw arbitrage profits and sweep tokens from FlashArbitrage contracts',
    icon: '💸',
    color: '#10B981',
  },
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
    id: 'send-polygon',
    title: 'Send Polygon Tokens',
    desc: 'Transfer tokens on Polygon (MATIC) with EIP-1559 fee estimation',
    icon: '🔶',
    color: '#8247E5',
  },
  {
    id: 'send-arbitrum',
    title: 'Send Arbitrum Tokens',
    desc: 'Transfer tokens on Arbitrum One with low-fee EIP-1559 estimation',
    icon: '🌀',
    color: '#2D374B',
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
    id: 'flashbots-bundle',
    title: 'Gasless Flashbots Bundle',
    desc: 'Submit token transfers with zero gas price via Flashbots bundle relay (experimental)',
    icon: '⚡',
    color: '#F59E0B',
  },
  {
    id: 'flash-send',
    title: 'Flash Send',
    desc: 'Quick hardcoded USDT send with Telegram notification (legacy)',
    icon: '⚙',
    color: '#EC4899',
  },
  {
    id: 'gasless-relay',
    title: 'Gasless Relay',
    desc: 'EIP-2771 meta-transactions with distributed relay node network — users sign, relayers pay gas',
    icon: '⛽',
    color: '#F97316',
  },
  {
    id: 'propagation',
    title: 'Propagation Network',
    desc: 'Private transaction broadcast to Flashbots, BloXroute, Eden, and custom RPC endpoints',
    icon: '📡',
    color: '#06B6D4',
  },
  {
    id: 'cross-chain',
    title: 'Cross-Chain Bridge',
    desc: 'Bridge tokens between chains via Stargate (LayerZero) and Across Protocol',
    icon: '🌉',
    color: '#22C55E',
  },
  {
    id: 'p2p-network',
    title: 'P2P Network',
    desc: 'Peer-to-peer transaction propagation with automatic discovery and geographic routing',
    icon: '🌐',
    color: '#A855F7',
  },
  {
    id: 'relay-nodes',
    title: 'Relay Nodes',
    desc: 'Master-slave relay node manager with health checks, failover, and balance sync',
    icon: '🗼',
    color: '#EC4899',
  },
  {
    id: 'predictor',
    title: 'ML Price Predictor',
    desc: 'LSTM neural network for token price prediction with historical data and confidence scoring',
    icon: '🧠',
    color: '#8B5CF6',
  },
]

const NETWORK_INFO = [
  { label: 'Chains', value: '4 chains', detail: 'BSC, Ethereum, Polygon, Arbitrum' },
  { label: 'RPCs', value: '14 endpoints', detail: 'With fallback for each chain' },
  { label: 'Supported Tokens', value: '48 tokens', detail: 'USDT, USDC, DAI, WETH, WBTC, etc.' },
  { label: 'Chain IDs', value: '56 • 1 • 137 • 42161', detail: 'All mainnet' },
]

function WalletStatus() {
  const { isConnected, walletAddress, walletType, chainId, chainName, connectWallet, disconnect } = useWeb3()

  if (!isConnected || !walletAddress) {
    return (
      <div className="wallet-status-card disconnected">
        <div className="ws-header">
          <span className="ws-icon">👛</span>
          <div>
            <strong>No Wallet Connected</strong>
            <p>Connect a wallet to sign transactions without entering private keys</p>
          </div>
        </div>
        <div className="ws-actions">
          <button className="btn btn-primary" onClick={() => connectWallet('metamask')} style={{ fontSize: 12, padding: '8px 16px' }}>
            🦊 Connect MetaMask
          </button>
          <button className="btn btn-primary" onClick={() => connectWallet('walletconnect')} style={{ fontSize: 12, padding: '8px 16px', background: 'var(--accent-purple)' }}>
            🔗 WalletConnect
          </button>
        </div>
      </div>
    )
  }

  const formatAddr = (addr) => `${addr.slice(0, 8)}...${addr.slice(-6)}`
  return (
    <div className="wallet-status-card connected">
      <div className="ws-header">
        <span className="ws-icon" style={{ fontSize: 24 }}>{walletType === 'metamask' ? '🦊' : '🔗'}</span>
        <div>
          <strong>Wallet Connected</strong>
          <p className="ws-address">{formatAddr(walletAddress)}</p>
        </div>
        <span className="ws-badge">{chainName}</span>
      </div>
      <div className="ws-details">
        <span className="ws-detail"><strong>Type:</strong> {walletType === 'metamask' ? 'MetaMask' : 'WalletConnect'}</span>
        <span className="ws-detail"><strong>Chain ID:</strong> {chainId}</span>
      </div>
      <div className="ws-actions">
        <button className="btn btn-danger" onClick={disconnect} style={{ fontSize: 12, padding: '6px 14px' }}>
          Disconnect
        </button>
      </div>
    </div>
  )
}

export default function Dashboard({ onNavigate }) {
  return (
    <div className="dashboard">
      <div className="dashboard-hero">
        <div className="hero-badge">Multi-Chain Suite</div>
        <h1 className="hero-title">Token Transfer Toolkit</h1>
        <p className="hero-desc">
          A comprehensive multi-chain token transfer interface supporting <strong>BSC</strong>, <strong>Ethereum</strong>,{' '}
          <strong>Polygon</strong>, and <strong>Arbitrum</strong> with Flashbots MEV protection, auto-bot scheduling, mempool monitoring, and more.
        </p>
      </div>

      <section className="section">
        <h2 className="section-title">Wallet</h2>
        <WalletStatus />
      </section>

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
            <span className="sec-icon">🦊</span>
            <div>
              <strong>Wallet Support Added</strong>
              <p>Use MetaMask or WalletConnect to sign transactions without entering private keys.</p>
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
