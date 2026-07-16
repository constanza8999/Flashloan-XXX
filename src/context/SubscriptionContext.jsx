import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

const BACKEND_URL = 'http://localhost:8000'
const STORAGE_KEY = 'tokentoolkit_subscription'

// ─── Subscription Plans ────────────────────────────────────────────────

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    currency: 'USD',
    period: 'forever',
    icon: '🆓',
    color: '#64748b',
    description: 'Basic token transfers',
    features: [
      'Send tokens (BSC, ETH)',
      'Basic balance checking',
      'Token info lookup',
      'Transaction history (local)',
    ],
    limits: {
      maxTransfersPerDay: 10,
      chains: ['bsc', 'ethereum'],
      advancedFeatures: false,
    },
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    price: 29.99,
    currency: 'USD',
    period: 'month',
    icon: '⭐',
    color: '#3b82f6',
    popular: true,
    description: 'For active traders',
    features: [
      'All Free features',
      'All chains (Polygon, Arbitrum)',
      'Arbitrage Dashboard',
      'MEV Protection Bot',
      'Profit Withdraw',
      'Flashbots Bundle',
      'Telegram notifications',
      'Priority RPC endpoints',
    ],
    limits: {
      maxTransfersPerDay: 500,
      chains: ['bsc', 'ethereum', 'polygon', 'arbitrum'],
      advancedFeatures: true,
    },
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: 99.99,
    currency: 'USD',
    period: 'month',
    icon: '👑',
    color: '#a855f7',
    description: 'Maximum power',
    features: [
      'All Pro features',
      'P2P Network propagation',
      'Cross-Chain Bridge',
      'Relay Nodes management',
      'Gasless Relay (meta-tx)',
      'AI Price Predictor',
      'Mempool Watcher',
      'Auto-Bot sweeper',
      'Dedicated support',
      'Custom integrations',
    ],
    limits: {
      maxTransfersPerDay: 999999,
      chains: ['bsc', 'ethereum', 'polygon', 'arbitrum'],
      advancedFeatures: true,
    },
  },
}

// Features mapped to minimum plan tier required
export const FEATURE_TIERS = {
  'send-bsc': 'free',
  'send-eth': 'free',
  balances: 'free',
  'token-info': 'free',
  history: 'free',
  'send-polygon': 'pro',
  'send-arbitrum': 'pro',
  arbitrage: 'pro',
  'mev-bot': 'pro',
  withdraw: 'pro',
  'flashbots-bundle': 'pro',
  telegram: 'pro',
  'flash-send': 'pro',
  'gasless-relay': 'pro',
  'quantum-engine': 'pro',
  'universal-send': 'pro',
  propagation: 'enterprise',
  'cross-chain': 'enterprise',
  'p2p-network': 'enterprise',
  'relay-nodes': 'enterprise',
  predictor: 'enterprise',
  'auto-bot': 'enterprise',
  mempool: 'enterprise',
}

const TIER_ORDER = { free: 0, pro: 1, enterprise: 2 }

export function hasAccess(userTier, featureId) {
  const required = FEATURE_TIERS[featureId]
  if (!required) return true // no restriction
  return (TIER_ORDER[userTier] || 0) >= (TIER_ORDER[required] || 0)
}

export function hasChainAccess(userTier, chainId) {
  const plan = PLANS[userTier]
  if (!plan) return false
  return plan.limits.chains.includes(chainId)
}

// ─── License Key Generation ────────────────────────────────────────────

export function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const segments = []
  for (let s = 0; s < 4; s++) {
    let seg = ''
    for (let i = 0; i < 5; i++) {
      seg += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    segments.push(seg)
  }
  return `TK-${segments.join('-')}`
}

// ─── Context ───────────────────────────────────────────────────────────

const SubscriptionContext = createContext(null)

// Admin credentials (hardcoded for demo)
const ADMIN_EMAIL = 'josejaimejulia7@gmail.com'
const ADMIN_PASSWORD_HASH = btoa('constanza999') // simple base64 for demo

export function SubscriptionProvider({ children }) {
  const [user, setUser] = useState(null)       // { email, name, tier, licenseKey, expiresAt }
  const [subscriptions, setSubscriptions] = useState([]) // only used by admin
  const [loading, setLoading] = useState(false)
  const [backendAvailable, setBackendAvailable] = useState(null)

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed?.email) {
          setUser(parsed)
        }
      }
      // Load subscriptions (admin only)
      const savedSubs = localStorage.getItem(`${STORAGE_KEY}_admin_subs`)
      if (savedSubs) {
        setSubscriptions(JSON.parse(savedSubs))
      }
    } catch { /* ignore */ }
  }, [])

  // Persist user to localStorage
  useEffect(() => {
    if (user) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    } else {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [user])

  const login = useCallback(async (email, password) => {
    setLoading(true)
    try {
      // Try backend first
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) {
          const data = await res.json()
          const userData = {
            email: data.email,
            name: data.name || email.split('@')[0],
            tier: data.tier || 'pro',
            licenseKey: data.license_key || '',
            expiresAt: data.expires_at || null,
          }
          setUser(userData)
          return { success: true, user: userData }
        }
      } catch { /* fall through to local auth */ }

      // Local fallback: admin login
      if (email.toLowerCase() === ADMIN_EMAIL && btoa(password) === ADMIN_PASSWORD_HASH) {
        const userData = {
          email: ADMIN_EMAIL,
          name: 'Admin',
          tier: 'enterprise',
          licenseKey: 'ADMIN-MASTER-KEY-00000',
          expiresAt: null, // never expires
          isAdmin: true,
        }
        setUser(userData)
        return { success: true, user: userData }
      }

      // Demo: login with any email (creates free user)
      const userData = {
        email,
        name: email.split('@')[0],
        tier: 'free',
        licenseKey: '',
        expiresAt: null,
      }
      setUser(userData)
      return { success: true, user: userData }
    } finally {
      setLoading(false)
    }
  }, [])

  const register = useCallback(async (email, password, name) => {
    setLoading(true)
    try {
      // Try backend
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password, name }),
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) {
          const data = await res.json()
          const userData = {
            email: data.email,
            name: data.name || name || email.split('@')[0],
            tier: 'free',
            licenseKey: '',
            expiresAt: null,
          }
          setUser(userData)
          return { success: true, user: userData }
        }
      } catch { /* fall through */ }

      // Local fallback
      const userData = {
        email,
        name: name || email.split('@')[0],
        tier: 'free',
        licenseKey: '',
        expiresAt: null,
      }
      setUser(userData)
      return { success: true, user: userData }
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(() => {
    setUser(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const activateLicense = useCallback(async (licenseKey) => {
    setLoading(true)
    try {
      // Try backend
      try {
        const res = await fetch(`${BACKEND_URL}/api/auth/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ license_key: licenseKey, email: user?.email }),
          signal: AbortSignal.timeout(5000),
        })
        if (res.ok) {
          const data = await res.json()
          setUser(prev => ({
            ...prev,
            tier: data.tier || 'pro',
            licenseKey,
            expiresAt: data.expires_at || null,
          }))
          return { success: true, tier: data.tier || 'pro' }
        }
        const errData = await res.json().catch(() => ({}))
        if (errData.error) {
          return { success: false, error: errData.error }
        }
      } catch { /* fall through */ }

      // Local demo: activate with demo license keys
      const validKeys = {
        'TK-DEMO-PRO-00001': 'pro',
        'TK-DEMO-ENT-00001': 'enterprise',
      }
      const tier = validKeys[licenseKey]
      if (tier) {
        setUser(prev => ({
          ...prev,
          tier,
          licenseKey,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }))
        return { success: true, tier }
      }

      return { success: false, error: 'Invalid or expired license key' }
    } finally {
      setLoading(false)
    }
  }, [user])

  const purchasePlan = useCallback(async (planId, paymentMethod = 'paypal') => {
    setLoading(true)
    try {
      const plan = PLANS[planId]
      if (!plan) return { success: false, error: 'Invalid plan' }

      // Generate a license key
      const licenseKey = generateLicenseKey()

      // Try backend
      try {
        const res = await fetch(`${BACKEND_URL}/api/subscriptions/purchase`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plan: planId,
            email: user?.email || 'guest@example.com',
            payment_method: paymentMethod,
            license_key: licenseKey,
          }),
          signal: AbortSignal.timeout(10000),
        })
        if (res.ok) {
          const data = await res.json()
          setUser(prev => ({
            ...prev,
            tier: planId,
            licenseKey: data.license_key || licenseKey,
            expiresAt: data.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          }))
          return { success: true, licenseKey: data.license_key || licenseKey }
        }
      } catch { /* fall through */ }

      // Local fallback
      setUser(prev => ({
        ...prev || { email: 'guest@example.com', name: 'Guest' },
        tier: planId,
        licenseKey,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      }))

      return { success: true, licenseKey }
    } finally {
      setLoading(false)
    }
  }, [user])

  // Admin: get all subscriptions
  const adminGetSubscriptions = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/subscriptions`, {
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        const data = await res.json()
        setSubscriptions(data.subscriptions || [])
        // Cache locally
        localStorage.setItem(`${STORAGE_KEY}_admin_subs`, JSON.stringify(data.subscriptions || []))
      }
    } catch {
      // Use cached
      const cached = localStorage.getItem(`${STORAGE_KEY}_admin_subs`)
      if (cached) setSubscriptions(JSON.parse(cached))
    }
  }, [])

  // Admin: update user tier
  const adminUpdateTier = useCallback(async (email, newTier) => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/admin/update-tier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tier: newTier }),
        signal: AbortSignal.timeout(5000),
      })
      if (res.ok) {
        setSubscriptions(prev =>
          prev.map(s => s.email === email ? { ...s, tier: newTier } : s)
        )
        return { success: true }
      }
    } catch { /* ignore */ }
    return { success: false, error: 'Backend unavailable' }
  }, [])

  // Check if user can access a feature
  const canAccess = useCallback((featureId) => {
    if (!user) return featureId === 'dashboard' || featureId === 'subscription'
    return hasAccess(user.tier, featureId)
  }, [user])

  // Check if user can use a chain
  const canUseChain = useCallback((chainId) => {
    if (!user) return false
    return hasChainAccess(user.tier, chainId)
  }, [user])

  // Get available chains for current tier
  const availableChains = useCallback(() => {
    if (!user) return []
    return PLANS[user.tier]?.limits?.chains || ['bsc', 'ethereum']
  }, [user])

  const value = {
    user,
    loading,
    subscriptions,
    backendAvailable,
    isAdmin: user?.isAdmin || user?.email === ADMIN_EMAIL,
    isLoggedIn: !!user,
    userTier: user?.tier || 'free',
    login,
    register,
    logout,
    activateLicense,
    purchasePlan,
    canAccess,
    canUseChain,
    availableChains,
    adminGetSubscriptions,
    adminUpdateTier,
    PLANS,
    FEATURE_TIERS,
  }

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  )
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext)
  if (!ctx) throw new Error('useSubscription must be used within a SubscriptionProvider')
  return ctx
}

export default SubscriptionContext
