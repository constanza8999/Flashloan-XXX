/**
 * powWorker.js — Web Worker for true multi-threaded SHA-256 PoW mining.
 *
 * Runs in a dedicated OS thread (not an async loop on the main thread).
 * Communication is via postMessage / onmessage.
 *
 * Messages from main thread (command):
 *   { type: 'start', seed, targetZeros, startNonce, stepSize, workerId }
 *   { type: 'stop' }
 *
 * Messages to main thread:
 *   { type: 'progress', workerId, hashCount, bestZeros, bestHash, nonce }
 *   { type: 'solved', workerId, nonce, hash, leadingZeros, hashCount }
 *   { type: 'idle', workerId }
 */

let running = false
let hashCount = 0n
let bestZeros = 0
let bestHash = ''
let lastProgressTime = 0

/**
 * SHA-256 hash via Web Crypto API (available in Workers).
 */
async function sha256(message) {
  const encoder = new TextEncoder()
  const data = encoder.encode(message)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

function countLeadingZeros(hex) {
  let count = 0
  for (let i = 0; i < hex.length; i++) {
    if (hex[i] === '0') count++
    else break
  }
  return count
}

self.onmessage = async function (e) {
  const msg = e.data

  if (msg.type === 'start') {
    running = true
    hashCount = 0n
    bestZeros = 0
    bestHash = ''
    lastProgress = 0

    const { seed, targetZeros, startNonce, stepSize, workerId } = msg
    let nonce = startNonce || 0
    const step = stepSize || 9973

    // Tight mining loop — no artificial yields for maximum CPU saturation
    while (running) {
      const message = seed + nonce.toString()
      const hash = await sha256(message)
      hashCount++

      const leading = countLeadingZeros(hash)
      if (leading > bestZeros) {
        bestZeros = leading
        bestHash = hash
      }

      // Check for solution
      if (leading >= targetZeros && running) {
        running = false
        self.postMessage({
          type: 'solved',
          workerId,
          nonce,
          hash,
          leadingZeros: leading,
          hashCount: Number(hashCount),
        })
        self.postMessage({ type: 'idle', workerId })
        return
      }

      // Progress reporting (time-based: every 250ms to auto-scale with hashrate)
      const now = performance.now()
      if (now - lastProgressTime >= 250) {
        lastProgressTime = now
        self.postMessage({
          type: 'progress',
          workerId,
          hashCount: Number(hashCount),
          bestZeros,
          bestHash,
          nonce,
        })
      }

      nonce += step
    }

    // If we get here, we were told to stop
    self.postMessage({ type: 'idle', workerId })

  } else if (msg.type === 'stop') {
    running = false
  }
}
