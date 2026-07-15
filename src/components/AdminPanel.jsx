import React, { useEffect, useState } from 'react'
import { useSubscription, PLANS } from '../context/SubscriptionContext'

export default function AdminPanel() {
  const { user, isAdmin, subscriptions, adminGetSubscriptions, adminUpdateTier } = useSubscription()
  const [editingEmail, setEditingEmail] = useState(null)
  const [newTier, setNewTier] = useState('')
  const [updateMsg, setUpdateMsg] = useState('')

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

  return (
    <div className="tool-page">
      <div className="tool-header">
        <span className="tool-icon">🛡️</span>
        <div>
          <h2>Admin Panel</h2>
          <p>Manage users, subscriptions, and licenses</p>
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
        <div className="stat" style={{ flex: 1 }} />
        <div className="stat" style={{ justifyContent: 'center' }}>
          <button className="btn btn-secondary" onClick={adminGetSubscriptions} style={{ fontSize: 11, padding: '8px 14px' }}>
            🔄 Refresh
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

      {/* Subscribers table */}
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
                    <td className="mono" style={{ fontSize: 10 }}>{sub.license_key || '-'}</td>
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

      {/* License keys */}
      <div className="config-panel">
        <h3>🔑 Generate License Key</h3>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Generate a license key for a user to activate a specific plan.
        </p>
        <div className="form-grid">
          <div className="form-group">
            <label>User Email</label>
            <input type="email" className="input" placeholder="user@example.com" />
          </div>
          <div className="form-group">
            <label>Plan</label>
            <select className="input">
              <option value="pro">Pro - $29.99/mo</option>
              <option value="enterprise">Enterprise - $99.99/mo</option>
            </select>
          </div>
        </div>
        <button className="btn btn-primary">
          🔑 Generate & Send License Key
        </button>
      </div>
    </div>
  )
}
