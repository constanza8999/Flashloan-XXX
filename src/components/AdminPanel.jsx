import React, { useEffect, useState } from 'react'
import { useSubscription, PLANS, generateLicenseKey } from '../context/SubscriptionContext'
import CopyButton from './shared/CopyButton'
import LoadingButton from './shared/LoadingButton'

const STORAGE_KEY = 'flashloan_admin_generated_keys'

function loadGeneratedKeys() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch { /* ignore */ }
  return []
}

export default function AdminPanel() {
  const { user, isAdmin, subscriptions, adminGetSubscriptions, adminUpdateTier } = useSubscription()
  const [editingEmail, setEditingEmail] = useState(null)
  const [newTier, setNewTier] = useState('')
  const [updateMsg, setUpdateMsg] = useState('')

  // Key generator state
  const [genEmail, setGenEmail] = useState('')
  const [genTier, setGenTier] = useState('pro')
  const [genMonths, setGenMonths] = useState(1)
  const [generatedKeys, setGeneratedKeys] = useState(loadGeneratedKeys)
  const [lastGenerated, setLastGenerated] = useState(null)
  const [genLoading, setGenLoading] = useState(false)

  // Persist generated keys
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(generatedKeys)) } catch { /* ignore */ }
  }, [generatedKeys])

  useEffect(() => {
    if (isAdmin) {
      adminGetSubscriptions()
    }
  }, [isAdmin, adminGetSubscriptions])

  if (!isAdmin) {
    return (
      <div className="tool-page">
        <div className="tool-header">
          <span className="tool-icon">🔒</span>
          <div>
            <h2>Admin Panel</h2>
            <p>You do not have admin access.</p>
          </div>
        </div>
        <div className="error-box">
          <span className="error-icon">⚠</span> Admin access required. Sign in with an admin account.
        </div>
      </div>
    )
  }

  const handleUpdateTier = async (email) => {
    const result = await adminUpdateTier(email, newTier)
    if (result.success) {
      setUpdateMsg(`✅ ${email} updated to ${newTier}`)
    } else {
      setUpdateMsg(`❌ Failed to update: ${result.error || 'Unknown error'}`)
    }
    setEditingEmail(null)
    setTimeout(() => setUpdateMsg(''), 3000)
  }

  const handleGenerateKey = () => {
    if (!genEmail.trim()) return
    setGenLoading(true)

    const key = generateLicenseKey()
    const expiresAt = new Date(Date.now() + genMonths * 30 * 24 * 60 * 60 * 1000).toISOString()
    const entry = {
      id: Date.now(),
      key,
      email: genEmail.trim(),
      tier: genTier,
      expiresAt,
      createdAt: new Date().toLocaleString(),
      activated: false,
    }

    setGeneratedKeys(prev => [entry, ...prev])
    setLastGenerated(entry)
    setGenLoading(false)
  }

  const handleClearHistory = () => {
    setGeneratedKeys([])
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
    setUpdateMsg('🗑 Key history cleared')
    setTimeout(() => setUpdateMsg(''), 2000)
  }

  const handleMarkActivated = (id) => {
    setGeneratedKeys(prev => prev.map(k => k.id === id ? { ...k, activated: true } : k))
    const key = generatedKeys.find(k => k.id === id)
    if (key) {
      setUpdateMsg(`✅ Key for ${key.email} marked as activated`)
      setTimeout(() => setUpdateMsg(''), 2000)
    }
  }

  const handleDeleteKey = (id) => {
    setGeneratedKeys(prev => prev.filter(k => k.id !== id))
  }

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">🛡️</span>
        <div>
          <h2>Admin Panel</h2>
          <p>Manage users, generate license keys, and control subscriptions</p>
        </div>
      </div>

      {/* Admin info */}
      <div className="stats-bar" style={{ marginBottom: 20 }}>
        <div className="stat">
          <span className="stat-label">Admin</span>
          <span className="stat-value" style={{ fontSize: 15, color: '#fbbf24' }}>
            👑 {user?.email}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Access Level</span>
          <span className="stat-value" style={{ fontSize: 15, color: '#22c55e' }}>
            Full Access
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Keys Generated</span>
          <span className="stat-value" style={{ fontSize: 15, color: '#60a5fa' }}>
            {generatedKeys.length}
          </span>
        </div>
        <div className="stat" style={{ flex: 1 }} />
        <div className="stat" style={{ justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={adminGetSubscriptions} style={{ fontSize: 11, padding: '8px 14px' }}>
            🔄 Refresh Users
          </button>
        </div>
      </div>

      {updateMsg && (
        <div className="result-panel success" style={{ padding: 12, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13 }}>{updateMsg}</p>
        </div>
      )}

      {/* System Stats */}
      <div className="config-panel">
        <h3>📊 System Overview</h3>
        <div className="admin-stats-grid">
          <div className="admin-stat-card">
            <span className="admin-stat-value">{subscriptions.length || 0}</span>
            <span className="admin-stat-label">Total Users</span>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-value">{subscriptions.filter(s => s.tier === 'enterprise').length || 0}</span>
            <span className="admin-stat-label">Enterprise</span>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-value">{subscriptions.filter(s => s.tier === 'pro').length || 0}</span>
            <span className="admin-stat-label">Pro</span>
          </div>
          <div className="admin-stat-card">
            <span className="admin-stat-value">{subscriptions.filter(s => s.tier === 'free' || !s.tier).length || 0}</span>
            <span className="admin-stat-label">Free</span>
          </div>
        </div>
      </div>

      {/* ─── KEY GENERATOR ─────────────────────────────────────── */}
      <div className="config-panel" style={{ borderColor: 'rgba(251, 191, 36, 0.3)' }}>
        <h3>🔑 License Key Generator</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16 }}>
          Generate a visible license key for a user. Copy the key and share it with the user to activate their plan.
        </p>

        {/* Generator form */}
        <div className="form-grid" style={{ gridTemplateColumns: '2fr 1fr 1fr auto' }}>
          <div className="form-group">
            <label>User Email</label>
            <input
              type="email"
              className="input"
              value={genEmail}
              onChange={e => setGenEmail(e.target.value)}
              placeholder="user@example.com"
              style={{ fontSize: 13 }}
            />
          </div>
          <div className="form-group">
            <label>Plan</label>
            <select className="input" value={genTier} onChange={e => setGenTier(e.target.value)} style={{ fontSize: 13 }}>
              <option value="pro">⭐ Pro — $29.99/mo</option>
              <option value="enterprise">👑 Enterprise — $99.99/mo</option>
            </select>
          </div>
          <div className="form-group">
            <label>Duration</label>
            <select className="input" value={genMonths} onChange={e => setGenMonths(Number(e.target.value))} style={{ fontSize: 13 }}>
              <option value={1}>1 Month</option>
              <option value={3}>3 Months</option>
              <option value={6}>6 Months</option>
              <option value={12}>12 Months</option>
              <option value={24}>24 Months</option>
            </select>
          </div>
          <div className="form-group" style={{ justifyContent: 'flex-end' }}>
            <LoadingButton
              loading={genLoading}
              loadingText="⏳"
              onClick={handleGenerateKey}
              disabled={!genEmail.trim()}
              style={{ fontSize: 13, padding: '10px 18px', marginTop: 22 }}
            >
              🔑 Generate Key
            </LoadingButton>
          </div>
        </div>
      </div>

      {/* ─── LAST GENERATED KEY (prominent display) ────────────── */}
      {lastGenerated && (
        <div className="result-panel success" style={{
          borderColor: 'rgba(251, 191, 36, 0.5)',
          background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.06), var(--bg-card))',
          marginBottom: 20,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <h3 style={{ margin: 0, color: '#fbbf24' }}>🔑 License Key Generated</h3>
            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{lastGenerated.createdAt}</span>
          </div>

          {/* Key display - large, visible, copyable */}
          <div className="admin-key-display">
            <div className="akd-key">{lastGenerated.key}</div>
            <div className="akd-actions">
              <CopyButton text={lastGenerated.key} />
            </div>
          </div>

          {/* Key metadata */}
          <div className="form-grid" style={{ marginTop: 12, marginBottom: 0 }}>
            <div className="config-item">
              <span className="ci-label">User</span>
              <span className="ci-value">{lastGenerated.email}</span>
            </div>
            <div className="config-item">
              <span className="ci-label">Plan</span>
              <span className="ci-value">
                <span className={`plan-tier-badge tier-${lastGenerated.tier}`}>
                  {lastGenerated.tier === 'pro' ? '⭐' : '👑'} {lastGenerated.tier}
                </span>
              </span>
            </div>
            <div className="config-item">
              <span className="ci-label">Expires</span>
              <span className="ci-value">{new Date(lastGenerated.expiresAt).toLocaleDateString()}</span>
            </div>
            <div className="config-item">
              <span className="ci-label">Status</span>
              <span className="ci-value" style={{ color: lastGenerated.activated ? '#22c55e' : '#fbbf24' }}>
                {lastGenerated.activated ? '✅ Activated' : '⏳ Pending activation'}
              </span>
            </div>
          </div>

          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic' }}>
            Share this key with {lastGenerated.email} so they can activate it on the Subscription page (🔑 Activate License Key section).
          </div>
        </div>
      )}

      {/* ─── KEY HISTORY ───────────────────────────────────────── */}
      <div className="config-panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0 }}>📋 Generated Keys History ({generatedKeys.length})</h3>
          {generatedKeys.length > 0 && (
            <button className="btn btn-secondary" onClick={handleClearHistory} style={{ fontSize: 10, padding: '6px 12px' }}>
              🗑 Clear All
            </button>
          )}
        </div>

        {generatedKeys.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-dim)', fontSize: 13, fontStyle: 'italic' }}>
            No keys generated yet. Use the form above to create license keys.
          </div>
        ) : (
          <div className="admin-key-list">
            {generatedKeys.map((entry) => (
              <div key={entry.id} className={`admin-key-item ${entry.activated ? 'activated' : ''}`}>
                <div className="aki-main">
                  <div className="aki-key-row">
                    <span className="aki-key-text">{entry.key}</span>
                    <div className="aki-key-actions">
                      <CopyButton text={entry.key} />
                      {!entry.activated && (
                        <button
                          className="btn btn-success"
                          onClick={() => handleMarkActivated(entry.id)}
                          style={{ fontSize: 10, padding: '4px 10px' }}
                          title="Mark as activated"
                        >
                          ✅ Activate
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDeleteKey(entry.id)}
                        style={{ fontSize: 10, padding: '4px 10px' }}
                        title="Delete key"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                  <div className="aki-meta">
                    <span>📧 {entry.email}</span>
                    <span className={`plan-tier-badge tier-${entry.tier}`}>
                      {entry.tier === 'pro' ? '⭐' : '👑'} {entry.tier}
                    </span>
                    <span>📅 Exp: {new Date(entry.expiresAt).toLocaleDateString()}</span>
                    <span>🕐 {entry.createdAt}</span>
                    <span style={{ color: entry.activated ? '#22c55e' : '#fbbf24' }}>
                      {entry.activated ? '✅ Activated' : '⏳ Pending'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── SUBSCRIBERS TABLE ──────────────────────────────────── */}
      <div className="config-panel">
        <h3>👥 Subscribers</h3>
        {subscriptions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-dim)', fontSize: 13, fontStyle: 'italic' }}>
            No subscribers yet. Start the backend server to see data.
          </div>
        ) : (
          <div className="tx-table-wrapper">
            <table className="tx-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Plan</th>
                  <th>License Key</th>
                  <th>Expires</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((sub, i) => (
                  <tr key={i}>
                    <td className="mono" style={{ fontSize: 11 }}>{sub.email}</td>
                    <td>{sub.name || '-'}</td>
                    <td>
                      <span className={`plan-tier-badge tier-${sub.tier || 'free'}`}>
                        {PLANS[sub.tier]?.icon || '🆓'} {sub.tier || 'free'}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 10, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {sub.license_key ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          {sub.license_key}
                          <CopyButton text={sub.license_key} />
                        </span>
                      ) : '-'}
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                      {sub.expires_at ? new Date(sub.expires_at).toLocaleDateString() : 'Never'}
                    </td>
                    <td>
                      {editingEmail === sub.email ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <select
                            className="input"
                            style={{ width: 120, fontSize: 11, padding: '6px 8px' }}
                            value={newTier}
                            onChange={e => setNewTier(e.target.value)}
                          >
                            <option value="free">Free</option>
                            <option value="pro">Pro</option>
                            <option value="enterprise">Enterprise</option>
                          </select>
                          <button className="btn btn-primary" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => handleUpdateTier(sub.email)}>
                            Save
                          </button>
                          <button className="btn btn-secondary" style={{ padding: '6px 10px', fontSize: 11 }} onClick={() => setEditingEmail(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn btn-secondary"
                          style={{ padding: '6px 10px', fontSize: 11 }}
                          onClick={() => { setEditingEmail(sub.email); setNewTier(sub.tier || 'free') }}
                        >
                          ✏️ Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
