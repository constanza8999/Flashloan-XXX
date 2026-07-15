import React from 'react'
import { useSubscription, PLANS, FEATURE_TIERS } from '../context/SubscriptionContext'

export default function ProtectedFeature({ featureId, fallback, children, onNavigate }) {
  const { canAccess, userTier, isLoggedIn } = useSubscription()

  if (canAccess(featureId)) {
    return children
  }

  if (fallback === 'hide') return null

  const requiredTier = FEATURE_TIERS[featureId] || 'pro'
  const plan = PLANS[requiredTier]
  const currentPlan = PLANS[userTier]

  return (
    <div className="feature-locked">
      <div className="feature-locked-icon">🔒</div>
      <h3>Premium Feature</h3>
      <p>
        This feature requires <strong>{plan?.name || requiredTier}</strong> plan.
        {currentPlan ? ` You're on ${currentPlan.name}.` : ''}
      </p>
      <div className="feature-locked-actions">
        <button
          className="btn btn-primary"
          onClick={() => onNavigate?.('subscription')}
          style={{ textDecoration: 'none' }}
        >
          Upgrade Now
        </button>
        {!isLoggedIn && (
          <button className="btn btn-secondary" onClick={() => onNavigate?.('dashboard')}>
            Sign In
          </button>
        )}
      </div>
    </div>
  )
}
