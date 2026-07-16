import React, { useState, useEffect, useCallback, useMemo } from 'react'
import Dashboard from './components/Dashboard'
import SendBSC from './components/SendBSC'
import SendETH from './components/SendETH'
import SendPolygon from './components/SendPolygon'
import SendArbitrum from './components/SendArbitrum'
import TokenInfo from './components/TokenInfo'
import AutoBot from './components/AutoBot'
import MempoolWatcher from './components/MempoolWatcher'
import FlashSend from './components/FlashSend'
import SendFlashbotsBundle from './components/SendFlashbotsBundle'
import BalanceChecker from './components/BalanceChecker'
import TransactionHistory from './components/TransactionHistory'
import TelegramSettings from './components/TelegramSettings'
import WalletConnectButton from './components/WalletConnectButton'
import ArbitrageDashboard from './components/ArbitrageDashboard'
import MevBot from './components/MevBot'
import ProfitWithdraw from './components/ProfitWithdraw'
import GaslessRelay from './components/GaslessRelay'
import PropagationNetwork from './components/PropagationNetwork'
import CrossChainBridge from './components/CrossChainBridge'
import P2PNetwork from './components/P2PNetwork'
import RelayNodes from './components/RelayNodes'
import PricePredictor from './components/PricePredictor'
import { Web3Provider } from './context/Web3Context'
import { SubscriptionProvider, useSubscription } from './context/SubscriptionContext'
import AuthPage from './components/AuthPage'
import ProtectedFeature from './components/ProtectedFeature'
import ContractDeployer from './components/ContractDeployer'
import UniversalSend from './components/UniversalSend'
import QuantumEnginePanel from './components/QuantumEnginePanel'
import SubscriptionPlans from './components/SubscriptionPlans'
import AdminPanel from './components/AdminPanel'
import PowFaucet from './components/PowFaucet'
import { ToastProvider } from './components/Toast'
import ChatBot from './components/ChatBot'

// ─── Navigation structure with categories ──────────────────────────────

const NAV_CATEGORIES = [
  {
    id: 'main',
    label: 'Main',
    tabs: [
      { id: 'dashboard', label: 'Dashboard', icon: '◈', desc: 'Overview & quick actions', badge: null },
      { id: 'auth', label: 'Sign In', icon: '🔐', desc: 'Login or create an account', badge: null },
    ],
  },
  {
    id: 'trading',
    label: 'Trading & Arbitrage',
    icon: '📈',
    tabs: [
      { id: 'arbitrage', label: 'Arbitrage', icon: '📊', desc: 'DEX price monitoring & cross-DEX arbitrage', badge: 'HOT' },
      { id: 'mev-bot', label: 'MEV Bot', icon: '🤖', desc: 'Flashbots bundles & private mempool protection', badge: null },
      { id: 'auto-bot', label: 'Auto-Bot', icon: '⚡', desc: 'Automated transfer sweeper', badge: null },
      { id: 'predictor', label: 'AI Predictor', icon: '🧠', desc: 'Price predictions with machine learning', badge: 'BETA' },
    ],
  },
  {
    id: 'transfers',
    label: 'Transfers',
    icon: '💸',
    tabs: [
      { id: 'send-bsc', label: 'Send BSC', icon: '⛓', desc: 'BEP-20 tokens on BNB Chain', badge: null },
      { id: 'send-eth', label: 'Send ETH FB', icon: '🛡', desc: 'ERC-20 via Flashbots Protect', badge: 'PRIVATE' },
      { id: 'send-polygon', label: 'Send Polygon', icon: '🔶', desc: 'Polygon MATIC & tokens', badge: null },
      { id: 'send-arbitrum', label: 'Send Arbitrum', icon: '🌀', desc: 'Arbitrum ETH & tokens', badge: null },
      { id: 'universal-send', label: 'Universal Send', icon: '📤', desc: 'Send from any source to any address', badge: 'NEW' },
      { id: 'flash-send', label: 'Flash Send', icon: '⚙', desc: 'Low-level raw transactions', badge: 'ADV' },
      { id: 'flashbots-bundle', label: 'Gasless Bundle', icon: '⚡', desc: 'Flashbots bundle transactions', badge: null },
    ],
  },
  {
    id: 'network',
    label: 'Network',
    icon: '🌐',
    tabs: [
      { id: 'propagation', label: 'Propagation', icon: '📡', desc: 'Multi-endpoint tx propagation', badge: null },
      { id: 'cross-chain', label: 'Cross-Chain', icon: '🌉', desc: 'Bridge assets across networks', badge: 'NEW' },
      { id: 'p2p-network', label: 'P2P Network', icon: '🌐', desc: 'Peer-to-peer tx relay network', badge: null },
      { id: 'relay-nodes', label: 'Relay Nodes', icon: '🗼', desc: 'Manage relay node connections', badge: null },
      { id: 'gasless-relay', label: 'Gasless Relay', icon: '⛽', desc: 'Meta-transactions & gas sponsorship', badge: null },
      { id: 'quantum-engine', label: 'Quantum Engine', icon: '⚛', desc: 'C++ quantum entropy, MEV shield & gasless CLI', badge: 'NEW' },
      { id: 'pow-faucet', label: 'PoW Faucet', icon: '⛏️', desc: 'Mine ETH with proof-of-work via relay nodes', badge: 'NEW' },
    ],
  },
  {
    id: 'wallet',
    label: 'Wallet',
    icon: '👛',
    tabs: [
      { id: 'balances', label: 'Balances', icon: '💰', desc: 'Multi-chain balance checker', badge: null },
      { id: 'token-info', label: 'Token Info', icon: '◎', desc: 'Token details & metadata', badge: null },
      { id: 'withdraw', label: 'Withdraw', icon: '💸', desc: 'Profit withdrawal from contracts', badge: null },
      { id: 'telegram', label: 'Telegram', icon: '📱', desc: 'Telegram bot notifications', badge: null },
    ],
  },
  {
    id: 'monitor',
    label: 'Monitor',
    icon: '👁',
    tabs: [
      { id: 'mempool', label: 'Mempool Watch', icon: '👁', desc: 'Live pending tx monitor', badge: null },
      { id: 'history', label: 'History', icon: '📜', desc: 'Transaction history log', badge: null },
    ],
  },
  {
    id: 'dev',
    label: 'Developer',
    icon: '🔧',
    tabs: [
      { id: 'subscription', label: 'Subscription', icon: '💳', desc: 'Plans & license key activation', badge: null },
      { id: 'admin-panel', label: 'Admin Panel', icon: '🛡️', desc: 'User & subscription management', badge: 'ADMIN' },
      { id: 'contract-deployer', label: 'Contract Deployer', icon: '📦', desc: 'Deploy FlashArbitrage contracts', badge: 'DEV' },
    ],
  },
]

// Badge → CSS class map
const BADGE_CLASSES = {
  NEW: 'badge-new',
  HOT: 'badge-hot',
  BETA: 'badge-beta',
  ADV: 'badge-adv',
  PRIVATE: 'badge-private',
  ADMIN: 'badge-admin',
  DEV: 'badge-dev',
}

const THEME_STORAGE_KEY = 'tokentoolkit_theme'

function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
    return 'dark'
  })

  const setTheme = useCallback((t) => {
    setThemeState(t)
    localStorage.setItem(THEME_STORAGE_KEY, t)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem(THEME_STORAGE_KEY, next)
      return next
    })
  }, [])

  useEffect(() => {
    const body = document.body
    if (theme === 'light') {
      body.classList.add('light-theme')
    } else {
      body.classList.remove('light-theme')
    }
  }, [theme])

  useEffect(() => {
    if (!window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const handler = (e) => {
      const stored = localStorage.getItem(THEME_STORAGE_KEY)
      if (!stored) {
        setTheme(e.matches ? 'light' : 'dark')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [setTheme])

  useEffect(() => {
    const body = document.body
    body.classList.add('preload')
    const raf = requestAnimationFrame(() => {
      body.classList.remove('preload')
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' }
}

const TAB_RENDER_MAP = {
  dashboard:        (p) => <Dashboard onNavigate={p.setActiveTab} />,
  // ─── Pro features ─────────────────────────────────────────
  arbitrage:        (p) => <ProtectedFeature featureId='arbitrage' onNavigate={p.setActiveTab}><ArbitrageDashboard /></ProtectedFeature>,
  'mev-bot':        (p) => <ProtectedFeature featureId='mev-bot' onNavigate={p.setActiveTab}><MevBot /></ProtectedFeature>,
  'send-polygon':   (p) => <ProtectedFeature featureId='send-polygon' onNavigate={p.setActiveTab}><SendPolygon /></ProtectedFeature>,
  'send-arbitrum':  (p) => <ProtectedFeature featureId='send-arbitrum' onNavigate={p.setActiveTab}><SendArbitrum /></ProtectedFeature>,
  withdraw:         (p) => <ProtectedFeature featureId='withdraw' onNavigate={p.setActiveTab}><ProfitWithdraw /></ProtectedFeature>,
  telegram:         (p) => <ProtectedFeature featureId='telegram' onNavigate={p.setActiveTab}><TelegramSettings /></ProtectedFeature>,
  'flashbots-bundle': (p) => <ProtectedFeature featureId='flashbots-bundle' onNavigate={p.setActiveTab}><SendFlashbotsBundle /></ProtectedFeature>,
  'flash-send':     (p) => <ProtectedFeature featureId='flash-send' onNavigate={p.setActiveTab}><FlashSend /></ProtectedFeature>,
  'gasless-relay':  (p) => <ProtectedFeature featureId='gasless-relay' onNavigate={p.setActiveTab}><GaslessRelay /></ProtectedFeature>,
  // ─── Enterprise features ───────────────────────────────────
  'auto-bot':       (p) => <ProtectedFeature featureId='auto-bot' onNavigate={p.setActiveTab}><AutoBot /></ProtectedFeature>,
  mempool:          (p) => <ProtectedFeature featureId='mempool' onNavigate={p.setActiveTab}><MempoolWatcher /></ProtectedFeature>,
  propagation:      (p) => <ProtectedFeature featureId='propagation' onNavigate={p.setActiveTab}><PropagationNetwork /></ProtectedFeature>,
  'cross-chain':    (p) => <ProtectedFeature featureId='cross-chain' onNavigate={p.setActiveTab}><CrossChainBridge /></ProtectedFeature>,
  'p2p-network':    (p) => <ProtectedFeature featureId='p2p-network' onNavigate={p.setActiveTab}><P2PNetwork /></ProtectedFeature>,
  'relay-nodes':    (p) => <ProtectedFeature featureId='relay-nodes' onNavigate={p.setActiveTab}><RelayNodes /></ProtectedFeature>,
  predictor:        (p) => <ProtectedFeature featureId='predictor' onNavigate={p.setActiveTab}><PricePredictor /></ProtectedFeature>,
  // ─── Free / unrestricted features ──────────────────────────
  balances:         () => <BalanceChecker />,
  'send-bsc':       () => <SendBSC />,
  'send-eth':       () => <SendETH />,
  'universal-send': (p) => <ProtectedFeature featureId='universal-send' onNavigate={p.setActiveTab}><UniversalSend /></ProtectedFeature>,
  'quantum-engine': (p) => <ProtectedFeature featureId='quantum-engine' onNavigate={p.setActiveTab}><QuantumEnginePanel /></ProtectedFeature>,
  'pow-faucet': (p) => <ProtectedFeature featureId='pow-faucet' onNavigate={p.setActiveTab}><PowFaucet /></ProtectedFeature>,
  'token-info':     () => <TokenInfo />,
  history:          () => <TransactionHistory />,
  subscription:     (p) => <SubscriptionPlans onNavigate={p.setActiveTab} />,
  'contract-deployer': () => <ContractDeployer />,
  'admin-panel':    () => <AdminPanel />,
  auth:             (p) => <AuthPage onNavigate={p.setActiveTab} />,
}

function AppContent() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [navSearch, setNavSearch] = useState('')
  const { theme, toggleTheme } = useTheme()
  const { user, isLoggedIn, isAdmin, userTier, logout } = useSubscription()
  const isDark = theme === 'dark'

  // Compute which categories/tabs to show based on search
  const filteredNav = useMemo(() => {
    if (!navSearch.trim()) return NAV_CATEGORIES

    const q = navSearch.toLowerCase().trim()
    return NAV_CATEGORIES
      .map(cat => ({
        ...cat,
        tabs: cat.tabs.filter(t =>
          t.label.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (t.desc && t.desc.toLowerCase().includes(q))
        ),
      }))
      .filter(cat => cat.tabs.length > 0)
  }, [navSearch])

  const renderTab = (tabId) => {
    const renderFn = TAB_RENDER_MAP[tabId]
    return renderFn ? renderFn({ setActiveTab }) : <Dashboard onNavigate={setActiveTab} />
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-content">
          <div className="header-left">
            <div className="logo">
              <span className="logo-icon">🔷</span>
              <div className="logo-text">
                <span className="logo-title">Token Toolkit</span>
                <span className="logo-sub">Multi-Chain Transfer Suite</span>
              </div>
            </div>
          </div>
          <div className="header-right">
            <button
              className="theme-toggle-btn"
              onClick={toggleTheme}
              aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`}
              title={`Switch to ${isDark ? 'light' : 'dark'} mode`}
            >
              <span className="theme-toggle-icon">
                {isDark ? '☀️' : '🌙'}
              </span>
              <span className="theme-toggle-label">
                {isDark ? 'Light' : 'Dark'}
              </span>
            </button>
            {/* Auth / Subscription indicator */}
            {isLoggedIn ? (
              <div className="header-auth-badge">
                <span className={`ha-tier-dot tier-${userTier}`} />
                <span className="ha-email">{user?.email?.split('@')[0]}</span>
                {isAdmin && <span className="ha-admin-badge">ADMIN</span>}
              </div>
            ) : (
              <button className="header-auth-btn" onClick={() => { setActiveTab('auth'); setMobileMenuOpen(false) }}>
                🔐 Sign In
              </button>
            )}
            <WalletConnectButton />
          </div>
          <button
            className="mobile-menu-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle menu"
          >
            <span className={`hamburger ${mobileMenuOpen ? 'open' : ''}`}>
              <span></span>
              <span></span>
              <span></span>
            </span>
          </button>
        </div>
      </header>      <div className="app-layout">
        <nav className={`nav-tabs ${mobileMenuOpen ? 'mobile-open' : ''}`}>
          {/* Search input */}
          <div className="nav-search-wrapper">
            <span className="nav-search-icon">🔍</span>
            <input
              type="text"
              className="nav-search-input"
              placeholder="Search features..."
              value={navSearch}
              onChange={e => setNavSearch(e.target.value)}
            />
            {navSearch && (
              <button className="nav-search-clear" onClick={() => setNavSearch('')}>
                ✕
              </button>
            )}
          </div>

          {/* Category groups */}
          {filteredNav.map(cat => (
            <div key={cat.id} className="nav-category">
              <div className="nav-category-header">
                <span className="nav-category-icon">{cat.icon}</span>
                <span className="nav-category-label">{cat.label}</span>
                <span className="nav-category-count">{cat.tabs.length}</span>
              </div>
              {cat.tabs.map(tab => {
                const badgeClass = BADGE_CLASSES[tab.badge] || ''
                return (
                  <button
                    key={tab.id}
                    className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => { setActiveTab(tab.id); setMobileMenuOpen(false); setNavSearch('') }}
                    title={tab.desc}
                  >
                    <span className="tab-icon">{tab.icon}</span>
                    <span className="tab-content">
                      <span className="tab-label">{tab.label}</span>
                      <span className="tab-desc">{tab.desc}</span>
                    </span>
                    {tab.badge && (
                      <span className={`tab-badge ${badgeClass}`}>
                        {tab.badge}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <main className="main-content">
          {renderTab(activeTab)}
        </main>
      </div>

      <footer className="app-footer">
        <span>Multi-Chain Token Toolkit v1.0</span>
        <span className="footer-divider">•</span>
        <span>Powered by ethers.js & React</span>
        <span className="footer-divider">•</span>
        <span>{isDark ? '🌙' : '☀️'} {isDark ? 'Dark' : 'Light'} Mode</span>
      </footer>

      {/* Support ChatBot */}
      <ChatBot />
    </div>
  )
}

export default function App() {
  return (
    <Web3Provider>
      <SubscriptionProvider>
        <ToastProvider>
          <AppContent />
        </ToastProvider>
      </SubscriptionProvider>
    </Web3Provider>
  )
}
