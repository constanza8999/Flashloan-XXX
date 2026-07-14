"""
Multi-chain USDT transfer toolkit.

Three features in one CLI:

  1. send-bsc   : Send BSC-USD (BEP20, 18 decimals) on BSC mainnet.
  2. send-eth   : Send USDT  (ERC20, 6 decimals)  on Ethereum mainnet,
                  submitted through the public Flashbots *Protect* RPC
                  (https://rpc.flashbots.net) for MEV protection.
  3. watch      : Read-only mempool pending-tx watcher for either chain.
                  Prints tx hashes; does NOT interact with the txs.

------------------------------------------------------------------
Reality checks (please read):

* No client-side balance check is performed, by request. A balance
  check in Python is pure UX. The EVM and the chain's consensus
  mechanism enforce balances at execution time, so a transfer from
  a wallet that does not hold the USDT you are trying to move
  will simply revert on-chain. There is no "injection protocol",
  no relay trick, and no client-side hack that can make a transfer
  of un-held tokens succeed. Network consensus cannot be bypassed
  by a script.

* "Flash USDT", "gasless USDT", "advanced injection protocol",
  and similar terms are scam vocabulary. Tokens that briefly
  appear in a wallet without a real ERC20/BEP20 Transfer event
  emitted by the token contract have no value. The chain does
  not have a gasless USDT primitive.

* Flashbots Protect is NOT free. You pay real ETH gas on Ethereum
  mainnet. Protect only routes your tx through Flashbots-aware
  block builders instead of the public mempool, which gives MEV
  protection (no sandwiching of your transfer). For cancel/replace
  via eth_sendPrivateTransaction, you need the `flashbots` Python
  package and a searcher signing key; this script uses the simpler
  Protect-RPC path, which provides protection but not bundles or
  cancel capability.

* DECIMALS: Tether USD (USDT) is 6 decimals on Ethereum mainnet
  and 18 decimals on BSC ("BSC-USD", contract
  0x55d398326f99059fF775485246999027B3197955). The two contracts
  are independent tokens. --amount is in human units; this script
  applies the correct decimal scaling per chain. Do not mix them
  up.

* KEY SAFETY: If you have been using the private key hardcoded
  in Bep.py (0xb0923ba390d26045270411aad3b6edb481e44f204b28ac547273516efa44c5ca),
  that key is already publicly exposed. Any BNB, ETH, or tokens
  sent to that address will be drained by sweeper bots. Move funds
  to a fresh wallet, generated offline, with the key kept only in
  an environment variable and never committed to a file or chat.

------------------------------------------------------------------
Environment variables:

  BSC_PRIVATE_KEY   hex private key (with or without 0x prefix) for BSC
  ETH_PRIVATE_KEY   hex private key (with or without 0x prefix) for ETH
"""

import os
import sys
import time
import argparse

from web3 import Web3
from eth_account import Account


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BSC_RPCS = [
    "https://bsc-dataseed.binance.org/",
    "https://bsc-dataseed1.defibit.io/",
    "https://bsc-dataseed1.ninicoin.io/",
    "https://bsc-dataseed2.defibit.io/",
    "https://bsc.publicnode.com",
]

ETH_RPCS = [
    "https://eth.llamarpc.com",
    "https://cloudflare-eth.com",
    "https://rpc.etherbase.com",
]

# The Protect endpoint IS a regular Ethereum RPC, but it routes tx
# through Flashbots builders, providing MEV protection. We use it as
# a "send via Flashbots" path without requiring the `flashbots` package
# or a searcher signing key.
ETH_PROTECT_RPC = "https://rpc.flashbots.net"

# Token contracts
WBTC_USDT = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c"  # BSC-USD (BEP20, 18 dec)
ETH_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"  # Tether  (ERC20,  6 dec)

BSC_CHAIN_ID = 56
ETH_CHAIN_ID = 1

# ERC20/BEP20 transfer(address,uint256) selector
TRANSFER_SELECTOR = "a9059cbb"

DEFAULT_BSC_GAS = 60_000
DEFAULT_ETH_GAS = 100_000


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def connect(rpcs, timeout=10):
    """Try each RPC in order; return the first that responds."""
    last_err = None
    for rpc in rpcs:
        try:
            w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": timeout}))
            if w3.is_connected():
                return w3
        except Exception as e:  # noqa: BLE001
            last_err = e
    raise RuntimeError("Could not connect to any RPC. Last error: %r" % (last_err,))


def load_key(env_name):
    """Read a 0x-prefixed private key from an environment variable."""
    key = os.environ.get(env_name)
    if not key:
        raise SystemExit(
            "Missing environment variable %s. "
            "Set it, e.g. on Windows PowerShell:  $env:%s = \"0x...\""
            % (env_name, env_name)
        )
    key = key.strip()
    if not key.startswith("0x"):
        key = "0x" + key
    if len(key) != 66:
        raise SystemExit("%s does not look like a 32-byte private key." % env_name)
    return key


def encode_transfer(to, amount_wei):
    """ABI-encode transfer(address,uint256)."""
    if not Web3.is_address(to):
        raise ValueError("Invalid address: %r" % (to,))
    to = Web3.to_checksum_address(to)
    return (
        TRANSFER_SELECTOR
        + to[2:].lower().rjust(64, "0")
        + format(amount_wei, "x").rjust(64, "0")
    )


def get_raw(signed):
    """web3.py v5 returns .rawTransaction; v6/v7 returns .raw_transaction."""
    return getattr(signed, "rawTransaction", None) or getattr(signed, "raw_transaction")


def estimate_eip1559(w3, priority_gwei, max_fee_gwei=None):
    """
    Build (maxPriorityFeePerGas, maxFeePerGas) in wei. Uses the latest
    block's base fee when available, else falls back to `max_fee_gwei`.
    """
    priority = w3.to_wei(priority_gwei, "gwei")
    if max_fee_gwei is not None:
        return priority, w3.to_wei(max_fee_gwei, "gwei")
    base_fee = None
    try:
        block = w3.eth.get_block("latest")
        base_fee = block.get("baseFeePerGas")
    except Exception:  # noqa: BLE001
        base_fee = None
    if base_fee is None:
        base_fee = w3.to_wei(20, "gwei")
    return priority, int(base_fee) + priority


# ---------------------------------------------------------------------------
# 1. BSC BEP20 send
# ---------------------------------------------------------------------------

def send_bsc_usdt(to, amount, priority_gwei=1.0, max_fee_gwei=None,
                  gas_limit=DEFAULT_BSC_GAS):
    """
    Send `amount` BSC-USD on BSC mainnet. No balance check; the chain
    enforces balances at execution time.
    """
    w3 = connect(BSC_RPCS)
    pk = load_key("BSC_PRIVATE_KEY")
    sender = Account.from_key(pk).address

    amount_wei = int(amount * 10**18)  # BSC-USD is 18 decimals
    nonce = w3.eth.get_transaction_count(sender)
    priority, max_fee = estimate_eip1559(w3, priority_gwei, max_fee_gwei)

    tx = {
        "to": Web3.to_checksum_address(BSC_USDT),
        "value": 0,
        "gas": gas_limit,
        "nonce": nonce,
        "chainId": BSC_CHAIN_ID,
        "maxPriorityFeePerGas": priority,
        "maxFeePerGas": max_fee,
        "data": encode_transfer(to, amount_wei),
    }

    signed = Account.sign_transaction(tx, pk)
    tx_hash = w3.eth.send_raw_transaction(get_raw(signed))
    print("[BSC] submitted: 0x%s" % tx_hash.hex())
    return "0x" + tx_hash.hex()


# ---------------------------------------------------------------------------
# 2. Ethereum USDT send via Flashbots Protect RPC
# ---------------------------------------------------------------------------

def send_eth_usdt_via_flashbots(to, amount, priority_gwei=1.0, max_fee_gwei=None,
                                gas_limit=DEFAULT_ETH_GAS):
    """
    Send `amount` USDT (ERC20, 6 decimals) on Ethereum mainnet, routed
    through the public Flashbots Protect RPC for MEV protection.

    Notes:
ETH. The transfer reverts on-chain if the
        sender does not hold enough USDT. Protect does not change that.
      * For cancel/replace via Flashbots (eth_sendPrivateTransaction),
        use the `flashbots` Python package. This is the simpler
        Protect-RPC + sendRawTransaction path.
    """
    w3 = Web3(Web3.HTTPProvider(ETH_PROTECT_RPC, request_kwargs={"timeout": 15}))
    if not w3.is_connected():
        # Fall back to a public RPC for chain-state queries (nonce),
        # then submit the signed tx through Protect.
        w3 = connect(ETH_RPCS)
        protect = Web3(Web3.HTTPProvider(ETH_PROTECT_RPC, request_kwargs={"timeout": 15}))
    else:
        protect = w3

    pk = load_key("ETH_PRIVATE_KEY")
    sender = Account.from_key(pk).address

    amount_wei = int(amount * 10**6)  # Tether USD on ETH is 6 decimals
    nonce = w3.eth.get_transaction_count(sender)
    priority, max_fee = estimate_eip1559(w3, priority_gwei, max_fee_gwei)

    tx = {
        "to": Web3.to_checksum_address(ETH_USDT),
        "value": 0,
        "gas": gas_limit,
        "nonce": nonce,
        "chainId": ETH_CHAIN_ID,
        "maxPriorityFeePerGas": priority,
        "maxFeePerGas": max_fee,
        "data": encode_transfer(to, amount_wei),
    }

    signed = Account.sign_transaction(tx, pk)
    raw = get_raw(signed)

    # Submit through Protect so the tx skips the public mempool and
    # goes to Flashbots builders directly. The signed payload is the
    # same as a normal sendRawTransaction; only the relay changes.
    tx_hash = protect.eth.send_raw_transaction(raw)
    h = "0x" + tx_hash.hex()
    print("[ETH/Flashbots] submitted: %s" % h)
    print("  tracker: https://protect.flashbots.net/tx/%s" % h[2:])
    return h


# ---------------------------------------------------------------------------
# 3. Read-only mempool pending-tx watcher
# ---------------------------------------------------------------------------

def watch_pending(chain, max_n=20, timeout_s=60, poll_interval=0.5):
    """
    Print pending-transaction hashes from the chosen chain's mempool.
    Read-only: never signs, never submits, never replaces.

    Over HTTP, the standard approach is to create a "pending" filter
    and poll it. Some public RPCs do not support filters; we fall
    back to polling the latest pending block if so.
    """
    if chain == "bsc":
        w3 = connect(BSC_RPCS)
    elif chain == "eth":
        w3 = connect(ETH_RPCS)
    else:
        raise ValueError("chain must be 'bsc' or 'eth'")

    print("[%s] watching pending transactions for up to %ss (Ctrl-C to stop)..."
          % (chain, timeout_s), flush=True)

    seen = set()
    start = time.time()
    flt = None
    try:
        try:
            flt = w3.eth.filter("pending")
        except Exception as e:  # noqa: BLE001
            print("[%s] filter('pending') not supported on this RPC (%s); "
                  "falling back to latest-block polling." % (chain, e))
            flt = None

        while time.time() - start < timeout_s and len(seen) < max_n:
            new = []
            if flt is not None:
                try:
                    new = flt.get_new_entries()
                except Exception:  # noqa: BLE001
                    new = []
            else:
                try:
                    block = w3.eth.get_block("pending", full_transactions=True)
                    new = [t.hash for t in block.transactions]
                except Exception:  # noqa: BLE001
                    new = []

            for h in new:
                h_hex = h.hex() if hasattr(h, "hex") else str(h)
                if not h_hex.startswith("0x"):
                    h_hex = "0x" + h_hex
                if h_hex not in seen:
                    seen.add(h_hex)
                    print("  pending: " + h_hex, flush=True)
                    if len(seen) >= max_n:
                        break

            time.sleep(poll_interval)

    except KeyboardInterrupt:
        pass
    finally:
        if flt is not None:
            try:
                w3.eth.uninstall_filter(flt.filter_id)
            except Exception:  # noqa: BLE001
                pass

    elapsed = int(time.time() - start)
    print("[%s] saw %d pending tx in %ds" % (chain, len(seen), elapsed))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser():
    p = argparse.ArgumentParser(
        prog="transfer_toolkit",
        description=(
            "Multi-chain USDT transfer toolkit: BSC BEP20 send, "
            "Ethereum USDT via Flashbots Protect RPC, and a read-only "
            "mempool pending-tx watcher."
        ),
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    # send-bsc
    b = sub.add_parser("send-bsc", help="Send BSC-USD on BSC mainnet")
    b.add_argument("--to", required=True, help="Recipient address (0x...)")
    b.add_argument("--amount", type=float, required=True,
                   help="Amount in human units (BSC-USD is 18 decimals)")
    b.add_argument("--priority-gwei", type=float, default=1.0)
    b.add_argument("--max-fee-gwei", type=float, default=None,
                   help="Override maxFeePerGas; otherwise derived from base fee")
    b.add_argument("--gas-limit", type=int, default=DEFAULT_BSC_GAS)

    # send-eth
    e = sub.add_parser("send-eth",
                       help="Send USDT on Ethereum mainnet via Flashbots Protect RPC")
    e.add_argument("--to", required=True)
    e.add_argument("--amount", type=float, required=True,
                   help="Amount in human units (Tether USD is 6 decimals on ETH)")
    e.add_argument("--priority-gwei", type=float, default=1.0)
    e.add_argument("--max-fee-gwei", type=float, default=None)
    e.add_argument("--gas-limit", type=int, default=DEFAULT_ETH_GAS)

    # watch
    w = sub.add_parser("watch", help="Watch pending tx (read-only)")
    w.add_argument("--chain", choices=["bsc", "eth"], default="bsc")
    w.add_argument("--max", type=int, default=20)
    w.add_argument("--timeout", type=int, default=60)

    return p


def main(argv=None):
    args = build_parser().parse_args(argv)
    if args.cmd == "send-bsc":
        send_bsc_usdt(args.to, args.amount,
                      args.priority_gwei, args.max_fee_gwei, args.gas_limit)
    elif args.cmd == "send-eth":
        send_eth_usdt_via_flashbots(args.to, args.amount,
                                    args.priority_gwei, args.max_fee_gwei, args.gas_limit)
    elif args.cmd == "watch":
        watch_pending(args.chain, args.max, args.timeout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
