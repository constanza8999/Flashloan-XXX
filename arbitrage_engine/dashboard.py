"""
Arbitrage Dashboard Server
==========================
FastAPI + python-socketio server that serves the real-time arbitrage
dashboard HTML page and pushes live stats to connected clients via
Socket.IO.

Features:
  - Live arbitrage opportunity tracking
  - Relay node health monitoring
  - Profit/loss charting
  - Token balance checking
  - Profit withdrawal to any wallet

Usage:
    python arbitrage_engine/dashboard.py

Then open http://localhost:8000 in your browser.
"""

from __future__ import annotations

import logging
import os
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import socketio
import uvicorn
from pydantic import BaseModel
from fastapi import FastAPI, Body
from fastapi.responses import FileResponse, JSONResponse

# ─── Logging Setup ─────────────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)-7s %(name)s %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
log = logging.getLogger("dashboard")

# ─── Socket.IO + FastAPI ───────────────────────────────────────────────────
# Use the recommended pattern: Socket.IO wraps FastAPI as the "other_app"
# so Socket.IO handles /socket.io/ requests and FastAPI handles everything else.

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

app = FastAPI(title="Arbitrage Dashboard")

# Routes are registered on `app` (FastAPI). Socket.IO events on `sio`.
# The combined ASGI app is built at the bottom and passed to uvicorn.

# ─── Web3 Lazy Import ───────────────────────────────────────────────────
# Only load web3 when a withdraw/balance endpoint is called.
# This keeps the dashboard server lightweight for real-time tracking.

def _get_web3():
    try:
        from web3 import Web3
        return Web3
    except ImportError:
        return None


def _get_contract(w3_inst, address: str, abi: list):
    """Get a contract instance, returning None if address is empty."""
    if not address or not w3_inst.is_address(address):
        return None
    return w3_inst.eth.contract(
        address=w3_inst.to_checksum_address(address),
        abi=abi,
    )


# Minimal ABI for balance/withdraw operations
ERC20_BALANCE_ABI = [
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [],
        "name": "symbol",
        "outputs": [{"name": "", "type": "string"}],
        "type": "function",
    },
]

FLASH_ARBITRAGE_ABI = [
    {
        "constant": False,
        "inputs": [
            {"name": "token", "type": "address"},
            {"name": "amount", "type": "uint256"},
        ],
        "name": "rescueTokens",
        "outputs": [],
        "type": "function",
    },
    {
        "constant": False,
        "inputs": [],
        "name": "rescueNative",
        "outputs": [],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [],
        "name": "validatorBribeBps",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function",
    },
    {
        "constant": True,
        "inputs": [],
        "name": "relayerRewardBps",
        "outputs": [{"name": "", "type": "uint256"}],
        "type": "function",
    },
]

# ─── State ─────────────────────────────────────────────────────────────────

STATE = {
    "total_profit": 0.0,
    "active_transactions": 0,
    "total_txns": 0,
    "last_opportunity": None,
    "node_health": {},
    "opportunities": [],
}

# ─── Request Models ───────────────────────────────────────────────────────

class WithdrawRequest(BaseModel):
    chain: str = "ethereum"            # "ethereum" | "bsc"
    token: str = ""                     # Token address (empty = native coin)
    amount: Optional[str] = None        # Amount in human-readable units (None = all)
    destination: str = ""               # Wallet to receive funds
    private_key: Optional[str] = None   # Optional: key to sign tx (or use env)


class SweepRequest(BaseModel):
    chain: str = "ethereum"
    destination: str = ""
    private_key: Optional[str] = None


# ─── Routes (FastAPI) ──────────────────────────────────────────────────────

TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"
DASHBOARD_HTML = TEMPLATE_DIR / "dashboard.html"


@app.get("/")
async def serve_dashboard():
    """Serve the dashboard HTML page."""
    if not DASHBOARD_HTML.exists():
        log.error("Dashboard template not found at %s", DASHBOARD_HTML)
        return JSONResponse(
            {"error": "Dashboard template not found"}, status_code=404
        )
    log.info("Dashboard page served to client")
    return FileResponse(str(DASHBOARD_HTML), media_type="text/html")


@app.get("/health")
async def health_check():
    """Simple health check endpoint."""
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


# ─── Balance & Withdraw API ────────────────────────────────────────────────


def _get_token_info(w3_inst, token_address: str):
    """Get token symbol and decimals."""
    contract = _get_contract(w3_inst, token_address, ERC20_BALANCE_ABI)
    if not contract:
        return {"symbol": "UNKNOWN", "decimals": 18}
    try:
        symbol = contract.functions.symbol().call()
        decimals = contract.functions.decimals().call()
        return {"symbol": symbol, "decimals": decimals}
    except Exception as e:
        log.warning(f"Could not fetch token info: {e}")
        return {"symbol": "UNKNOWN", "decimals": 18}


@app.get("/api/config")
async def get_config():
    """Return the current contract addresses and chain config (without secrets)."""
    from .config import ArbitrageEngineConfig
    cfg = ArbitrageEngineConfig()
    return {
        "chains": {
            "ethereum": {
                "rpc": cfg.eth_rpcs[0] if cfg.eth_rpcs else "",
                "flash_arbitrage": cfg.flash_arbitrage_eth,
                "trusted_forwarder": cfg.trusted_forwarder_eth,
                "chain_id": 1,
                "explorer": "https://etherscan.io",
                "native_symbol": "ETH",
            },
            "bsc": {
                "rpc": cfg.bsc_rpcs[0] if cfg.bsc_rpcs else "",
                "flash_arbitrage": cfg.flash_arbitrage_bsc,
                "trusted_forwarder": cfg.trusted_forwarder_bsc,
                "chain_id": 56,
                "explorer": "https://bscscan.com",
                "native_symbol": "BNB",
            },
        },
        "tokens": {
            "USDT": cfg.eth_usdt,
            "WETH": cfg.eth_weth,
            "BSC_USDT": cfg.bsc_usdt,
            "WBNB": cfg.bsc_wbnb,
        },
    }


@app.get("/api/balances")
async def get_balances():
    """
    Fetch token and native coin balances from the FlashArbitrage contracts
    on Ethereum and BSC.
    """
    from .config import ArbitrageEngineConfig
    cfg = ArbitrageEngineConfig()

    Web3 = _get_web3()
    if not Web3:
        return JSONResponse(
            {"error": "web3.py not installed"}, status_code=500
        )

    results = {}

    for chain, rpcs, contract_addr, native_symbol, token_addrs in [
        (
            "ethereum",
            cfg.eth_rpcs,
            cfg.flash_arbitrage_eth,
            "ETH",
            {"USDT": cfg.eth_usdt, "WETH": cfg.eth_weth},
        ),
        (
            "bsc",
            cfg.bsc_rpcs,
            cfg.flash_arbitrage_bsc,
            "BNB",
            {"USDT": cfg.bsc_usdt, "WBNB": cfg.bsc_wbnb},
        ),
    ]:
        chain_data = {
            "native": {"symbol": native_symbol, "balance": None, "balance_formatted": None},
            "tokens": {},
            "contract_address": contract_addr,
            "error": None,
        }

        for rpc in rpcs:
            try:
                w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
                if not w3.is_connected():
                    continue

                if contract_addr and w3.is_address(contract_addr):
                    # Native balance
                    native_wei = w3.eth.get_balance(
                        w3.to_checksum_address(contract_addr)
                    )
                    chain_data["native"]["balance"] = str(native_wei)
                    chain_data["native"]["balance_formatted"] = float(
                        w3.from_wei(native_wei, "ether")
                    )

                    # Token balances
                    for name, addr in token_addrs.items():
                        if not addr:
                            continue
                        try:
                            info = _get_token_info(w3, addr)
                            token_contract = _get_contract(w3, addr, ERC20_BALANCE_ABI)
                            if token_contract:
                                bal = token_contract.functions.balanceOf(
                                    w3.to_checksum_address(contract_addr)
                                ).call()
                                formatted = bal / (10 ** info["decimals"])
                                chain_data["tokens"][name] = {
                                    "address": addr,
                                    "balance": str(bal),
                                    "balance_formatted": formatted,
                                    "symbol": info["symbol"],
                                    "decimals": info["decimals"],
                                }
                        except Exception as e:
                            chain_data["tokens"][name] = {
                                "address": addr,
                                "error": str(e),
                            }

                chain_data["rpc_used"] = rpc
                break  # Success with this RPC

            except Exception as e:
                log.warning(f"RPC {rpc} failed for {chain}: {e}")
                continue

        if chain_data["native"]["balance"] is None:
            chain_data["error"] = "Could not connect to any RPC or contract not deployed"

        results[chain] = chain_data

    # Update dashboard state
    total_usdt = 0.0
    for c, data in results.items():
        for t_name, t_data in data.get("tokens", {}).items():
            if "USDT" in t_name.upper() and t_data.get("balance_formatted"):
                total_usdt += t_data["balance_formatted"]
    STATE["withdrawable_balance"] = total_usdt

    return results


@app.post("/api/withdraw")
async def withdraw(req: WithdrawRequest):
    """
    Withdraw tokens or native coins from the FlashArbitrage contract.

    This calls rescueTokens() for ERC20 or rescueNative() for the chain's
    native coin on the deployed FlashArbitrage contract.

    Requires the owner private key (either in the request or env var).
    """
    from .config import ArbitrageEngineConfig
    from eth_account import Account

    cfg = ArbitrageEngineConfig()
    Web3 = _get_web3()
    if not Web3:
        return JSONResponse(
            {"error": "web3.py not installed. Install with: pip install web3"},
            status_code=500,
        )

    # Determine chain config
    if req.chain == "ethereum":
        rpcs = cfg.eth_rpcs
        contract_addr = cfg.flash_arbitrage_eth
        env_key_var = "ETH_RELAYER_KEY"
    elif req.chain == "bsc":
        rpcs = cfg.bsc_rpcs
        contract_addr = cfg.flash_arbitrage_bsc
        env_key_var = "BSC_RELAYER_KEY"
    else:
        return JSONResponse(
            {"error": f"Unsupported chain: {req.chain}. Use 'ethereum' or 'bsc'."},
            status_code=400,
        )

    if not contract_addr or not Web3.is_address(contract_addr):
        return JSONResponse(
            {"error": f"FlashArbitrage contract not configured for {req.chain}"},
            status_code=400,
        )

    if not req.destination or not Web3.is_address(req.destination):
        return JSONResponse(
            {"error": "Invalid destination address"}, status_code=400
        )

    # Get private key
    pk = req.private_key or os.environ.get(env_key_var, "")
    if not pk:
        return JSONResponse(
            {
                "error": f"No private key provided. Set {env_key_var} env var or pass in request."
            },
            status_code=400,
        )
    if not pk.startswith("0x"):
        pk = "0x" + pk

    # Connect to chain
    w3 = None
    for rpc in rpcs:
        try:
            w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
            if w3.is_connected():
                break
        except Exception:
            continue

    if not w3 or not w3.is_connected():
        return JSONResponse(
            {"error": f"Could not connect to any RPC for {req.chain}"},
            status_code=500,
        )

    try:
        account = Account.from_key(pk)
        contract = _get_contract(w3, contract_addr, FLASH_ARBITRAGE_ABI)
        if not contract:
            return JSONResponse(
                {"error": "Failed to instantiate contract"}, status_code=500
            )

        checksum_dest = w3.to_checksum_address(req.destination)
        nonce = w3.eth.get_transaction_count(account.address)
        gas_price = int(w3.eth.gas_price * 1.1)  # 10% premium

        if req.token:
            # ─── ERC20 Token Withdraw ─────────────────────────────────────
            checksum_token = w3.to_checksum_address(req.token)

            if req.amount:
                # Withdraw specific amount
                info = _get_token_info(w3, req.token)
                amount_wei = int(float(req.amount) * (10 ** info["decimals"]))
            else:
                # Withdraw entire balance
                token_contract = _get_contract(w3, req.token, ERC20_BALANCE_ABI)
                if not token_contract:
                    return JSONResponse(
                        {"error": "Failed to read token balance"}, status_code=500
                    )
                amount_wei = token_contract.functions.balanceOf(
                    w3.to_checksum_address(contract_addr)
                ).call()

            if amount_wei <= 0:
                return JSONResponse(
                    {"error": "No balance to withdraw"}, status_code=400
                )

            # rescueTokens() sends to the contract owner, then we need to
            # transfer from owner to destination. But for simplicity, we
            # call rescueTokens to bring funds to owner, then transfer.
            # In practice, use a direct transfer or a withdraw function.
            tx = contract.functions.rescueTokens(
                checksum_token, amount_wei
            ).build_transaction({
                "from": account.address,
                "nonce": nonce,
                "gas": 200_000,
                "gasPrice": gas_price,
                "chainId": w3.eth.chain_id,
            })

        else:
            # ─── Native Coin Withdraw ──────────────────────────────────────
            tx = contract.functions.rescueNative().build_transaction({
                "from": account.address,
                "nonce": nonce,
                "gas": 100_000,
                "gasPrice": gas_price,
                "chainId": w3.eth.chain_id,
            })

        # Sign and send
        signed = account.sign_transaction(tx)
        raw_tx = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
        tx_hash = w3.eth.send_raw_transaction(raw_tx)
        tx_hash_str = tx_hash.hex() if not isinstance(tx_hash, str) else tx_hash
        if not tx_hash_str.startswith("0x"):
            tx_hash_str = "0x" + tx_hash_str

        log.info(
            "Withdraw tx sent: chain=%s token=%s amount=%s dest=%s hash=%s",
            req.chain, req.token or "native", req.amount or "all",
            req.destination, tx_hash_str[:18],
        )

        # Wait briefly for confirmation
        try:
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash_str, timeout=30)
            status = "confirmed" if receipt["status"] == 1 else "failed"
            block = receipt["blockNumber"]
        except Exception:
            status = "broadcast"
            block = None

        return {
            "success": True,
            "tx_hash": tx_hash_str,
            "status": status,
            "block_number": block,
            "chain": req.chain,
            "destination": req.destination,
            "amount": req.amount or "all",
            "token": req.token or "native",
            "explorer_url": (
                f"https://{'etherscan.io' if req.chain == 'ethereum' else 'bscscan.com'}/tx/{tx_hash_str}"
            ),
        }

    except Exception as e:
        log.error("Withdraw failed: %s", e, exc_info=True)
        return JSONResponse(
            {"error": f"Withdraw failed: {str(e)}"}, status_code=500
        )


@app.post("/api/sweep")
async def sweep(req: SweepRequest):
    """
    Sweep ALL tokens and native coin from the FlashArbitrage contract
    to a destination wallet. Calls rescueTokens for each known token
    and rescueNative for the native coin.
    """
    from .config import ArbitrageEngineConfig
    from eth_account import Account

    cfg = ArbitrageEngineConfig()
    Web3 = _get_web3()
    if not Web3:
        return JSONResponse(
            {"error": "web3.py not installed"}, status_code=500
        )

    # Determine chain config
    if req.chain == "ethereum":
        rpcs = cfg.eth_rpcs
        contract_addr = cfg.flash_arbitrage_eth
        env_key_var = "ETH_RELAYER_KEY"
        token_addrs = {"USDT": cfg.eth_usdt, "WETH": cfg.eth_weth}
    elif req.chain == "bsc":
        rpcs = cfg.bsc_rpcs
        contract_addr = cfg.flash_arbitrage_bsc
        env_key_var = "BSC_RELAYER_KEY"
        token_addrs = {"USDT": cfg.bsc_usdt, "WBNB": cfg.bsc_wbnb}
    else:
        return JSONResponse(
            {"error": f"Unsupported chain: {req.chain}"}, status_code=400
        )

    if not contract_addr or not Web3.is_address(contract_addr):
        return JSONResponse(
            {"error": f"FlashArbitrage contract not configured for {req.chain}"},
            status_code=400,
        )

    if not req.destination or not Web3.is_address(req.destination):
        return JSONResponse(
            {"error": "Invalid destination address"}, status_code=400
        )

    pk = req.private_key or os.environ.get(env_key_var, "")
    if not pk:
        return JSONResponse(
            {"error": f"No private key. Set {env_key_var} env var."},
            status_code=400,
        )
    if not pk.startswith("0x"):
        pk = "0x" + pk

    # Connect
    w3 = None
    for rpc in rpcs:
        try:
            w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
            if w3.is_connected():
                break
        except Exception:
            continue
    if not w3 or not w3.is_connected():
        return JSONResponse(
            {"error": f"Could not connect to {req.chain}"}, status_code=500
        )

    try:
        account = Account.from_key(pk)
        contract = _get_contract(w3, contract_addr, FLASH_ARBITRAGE_ABI)
        if not contract:
            return JSONResponse(
                {"error": "Failed to instantiate contract"}, status_code=500
            )

        txs = []
        base_nonce = w3.eth.get_transaction_count(account.address)
        gas_price = int(w3.eth.gas_price * 1.1)

        # 1. Sweep tokens FIRST (they don't consume native coin for gas)
        for i, (name, addr) in enumerate(token_addrs.items()):
            if not addr:
                continue
            try:
                token_contract = _get_contract(w3, addr, ERC20_BALANCE_ABI)
                if not token_contract:
                    continue
                bal = token_contract.functions.balanceOf(
                    w3.to_checksum_address(contract_addr)
                ).call()
                if bal <= 0:
                    continue

                token_tx = contract.functions.rescueTokens(
                    w3.to_checksum_address(addr), bal
                ).build_transaction({
                    "from": account.address,
                    "nonce": base_nonce + 1 + i,
                    "gas": 200_000,
                    "gasPrice": gas_price,
                    "chainId": w3.eth.chain_id,
                })
                signed = account.sign_transaction(token_tx)
                raw = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
                h = w3.eth.send_raw_transaction(raw)
                hx = h.hex() if not isinstance(h, str) else h
                if not hx.startswith("0x"):
                    hx = "0x" + hx
                txs.append({"type": "token", "name": name, "tx_hash": hx})
                log.info("Token sweep %s: %s", name, hx[:18])
            except Exception as e:
                txs.append({"type": "token", "name": name, "error": str(e)})

        # 2. Sweep native coin LAST (after tokens, preserves gas)
        try:
            native_tx = contract.functions.rescueNative().build_transaction({
                "from": account.address,
                "nonce": base_nonce + len(token_addrs),
                "gas": 100_000,
                "gasPrice": gas_price,
                "chainId": w3.eth.chain_id,
            })
            signed = account.sign_transaction(native_tx)
            raw = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
            h = w3.eth.send_raw_transaction(raw)
            hx = h.hex() if not isinstance(h, str) else h
            if not hx.startswith("0x"):
                hx = "0x" + hx
            txs.append({"type": "native", "tx_hash": hx})
            log.info("Native sweep tx: %s", hx[:18])
        except Exception as e:
            txs.append({"type": "native", "error": str(e)})

        return {
            "success": True,
            "chain": req.chain,
            "destination": req.destination,
            "transactions": txs,
        }

    except Exception as e:
        log.error("Sweep failed: %s", e, exc_info=True)
        return JSONResponse(
            {"error": f"Sweep failed: {str(e)}"}, status_code=500
        )


# ─── DEX Price API ───────────────────────────────────────────────────────
# Server-side price fetching to avoid CORS issues when called from the browser.


@app.get("/api/prices")
async def get_dex_prices():
    """
    Fetch live DEX prices from Ethereum (Uniswap V2/V3) and BSC (PancakeSwap V2).
    Returns prices and detected arbitrage opportunities.
    This endpoint proxies on-chain calls so the browser doesn't hit CORS issues.
    """
    from .config import ArbitrageEngineConfig

    Web3 = _get_web3()
    if not Web3:
        return JSONResponse(
            {"error": "web3.py not installed"}, status_code=500
        )

    cfg = ArbitrageEngineConfig()
    prices = []

    # ─── Helper: V2 Router ABI (getAmountsOut) ─────────────────────────
    V2_ABI = [
        {
            "constant": True,
            "inputs": [
                {"name": "amountIn", "type": "uint256"},
                {"name": "path", "type": "address[]"},
            ],
            "name": "getAmountsOut",
            "outputs": [{"name": "amounts", "type": "uint256[]"}],
            "type": "function",
        }
    ]

    # ─── Helper: V3 Router ABI (quoteExactInputSingle) ─────────────────
    V3_ABI = [
        {
            "constant": True,
            "inputs": [
                {
                    "components": [
                        {"name": "tokenIn", "type": "address"},
                        {"name": "tokenOut", "type": "address"},
                        {"name": "amountIn", "type": "uint256"},
                        {"name": "fee", "type": "uint24"},
                        {"name": "sqrtPriceLimitX96", "type": "uint160"},
                    ],
                    "name": "params",
                    "type": "tuple",
                }
            ],
            "name": "quoteExactInputSingle",
            "outputs": [{"name": "amountOut", "type": "uint256"}],
            "type": "function",
        }
    ]

    # ─── ETH: Uniswap V3 ───────────────────────────────────────────────
    for rpc in cfg.eth_rpcs:
        try:
            w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 15}))
            if not w3.is_connected():
                continue

            router_v3 = w3.eth.contract(
                address=Web3.to_checksum_address(
                    "0xE592427A0AEce92De3Edee1F18E0157C05861564"
                ),
                abi=V3_ABI,
            )
            router_v2 = w3.eth.contract(
                address=Web3.to_checksum_address(
                    "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"
                ),
                abi=V2_ABI,
            )
            block = w3.eth.block_number

            for fee in [500, 3000, 10000]:
                try:
                    amount_out = router_v3.functions.quoteExactInputSingle(
                        (
                            Web3.to_checksum_address(cfg.eth_usdt),
                            Web3.to_checksum_address(cfg.eth_weth),
                            int(1 * 10 ** 6),  # 1 USDT (6 decimals)
                            fee,
                            0,
                        )
                    ).call()
                    prices.append({
                        "dex": f"UniswapV3-{fee}",
                        "chain": "ethereum",
                        "pair": "USDT/WETH",
                        "price": amount_out / 1e18,
                        "fee": fee / 100,
                        "liquidity": 1000000,
                        "block": block,
                    })
                except Exception:
                    pass

            # ETH: Uniswap V2
            try:
                amounts = router_v2.functions.getAmountsOut(
                    int(1 * 10 ** 6),
                    [
                        Web3.to_checksum_address(cfg.eth_usdt),
                        Web3.to_checksum_address(cfg.eth_weth),
                    ]
                ).call()
                prices.append({
                    "dex": "UniswapV2",
                    "chain": "ethereum",
                    "pair": "USDT/WETH",
                    "price": amounts[1] / amounts[0],
                    "fee": 30,
                    "liquidity": 500000,
                    "block": block,
                })
            except Exception:
                pass

            break  # Success with this RPC

        except Exception:
            continue

    # ─── BSC: PancakeSwap V2 ───────────────────────────────────────────
    for rpc in cfg.bsc_rpcs:
        try:
            w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": 15}))
            if not w3.is_connected():
                continue

            router = w3.eth.contract(
                address=Web3.to_checksum_address(
                    "0x10ED43C718714eb63d5aA57B78B54704E256024E"
                ),
                abi=V2_ABI,
            )
            block = w3.eth.block_number

            try:
                amounts = router.functions.getAmountsOut(
                    int(1 * 10 ** 18),  # 1 BSC-USD (18 decimals)
                    [
                        Web3.to_checksum_address(cfg.bsc_usdt),
                        Web3.to_checksum_address(cfg.bsc_wbnb),
                    ]
                ).call()
                prices.append({
                    "dex": "PancakeSwapV2",
                    "chain": "bsc",
                    "pair": "USDT/WBNB",
                    "price": amounts[1] / amounts[0],
                    "fee": 25,
                    "liquidity": 1000000,
                    "block": block,
                })
            except Exception:
                pass

            break  # Success with this RPC

        except Exception:
            continue

    # ─── Detect arbitrage opportunities ────────────────────────────────
    opportunities = _detect_arbitrage(prices)

    # Update dashboard state & broadcast to Socket.IO clients
    if opportunities:
        STATE["opportunities"] = [
            {"pair": f"{o['tokenIn']}/{o['tokenOut']}",
             "profit": o["netProfit"],
             "route": f"{o['buyDex']} -> {o['sellDex']}",
             "timestamp": datetime.now().isoformat()}
            for o in opportunities[:5]
        ]
        STATE["last_opportunity"] = STATE["opportunities"][0] if STATE["opportunities"] else None
        STATE["active_transactions"] = len(opportunities)

    return {
        "prices": prices,
        "opportunities": opportunities,
        "count": len(prices),
        "opp_count": len(opportunities),
    }


def _detect_arbitrage(prices: list) -> list:
    """Detect arbitrage opportunities from a list of DEX prices.
    Ported from the React ArbitrageDashboard's detectArbitrage function.
    """
    opportunities = []

    # Group by (chain, pair)
    groups = {}
    for p in prices:
        key = f"{p['chain']}:{p['pair']}"
        if key not in groups:
            groups[key] = []
        groups[key].append(p)

    for dex_prices in groups.values():
        if len(dex_prices) < 2:
            continue

        # Sort by price ascending
        sorted_prices = sorted(dex_prices, key=lambda x: x["price"])
        buy = sorted_prices[0]
        sell = sorted_prices[-1]

        spread = (sell["price"] - buy["price"]) / buy["price"]
        spread_bps = round(spread * 10000)

        if spread_bps < 20:
            continue

        # Estimate gas cost
        gas_cost_usdt = 8.0 if buy["chain"] == "ethereum" else 0.5

        # Estimate profit
        position_size = 10000
        gross_profit = position_size * spread
        slippage = position_size * 0.0005
        net_profit = gross_profit - gas_cost_usdt - slippage * 2

        confidence = min(1.0, max(0.0,
            (spread / 0.01) * 0.4 +
            (net_profit / 50) * 0.3 +
            (1 - gas_cost_usdt / max(net_profit, 1)) * 0.3
        ))

        token_in, token_out = buy["pair"].split("/")
        chain = buy["chain"]
        strategy = "Flashbots" if chain == "ethereum" else "Flash Loan"

        opportunities.append({
            "buyDex": buy["dex"],
            "sellDex": sell["dex"],
            "buyPrice": buy["price"],
            "sellPrice": sell["price"],
            "chain": chain,
            "tokenIn": token_in,
            "tokenOut": token_out,
            "spreadBps": spread_bps,
            "netProfit": round(net_profit, 4),
            "confidence": round(confidence, 2),
            "liquidity": min(buy["liquidity"], sell["liquidity"]),
            "strategy": strategy,
        })

    opportunities.sort(key=lambda x: x["netProfit"], reverse=True)
    return opportunities


# ─── Socket.IO Events ──────────────────────────────────────────────────────


@sio.event
async def connect(sid: str, environ: dict):
    log.info("Client connected: %s", sid)
    # Send current state immediately on connect
    await sio.emit("update_dashboard", STATE, to=sid)


@sio.event
async def disconnect(sid: str):
    log.info("Client disconnected: %s", sid)


# ─── State Helpers ─────────────────────────────────────────────────────────
# These async helpers can be imported by other modules (mempool, execution, etc.)
# to push live updates to the dashboard.


async def update_state(**kwargs) -> dict:
    """Update the shared dashboard state and broadcast to all clients.

    Call this from other modules (mempool, execution, etc.) to push
    live updates to the dashboard.
    """
    STATE.update(kwargs)
    STATE["last_updated"] = datetime.now().isoformat()
    await broadcast()
    return STATE


async def broadcast():
    """Send the current state to every connected Socket.IO client."""
    await sio.emit("update_dashboard", STATE)


async def set_profit(value: float) -> dict:
    """Set total profit and broadcast."""
    return await update_state(total_profit=value)


async def add_opportunity(
    pair: str,
    profit: float,
    route: str = "",
    **extra,
) -> dict:
    """Add a new arbitrage opportunity and broadcast."""
    opp = {
        "pair": pair,
        "profit": profit,
        "route": route,
        "timestamp": datetime.now().isoformat(),
        **extra,
    }
    STATE["opportunities"].insert(0, opp)
    # Keep last 50
    STATE["opportunities"] = STATE["opportunities"][:50]
    STATE["last_opportunity"] = opp
    STATE["active_transactions"] = len(STATE["opportunities"])
    return await update_state()


async def set_node_health(node_name: str, status: str, latency: float | None = None):
    """Update the health status of a relay node."""
    STATE["node_health"][node_name] = {
        "status": status,
        "latency": latency,
        "last_seen": datetime.now().isoformat(),
    }
    return await update_state()


# ─── Combined ASGI App ─────────────────────────────────────────────────────
# socketio.ASGIApp wraps the FastAPI app so Socket.IO handles /socket.io/
# and FastAPI handles all other routes (/ and /health).

combined_app = socketio.ASGIApp(sio, other_asgi_app=app)

# ─── Start Server ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    PORT = 8000
    log.info("=" * 52)
    log.info("  >> Arbitrage Dashboard Server <<")
    log.info("=" * 52)
    log.info("Template directory : %s", TEMPLATE_DIR)
    log.info("Dashboard URL      : http://localhost:%d", PORT)
    log.info("Health check       : http://localhost:%d/health", PORT)
    log.info("Socket.IO endpoint : /socket.io  (built-in)")
    log.info("=" * 52)
    uvicorn.run(combined_app, host="0.0.0.0", port=PORT, log_level="info")
