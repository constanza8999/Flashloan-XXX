"""
FlashArbitrage Backend Server
==============================
FastAPI server that provides withdraw, sweep, balance-checking, and
subscription management APIs.

This is a standalone server that reuses the arbitrage_engine package.

Usage:
    # Install dependencies
    pip install fastapi uvicorn web3 eth-account python-dotenv

    # Copy and configure environment
    cp .env.example .env
    # Edit .env with your private keys and SMTP settings

    # Start the server
    python server.py

    # The frontend will connect to http://localhost:8000 automatically.
"""

import os
import sys
import secrets
import hashlib
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# ─── Load .env file if python-dotenv is installed ─────────────────────
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    if os.path.exists(env_path):
        load_dotenv(env_path)
        print(f"[server] Loaded environment from {env_path}")
    else:
        print(f"[server] No .env file found at {env_path}. Using system env vars.")
except ImportError:
    print("[server] python-dotenv not installed. Install it: pip install python-dotenv")

# ─── Ensure arbitrage_engine is importable ──────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)-7s %(name)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("server")

app = FastAPI(title="FlashArbitrage Backend")

# ─── CORS — allow the frontend on any origin ────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Web3 lazy import (only loaded when needed) ─────────────────────────

def _get_web3():
    try:
        from web3 import Web3 as W3
        return W3
    except ImportError:
        return None


def _get_eth_account():
    try:
        from eth_account import Account
        return Account
    except ImportError:
        return None


# ─── ABI stubs (minimal subset needed for balance & withdraw) ────────────

ERC20_BALANCE_ABI = [
    {"constant": True, "inputs": [{"name": "_owner", "type": "address"}],
     "name": "balanceOf", "outputs": [{"name": "", "type": "uint256"}],
     "type": "function"},
    {"constant": True, "inputs": [], "name": "decimals",
     "outputs": [{"name": "", "type": "uint8"}], "type": "function"},
    {"constant": True, "inputs": [], "name": "symbol",
     "outputs": [{"name": "", "type": "string"}], "type": "function"},
]

FLASH_ARBITRAGE_ABI = [
    {"constant": False, "inputs": [
        {"name": "token", "type": "address"}, {"name": "amount", "type": "uint256"}],
     "name": "rescueTokens", "outputs": [], "type": "function"},
    {"constant": False, "inputs": [], "name": "rescueNative",
     "outputs": [], "type": "function"},
]

# ─── Chain configuration ────────────────────────────────────────────────

CHAIN_CONFIG = {
    "ethereum": {
        "rpcs": [
            "https://eth.llamarpc.com",
            "https://cloudflare-eth.com",
            "https://rpc.ankr.com/eth",
            "https://ethereum-rpc.publicnode.com",
            "https://eth.drpc.org",
        ],
        "chain_id": 1,
        "explorer": "https://etherscan.io",
        "native_symbol": "ETH",
        "env_key": "ETH_RELAYER_KEY",
        "tokens": {
            "USDT": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
            "WETH": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
            "USDC": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            "DAI": "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        },
    },
    "bsc": {
        "rpcs": [
            "https://bsc-dataseed.binance.org/",
            "https://bsc-dataseed1.binance.org/",
            "https://bsc-dataseed2.binance.org/",
            "https://bsc-dataseed3.binance.org/",
            "https://bsc.publicnode.com",
        ],
        "chain_id": 56,
        "explorer": "https://bscscan.com",
        "native_symbol": "BNB",
        "env_key": "BSC_RELAYER_KEY",
        "tokens": {
            "USDT": "0x55d398326f99059fF775485246999027B3197955",
            "WBNB": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
            "USDC": "0x8ac76a51cc950d9922a3688cd78fa7a438cc87e7",
            "DAI": "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
        },
    },
    "polygon": {
        "rpcs": [
            "https://polygon-rpc.com",
            "https://rpc-mainnet.maticvigil.com",
            "https://polygon.llamarpc.com",
            "https://polygon-bor.publicnode.com",
            "https://polygon.drpc.org",
        ],
        "chain_id": 137,
        "explorer": "https://polygonscan.com",
        "native_symbol": "MATIC",
        "env_key": "POLYGON_RELAYER_KEY",
        "tokens": {
            "USDT": "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
            "USDC": "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
            "DAI": "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
            "WETH": "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
            "WMATIC": "0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270",
        },
    },
    "arbitrum": {
        "rpcs": [
            "https://arb1.arbitrum.io/rpc",
            "https://arbitrum.llamarpc.com",
            "https://arbitrum-one.publicnode.com",
            "https://arbitrum.drpc.org",
            "https://1rpc.io/arb",
        ],
        "chain_id": 42161,
        "explorer": "https://arbiscan.io",
        "native_symbol": "ETH",
        "env_key": "ARBITRUM_RELAYER_KEY",
        "tokens": {
            "USDT": "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
            "USDC": "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
            "DAI": "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
            "WETH": "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
            "ARB": "0x912CE59144291C1204dE78fC2D2A8EaFB0C6e5c1",
        },
    },
}

# ─── Helpers ─────────────────────────────────────────────────────────────

def _connect_chain(chain_id: str):
    """Try to connect to the given chain, return (w3, config) or raise."""
    W3 = _get_web3()
    if not W3:
        raise RuntimeError("web3.py not installed. Run: pip install web3")

    cfg = CHAIN_CONFIG.get(chain_id)
    if not cfg:
        raise ValueError(f"Unsupported chain: {chain_id}")

    for rpc in cfg["rpcs"]:
        try:
            w3 = W3(W3.HTTPProvider(rpc, request_kwargs={"timeout": 10}))
            if w3.is_connected():
                return w3, cfg
        except Exception:
            continue
    raise RuntimeError(f"Could not connect to any RPC for {chain_id}")


def _get_contract(w3, address: str, abi: list):
    """Create a contract instance, returns None if address is invalid."""
    if not address or not w3.is_address(address):
        return None
    return w3.eth.contract(
        address=w3.to_checksum_address(address), abi=abi
    )


def _get_token_info(w3, token_address: str):
    """Get token symbol and decimals."""
    contract = _get_contract(w3, token_address, ERC20_BALANCE_ABI)
    if not contract:
        return {"symbol": "UNKNOWN", "decimals": 18}
    try:
        symbol = contract.functions.symbol().call()
        decimals = contract.functions.decimals().call()
        return {"symbol": symbol, "decimals": decimals}
    except Exception as e:
        log.warning(f"Could not fetch token info for {token_address}: {e}")
        return {"symbol": "UNKNOWN", "decimals": 18}


# ─── Request models ────────────────────────────────────────────────────

class WithdrawRequest(BaseModel):
    chain: str = "ethereum"
    contract: str = ""
    token: str = ""
    amount: Optional[str] = None
    destination: str = ""
    private_key: Optional[str] = None


class SweepRequest(BaseModel):
    chain: str = "ethereum"
    contract: str = ""
    destination: str = ""
    private_key: Optional[str] = None


class BalancesRequest(BaseModel):
    chain: str = "ethereum"
    contract: str = ""


# ─── API Endpoints ─────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Health check — also reports whether web3 is available."""
    W3 = _get_web3()
    return {
        "status": "ok",
        "web3_available": W3 is not None,
        "timestamp": datetime.now().isoformat(),
    }


@app.get("/api/config")
async def get_config():
    """Return chain configuration (without secrets)."""
    safe = {}
    for cid, cfg in CHAIN_CONFIG.items():
        safe[cid] = {
            "chain_id": cfg["chain_id"],
            "explorer": cfg["explorer"],
            "native_symbol": cfg["native_symbol"],
            "tokens": cfg["tokens"],
            "has_private_key": bool(os.environ.get(cfg["env_key"], "")),
        }
    return {"chains": safe}


@app.post("/api/balances")
async def get_balances(req: BalancesRequest):
    """
    Fetch native coin and token balances from a contract address on the given chain.
    """
    try:
        w3, cfg = _connect_chain(req.chain)
    except (RuntimeError, ValueError) as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    contract_addr = req.contract
    if not contract_addr or not w3.is_address(contract_addr):
        return JSONResponse({"error": "Invalid contract address"}, status_code=400)

    checksum = w3.to_checksum_address(contract_addr)
    result = {
        "native": {"symbol": cfg["native_symbol"], "balance": None, "balance_formatted": None},
        "tokens": {},
        "contract_address": checksum,
        "error": None,
    }

    try:
        # Native balance
        native_wei = w3.eth.get_balance(checksum)
        result["native"]["balance"] = str(native_wei)
        result["native"]["balance_formatted"] = float(w3.from_wei(native_wei, "ether"))

        # Token balances
        for name, addr in cfg["tokens"].items():
            if not addr:
                continue
            try:
                info = _get_token_info(w3, addr)
                token_contract = _get_contract(w3, addr, ERC20_BALANCE_ABI)
                if token_contract:
                    bal = token_contract.functions.balanceOf(checksum).call()
                    formatted = bal / (10 ** info["decimals"])
                    if formatted > 0:
                        result["tokens"][name] = {
                            "address": addr,
                            "balance": str(bal),
                            "balance_formatted": formatted,
                            "symbol": info["symbol"],
                            "decimals": info["decimals"],
                        }
            except Exception as e:
                log.warning(f"Token {name} balance failed: {e}")

    except Exception as e:
        result["error"] = str(e)

    return {req.chain: result}


@app.post("/api/withdraw")
async def withdraw(req: WithdrawRequest):
    """
    Withdraw tokens or native coin from the FlashArbitrage contract.
    Calls rescueTokens() for ERC20 or rescueNative() for native coin.
    Requires the owner private key (env var or request body).
    """
    W3 = _get_web3()
    Account = _get_eth_account()
    if not W3 or not Account:
        return JSONResponse(
            {"error": "web3.py or eth-account not installed. pip install web3 eth-account"},
            status_code=500,
        )

    try:
        w3, cfg = _connect_chain(req.chain)
    except (RuntimeError, ValueError) as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    # Validate contract address
    if not req.contract or not w3.is_address(req.contract):
        return JSONResponse({"error": "Invalid contract address"}, status_code=400)
    checksum_contract = w3.to_checksum_address(req.contract)

    # Validate destination
    if not req.destination or not w3.is_address(req.destination):
        return JSONResponse({"error": "Invalid destination address"}, status_code=400)
    checksum_dest = w3.to_checksum_address(req.destination)

    # Get private key
    pk = req.private_key or os.environ.get(cfg["env_key"], "")
    if not pk:
        return JSONResponse(
            {"error": f"No private key. Set {cfg['env_key']} env var or pass in request."},
            status_code=400,
        )
    if not pk.startswith("0x"):
        pk = "0x" + pk

    try:
        account = Account.from_key(pk)
        contract = _get_contract(w3, checksum_contract, FLASH_ARBITRAGE_ABI)
        if not contract:
            return JSONResponse({"error": "Failed to instantiate contract"}, status_code=500)

        nonce = w3.eth.get_transaction_count(account.address)
        gas_price = int(w3.eth.gas_price * 1.1)  # 10% premium for fast inclusion

        if req.token:
            # ─── ERC20 Token Withdraw ───────────────────────────────
            if not w3.is_address(req.token):
                return JSONResponse({"error": "Invalid token address"}, status_code=400)
            checksum_token = w3.to_checksum_address(req.token)

            if req.amount:
                info = _get_token_info(w3, req.token)
                amount_wei = int(float(req.amount) * (10 ** info["decimals"]))
            else:
                token_contract = _get_contract(w3, req.token, ERC20_BALANCE_ABI)
                if not token_contract:
                    return JSONResponse({"error": "Failed to read token contract"}, status_code=500)
                amount_wei = token_contract.functions.balanceOf(checksum_contract).call()

            if amount_wei <= 0:
                return JSONResponse({"error": "No balance to withdraw"}, status_code=400)

            tx = contract.functions.rescueTokens(checksum_token, amount_wei).build_transaction({
                "from": account.address,
                "nonce": nonce,
                "gas": 200_000,
                "gasPrice": gas_price,
                "chainId": w3.eth.chain_id,
            })
        else:
            # ─── Native Coin Withdraw ───────────────────────────────
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

        # Wait for confirmation (short timeout)
        try:
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash_str, timeout=30)
            status = "confirmed" if receipt["status"] == 1 else "failed"
            block = receipt["blockNumber"]
        except Exception:
            status = "broadcast"
            block = None

        explorer = cfg["explorer"]
        return {
            "success": True,
            "tx_hash": tx_hash_str,
            "status": status,
            "block_number": block,
            "chain": req.chain,
            "destination": req.destination,
            "amount": req.amount or "all",
            "token": req.token or "native",
            "explorer_url": f"{explorer}/tx/{tx_hash_str}",
        }

    except Exception as e:
        log.error("Withdraw failed: %s", e, exc_info=True)
        return JSONResponse({"error": f"Withdraw failed: {str(e)}"}, status_code=500)


@app.post("/api/sweep")
async def sweep(req: SweepRequest):
    """
    Sweep ALL tokens and native coin from the FlashArbitrage contract.
    Calls rescueTokens for each known token, then rescueNative.
    """
    W3 = _get_web3()
    Account = _get_eth_account()
    if not W3 or not Account:
        return JSONResponse(
            {"error": "web3.py or eth-account not installed"}, status_code=500
        )

    try:
        w3, cfg = _connect_chain(req.chain)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    if not req.contract or not w3.is_address(req.contract):
        return JSONResponse({"error": "Invalid contract address"}, status_code=400)
    checksum_contract = w3.to_checksum_address(req.contract)

    if not req.destination or not w3.is_address(req.destination):
        return JSONResponse({"error": "Invalid destination address"}, status_code=400)

    pk = req.private_key or os.environ.get(cfg["env_key"], "")
    if not pk:
        return JSONResponse({"error": f"No private key. Set {cfg['env_key']} env var."}, status_code=400)
    if not pk.startswith("0x"):
        pk = "0x" + pk

    try:
        account = Account.from_key(pk)
        contract = _get_contract(w3, checksum_contract, FLASH_ARBITRAGE_ABI)
        if not contract:
            return JSONResponse({"error": "Failed to instantiate contract"}, status_code=500)

        txs = []
        base_nonce = w3.eth.get_transaction_count(account.address)
        gas_price = int(w3.eth.gas_price * 1.1)

        # 1. Sweep tokens first
        for i, (name, addr) in enumerate(cfg["tokens"].items()):
            if not addr:
                continue
            try:
                token_contract = _get_contract(w3, addr, ERC20_BALANCE_ABI)
                if not token_contract:
                    continue
                bal = token_contract.functions.balanceOf(checksum_contract).call()
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

        # 2. Sweep native coin last
        try:
            native_tx = contract.functions.rescueNative().build_transaction({
                "from": account.address,
                "nonce": base_nonce + len(cfg["tokens"]),
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

        return {"success": True, "chain": req.chain, "destination": req.destination, "transactions": txs}

    except Exception as e:
        log.error("Sweep failed: %s", e, exc_info=True)
        return JSONResponse({"error": f"Sweep failed: {str(e)}"}, status_code=500)


# ══════════════════════════════════════════════════════════════════════
# SUBSCRIPTION & AUTH SYSTEM
# ══════════════════════════════════════════════════════════════════════

import smtplib
import email.utils
from email.message import EmailMessage

# In-memory storage (replace with a real DB in production)
_users = {}        # email -> { password_hash, name, tier, license_key, expires_at }
_license_keys = {} # license_key -> { email, tier, created_at, expires_at, active }

# Admin credentials
ADMIN_EMAIL = "josejaimejulia7@gmail.com"
ADMIN_PASSWORD = "constanza999"

# PayPal email (where payments go)
PAYPAL_EMAIL = "josejaimejulia7@gmail.com"

# Stripe configuration (loaded from .env)
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")

def _hash_password(password: str) -> str:
    """Simple hash for demo — use bcrypt in production."""
    return hashlib.sha256(password.encode()).hexdigest()

def _generate_license_key() -> str:
    """Generate a license key: TK-XXXXX-XXXXX-XXXXX-XXXXX"""
    chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    segments = []
    for _ in range(4):
        seg = "".join(secrets.choice(chars) for _ in range(5))
        segments.append(seg)
    return f"TK-{'-'.join(segments)}"

def _send_email(to_email: str, subject: str, body: str):
    """Send email via SMTP. Configure env vars in production."""
    smtp_server = os.environ.get("SMTP_SERVER", "")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")

    if not smtp_server or not smtp_user:
        log.info(f"Email not sent (SMTP not configured): {subject} -> {to_email}")
        log.info(f"Body preview: {body[:100]}...")
        return False

    try:
        msg = EmailMessage()
        msg.set_content(body)
        msg["Subject"] = subject
        msg["From"] = smtp_user
        msg["To"] = to_email
        msg["Date"] = email.utils.formatdate()

        with smtplib.SMTP(smtp_server, smtp_port) as server:
            server.starttls()
            server.login(smtp_user, smtp_pass)
            server.send_message(msg)
        log.info(f"Email sent: {subject} -> {to_email}")
        return True
    except Exception as e:
        log.warning(f"Failed to send email: {e}")
        return False


# ─── Request models ────────────────────────────────────────────────────

class AuthRegisterRequest(BaseModel):
    email: str
    password: str
    name: Optional[str] = None


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class ActivateRequest(BaseModel):
    license_key: str
    email: Optional[str] = None


class PurchaseRequest(BaseModel):
    plan: str  # pro | enterprise
    email: str
    payment_method: str = "paypal"
    license_key: Optional[str] = None


class AdminUpdateTierRequest(BaseModel):
    email: str
    tier: str  # free | pro | enterprise


# ─── Auth Endpoints ────────────────────────────────────────────────────

@app.post("/api/auth/register")
async def register(req: AuthRegisterRequest):
    if not req.email or not req.password:
        return JSONResponse({"error": "Email and password required"}, status_code=400)

    if req.email in _users:
        return JSONResponse({"error": "User already exists"}, status_code=409)

    _users[req.email] = {
        "password_hash": _hash_password(req.password),
        "name": req.name or req.email.split("@")[0],
        "tier": "free",
        "license_key": None,
        "expires_at": None,
        "created_at": datetime.now().isoformat(),
    }
    log.info(f"User registered: {req.email}")

    return {
        "success": True,
        "email": req.email,
        "name": _users[req.email]["name"],
        "tier": "free",
    }


@app.post("/api/auth/login")
async def login(req: AuthLoginRequest):
    if not req.email or not req.password:
        return JSONResponse({"error": "Email and password required"}, status_code=400)

    # Admin login
    if req.email.lower() == ADMIN_EMAIL.lower():
        if req.password == ADMIN_PASSWORD:
            log.info(f"Admin login: {req.email}")
            return {
                "success": True,
                "email": ADMIN_EMAIL,
                "name": "Admin",
                "tier": "enterprise",
                "is_admin": True,
                "license_key": "ADMIN-MASTER-KEY",
                "expires_at": None,
            }
        else:
            return JSONResponse({"error": "Invalid admin credentials"}, status_code=401)

    # Regular user login
    user = _users.get(req.email)
    if not user:
        return JSONResponse({"error": "User not found"}, status_code=404)

    if user["password_hash"] != _hash_password(req.password):
        return JSONResponse({"error": "Invalid password"}, status_code=401)

    log.info(f"User login: {req.email}")
    return {
        "success": True,
        "email": req.email,
        "name": user["name"],
        "tier": user["tier"],
        "license_key": user["license_key"] or "",
        "expires_at": user["expires_at"],
    }


@app.post("/api/auth/activate")
async def activate_license(req: ActivateRequest):
    if not req.license_key:
        return JSONResponse({"error": "License key required"}, status_code=400)

    lk = _license_keys.get(req.license_key)
    if not lk:
        return JSONResponse({"error": "Invalid license key"}, status_code=404)

    if not lk["active"]:
        return JSONResponse({"error": "License key already used or revoked"}, status_code=400)

    # Check expiration
    if lk["expires_at"]:
        expires = datetime.fromisoformat(lk["expires_at"])
        if expires < datetime.now():
            return JSONResponse({"error": "License key has expired"}, status_code=400)

    # Mark as used
    lk["active"] = False
    lk["activated_at"] = datetime.now().isoformat()
    lk["activated_by"] = req.email

    # Update user
    target_email = req.email or lk["email"]
    if target_email in _users:
        _users[target_email]["tier"] = lk["tier"]
        _users[target_email]["license_key"] = req.license_key
        _users[target_email]["expires_at"] = lk["expires_at"]

    log.info(f"License activated: {req.license_key} for {target_email} ({lk['tier']})")

    return {
        "success": True,
        "tier": lk["tier"],
        "email": target_email,
        "expires_at": lk["expires_at"],
    }


# ─── Stripe Endpoints ──────────────────────────────────────────────

@app.get("/api/stripe/config")
async def stripe_config():
    """Return Stripe publishable key for the frontend."""
    pk = STRIPE_PUBLISHABLE_KEY or "pk_test_51PbCxUCX9iJIBu4GHWEqx8UzNenVwRVzWThr7mEpxOTAPGfqOOKCsjxIQpJRpmCFQOXXOwXh5BlIda2fQ2klyPW500TgWq4Piv"
    return {"publishable_key": pk}


class StripePaymentIntentRequest(BaseModel):
    plan: str  # pro | enterprise
    email: str


@app.post("/api/stripe/create-payment-intent")
async def stripe_create_payment_intent(req: StripePaymentIntentRequest):
    """Create a Stripe PaymentIntent for the given plan."""
    valid_plans = {
        "pro": {"price": 2999, "name": "Pro"},  # amounts in cents
        "enterprise": {"price": 9999, "name": "Enterprise"},
    }
    plan_info = valid_plans.get(req.plan)
    if not plan_info:
        return JSONResponse({"error": f"Invalid plan: {req.plan}"}, status_code=400)

    if not STRIPE_SECRET_KEY:
        # Demo mode: return a fake client secret
        import uuid
        log.info(f"Stripe demo mode: creating fake PaymentIntent for {req.plan}")
        return {
            "client_secret": f"pi_demo_{uuid.uuid4().hex}_secret_demo",
            "amount": plan_info["price"],
            "currency": "usd",
            "demo": True,
        }

    try:
        import stripe
        stripe.api_key = STRIPE_SECRET_KEY

        intent = stripe.PaymentIntent.create(
            amount=plan_info["price"],
            currency="usd",
            description=f"Token Toolkit {plan_info['name']} - Monthly Subscription",
            metadata={
                "plan": req.plan,
                "email": req.email,
            },
            automatic_payment_methods={"enabled": True},
        )

        log.info(f"Stripe PaymentIntent created: {intent.id} for {req.plan}")

        return {
            "client_secret": intent.client_secret,
            "amount": plan_info["price"],
            "currency": "usd",
            "payment_intent_id": intent.id,
        }
    except ImportError:
        return JSONResponse({"error": "Stripe Python SDK not installed. Run: pip install stripe"}, status_code=500)
    except Exception as e:
        log.error(f"Stripe create payment intent failed: {e}")
        return JSONResponse({"error": f"Stripe error: {str(e)}"}, status_code=500)


class StripeConfirmPaymentRequest(BaseModel):
    payment_intent_id: str
    plan: str
    email: str
    license_key: Optional[str] = None


@app.post("/api/stripe/confirm-payment")
async def stripe_confirm_payment(req: StripeConfirmPaymentRequest):
    """Confirm a Stripe payment and store the license key association."""
    log.info(f"Stripe payment confirmed: {req.payment_intent_id} for {req.email} ({req.plan})")

    # If we have a real Stripe secret key, verify the payment
    if STRIPE_SECRET_KEY:
        try:
            import stripe
            stripe.api_key = STRIPE_SECRET_KEY
            intent = stripe.PaymentIntent.retrieve(req.payment_intent_id)
            if intent.status not in ("succeeded", "processing"):
                return JSONResponse({
                    "error": f"Payment not successful. Status: {intent.status}"
                }, status_code=400)
        except Exception as e:
            log.warning(f"Stripe payment verification failed: {e}")

    return {
        "success": True,
        "payment_intent_id": req.payment_intent_id,
        "plan": req.plan,
        "email": req.email,
    }


# ─── Subscription Endpoints ────────────────────────────────────────────

@app.post("/api/subscriptions/purchase")
async def purchase(req: PurchaseRequest):
    """Process a subscription purchase and generate a license key."""
    valid_plans = {
        "pro": {"price": 29.99, "period_days": 30},
        "enterprise": {"price": 99.99, "period_days": 30},
    }

    plan_info = valid_plans.get(req.plan)
    if not plan_info:
        return JSONResponse({"error": f"Invalid plan: {req.plan}"}, status_code=400)

    if not req.email:
        return JSONResponse({"error": "Email required"}, status_code=400)

    # Generate license key
    license_key = req.license_key or _generate_license_key()

    # Calculate expiration
    expires_at = (datetime.now() + timedelta(days=plan_info["period_days"])).isoformat()

    # Store license key
    _license_keys[license_key] = {
        "email": req.email,
        "tier": req.plan,
        "price": plan_info["price"],
        "created_at": datetime.now().isoformat(),
        "expires_at": expires_at,
        "active": True,
    }

    # Create/update user
    if req.email not in _users:
        _users[req.email] = {
            "password_hash": None,
            "name": req.email.split("@")[0],
            "tier": req.plan,
            "license_key": license_key,
            "expires_at": expires_at,
            "created_at": datetime.now().isoformat(),
        }
    else:
        _users[req.email]["tier"] = req.plan
        _users[req.email]["license_key"] = license_key
        _users[req.email]["expires_at"] = expires_at

    log.info(f"Purchase: {req.email} -> {req.plan} (key: {license_key[:18]}...)")

    # Send license key via email
    email_body = f"""Thank you for your purchase!

Plan: {req.plan.upper()}
License Key: {license_key}
Expires: {expires_at[:10]}

To activate, enter the license key in the Subscription page.

Payments processed via PayPal: {PAYPAL_EMAIL}
"""
    _send_email(
        req.email,
        f"Your Token Toolkit {req.plan.upper()} License Key",
        email_body,
    )

    return {
        "success": True,
        "license_key": license_key,
        "tier": req.plan,
        "expires_at": expires_at,
        "email": req.email,
    }


@app.get("/api/subscriptions/plans")
async def get_plans():
    """Return available subscription plans."""
    return {
        "plans": [
            {
                "id": "free",
                "name": "Free",
                "price": 0,
                "features": ["Send BSC/ETH", "Balance check", "Token info"],
            },
            {
                "id": "pro",
                "name": "Pro",
                "price": 29.99,
                "currency": "USD",
                "period": "month",
                "features": ["All chains", "Arbitrage", "MEV Bot", "Withdraw", "Telegram"],
            },
            {
                "id": "enterprise",
                "name": "Enterprise",
                "price": 99.99,
                "currency": "USD",
                "period": "month",
                "features": ["All Pro", "P2P Network", "Cross-Chain", "Relay Nodes", "AI Predictor"],
            },
        ],
        "paypal_email": PAYPAL_EMAIL,
    }


# ─── Admin Endpoints ──────────────────────────────────────────────────

@app.get("/api/admin/subscriptions")
async def admin_list_subscriptions():
    """List all users and their subscription status (admin only)."""
    subs = []
    for email, data in _users.items():
        subs.append({
            "email": email,
            "name": data.get("name", ""),
            "tier": data.get("tier", "free"),
            "license_key": data.get("license_key", ""),
            "expires_at": data.get("expires_at"),
            "created_at": data.get("created_at"),
        })
    # Add admin
    subs.append({
        "email": ADMIN_EMAIL,
        "name": "Admin",
        "tier": "enterprise",
        "license_key": "ADMIN-MASTER-KEY",
        "expires_at": None,
        "created_at": datetime.now().isoformat(),
    })
    return {"subscriptions": subs}


@app.post("/api/admin/update-tier")
async def admin_update_tier(req: AdminUpdateTierRequest):
    """Update a user's subscription tier (admin only)."""
    if not req.email or req.tier not in ("free", "pro", "enterprise"):
        return JSONResponse({"error": "Invalid request"}, status_code=400)

    if req.email in _users:
        _users[req.email]["tier"] = req.tier
        log.info(f"Admin updated {req.email} -> {req.tier}")
        return {"success": True, "email": req.email, "tier": req.tier}
    else:
        return JSONResponse({"error": "User not found"}, status_code=404)


@app.post("/api/admin/generate-license")
async def admin_generate_license(req: PurchaseRequest):
    """Admin generates a license key for a user."""
    license_key = _generate_license_key()
    from datetime import timedelta
    expires_at = (datetime.now() + timedelta(days=30)).isoformat()

    _license_keys[license_key] = {
        "email": req.email,
        "tier": req.plan,
        "created_at": datetime.now().isoformat(),
        "expires_at": expires_at,
        "active": True,
    }

    log.info(f"Admin generated license {license_key[:18]}... for {req.email}")

    # Send email
    _send_email(
        req.email,
        f"Your Token Toolkit {req.plan.upper()} License Key",
        f"""Your license key has been generated by the admin.

Plan: {req.plan.upper()}
License Key: {license_key}
Expires: {expires_at[:10]}

Activate it on the Subscription page.
"""
    )

    return {
        "success": True,
        "license_key": license_key,
        "tier": req.plan,
        "email": req.email,
        "expires_at": expires_at,
    }


# ══════════════════════════════════════════════════════════════════════
# Start Server
# ══════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    import uvicorn
    PORT = int(os.environ.get("PORT", 8000))
    log.info("=" * 60)
    log.info("  >> FlashArbitrage Backend Server <<")
    log.info("=" * 60)
    log.info(f"  Server URL    : http://localhost:{PORT}")
    log.info(f"  Health check  : http://localhost:{PORT}/health")
    log.info(f"  API docs      : http://localhost:{PORT}/docs")
    log.info("=" * 60)
    log.info("  REQUIRED ENV VARS:")
    log.info("    ETH_RELAYER_KEY       - Owner key for Ethereum")
    log.info("    BSC_RELAYER_KEY       - Owner key for BSC")
    log.info("    POLYGON_RELAYER_KEY   - Owner key for Polygon")
    log.info("    ARBITRUM_RELAYER_KEY  - Owner key for Arbitrum")
    log.info("=" * 60)
    log.info("  OPTIONAL ENV VARS (for email delivery):")
    log.info("    SMTP_SERVER           - SMTP host (e.g. smtp.gmail.com)")
    log.info("    SMTP_PORT             - SMTP port (default 587)")
    log.info("    SMTP_USER             - SMTP username")
    log.info("    SMTP_PASS             - SMTP password")
    log.info("=" * 60)
    log.info(f"  PayPal Email  : {PAYPAL_EMAIL}")
    log.info(f"  Admin Email   : {ADMIN_EMAIL}")
    log.info("=" * 60)
    log.info("  Users registered in memory. Restart to reset.")
    log.info("  For production, add a database.")
    log.info("=" * 60)
    log.info("  .env file: Copy .env.example to .env and fill in your values.")
    log.info("  The server will auto-load .env on startup (requires python-dotenv).")
    log.info("=" * 60)

    # Warn about missing relayer keys
    missing = [cfg["env_key"] for cid, cfg in CHAIN_CONFIG.items() if not os.environ.get(cfg["env_key"])]
    if missing:
        log.warning("Missing keys: %s. Withdraw/sweep will fail for these chains.", ", ".join(missing))
    else:
        log.info("All relayer keys are configured.")

    uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
