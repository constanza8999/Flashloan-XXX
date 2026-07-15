import React from 'react'

/**
 * Private key input with show/hide toggle and optional derived sender display.
 * @param {{ privateKey: string, setPrivateKey: fn, showKey: boolean, setShowKey: fn, senderAddress?: string, placeholder?: string, style?: object }} props
 */
export default function PrivateKeyInput({ privateKey, setPrivateKey, showKey, setShowKey, senderAddress, placeholder = '0x private key...', style = {} }) {
  return (
    <div style={{ marginTop: 8, position: 'relative', ...style }}>
      <input
        type={showKey ? 'text' : 'password'}
        value={privateKey}
        onChange={e => setPrivateKey(e.target.value)}
        placeholder={placeholder}
        className="input mono"
        style={{ fontSize: 12, paddingRight: 30, width: '100%' }}
      />
      <button
        onClick={() => setShowKey(!showKey)}
        style={{
          position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#888',
        }}
      >
        {showKey ? '🙈' : '👁'}
      </button>
      {senderAddress && (
        <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>
          Sender: {senderAddress.slice(0, 10)}...{senderAddress.slice(-6)}
        </div>
      )}
    </div>
  )
}
