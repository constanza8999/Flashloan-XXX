import os
import sys
import time
import argparse
from datetime import datetime

from web3 import Web3
from eth_account import Account
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.live import Live
from rich.theme import Theme
from decimal import Decimal, getcontext

getcontext().prec = 60

# Configuración de Tema Profesional
custom_theme = Theme({
    "info": "cyan",
    "warning": "yellow",
    "error": "bold red",
    "success": "bold green",
    "header": "bold magenta",
})

console = Console(theme=custom_theme)

# ---------------------------------------------------------------------------
# Configuración de Redes y Contratos
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

ETH_PROTECT_RPC = "https://rpc.flashbots.net"

# Direcciones de Contratos USDT (Corregido)
BSC_USDT = "0x55d398326f99059fF775485246999027B3197955"
ETH_USDT = "0xdAC17F958D2ee523a2206206994597C13D831ec7"

BSC_CHAIN_ID = 56
ETH_CHAIN_ID = 1

TRANSFER_SELECTOR = "a9059cbb"
DEFAULT_BSC_GAS = 100_000
DEFAULT_ETH_GAS = 100_000

# Destinatario por defecto del bot automatizado de envíos a BSC USDT.
# Solicitud del usuario: envíos automatizados a esta dirección.
DEFAULT_BOT_RECIPIENT = "0x9850f7eEAbe8E4FfF2662652aFF28b3De14C53F6"

# ABI mínima para tokens ERC20/BEP20 (decimals, symbol, balanceOf)
ERC20_ABI = [
    {
        "constant": True,
        "inputs": [],
        "name": "decimals",
        "outputs": [{"name": "", "type": "uint8"}],
        "type": "function",
        "stateMutability": "view",
    },
    {
        "constant": True,
        "inputs": [],
        "name": "symbol",
        "outputs": [{"name": "", "type": "string"}],
        "type": "function",
        "stateMutability": "view",
    },
    {
        "constant": True,
        "inputs": [{"name": "_owner", "type": "address"}],
        "name": "balanceOf",
        "outputs": [{"name": "balance", "type": "uint256"}],
        "type": "function",
        "stateMutability": "view",
    },
]



# Tokens BEP20 populares (Binance Smart Chain mainnet)
POPULAR_BEP20 = {
    "USDT": "0x55d398326f99059fF775485246999027B3197955",
    "USDC": "0x8ac76a51cc950d9922a3688cd78fa7a438cc87e7",
    "BUSD": "0xe9e7cea3dedca5984780bafc599bd70ad0889439",
    "DAI":  "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3",
    "BTCB": "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    "ETH":  "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
    "WBNB": "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "CAKE": "0x0E09FaBB73bd3aDe0a17ECC321fD13a19e81d82F",
    "XRP":  "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE",
    "ADA":  "0x3EE2200Efb3400fAbB9A4F7d4c4F87b1acF4A091",
    "DOGE": "0xbA2aE424d96c24cA7021aeFA44901958Df5477aA",
    "DOT":  "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402",
    "LINK": "0xF8A0BF9cF54Bb92F17374d9e9A321E6f111A0B18",
    "MATIC":"0xCC42724C6683B7E573F7d1e4A4120f3aD4E4C5bA",
}

# Tokens ERC20 populares (Ethereum mainnet)
POPULAR_ERC20 = {
    "USDT": "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    "USDC": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "DAI":  "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    "WETH": "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    "WBTC": "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
    "stETH":"0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",
    "USDS": "0xdC035D45d8E79868B3CC61c8d68c6c1FE3b9bDa1",
    "UNI":  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
    "LINK": "0x514910771AF9Ca656af840dff83E8264EcF986CA",
    "AAVE": "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DcE09",
}

# Mapa cadena → catálogo de símbolos populares
CHAIN_TOKEN_MAP = {
    "bsc": POPULAR_BEP20,
    "eth": POPULAR_ERC20,
}

# Decimales por símbolo dentro del catálogo de cada cadena. La dirección
# siempre viene de CHAIN_TOKEN_MAP, así que añadir tokens a los catálogos
# mantiene el caché de decimales sincronizado automáticamente.
_TOKEN_DECIMALS = {
    "bsc": {
        "USDT": 18, "USDC": 18, "BUSD": 18, "DAI": 18,
        "WBNB": 18, "BTCB": 18, "ETH": 18, "LINK": 18,
        "CAKE": 18, "MATIC": 18,
        "XRP": 6, "ADA": 6,
        "DOGE": 8, "DOT": 10,
    },
    "eth": {
        "USDT": 6, "USDC": 6, "DAI": 18, "WETH": 18,
        "WBTC": 8, "stETH": 18, "USDS": 18,
        "UNI": 18, "LINK": 18, "AAVE": 18,
    },
}

# Cache de decimales indexado por dirección en minúsculas.
KNOWN_TOKEN_DECIMALS = {}
for _chain, _decimals_map in _TOKEN_DECIMALS.items():
    _catalog = CHAIN_TOKEN_MAP.get(_chain, {})
    for _symbol, _decimals in _decimals_map.items():
        _addr = _catalog.get(_symbol)
        if _addr:
            KNOWN_TOKEN_DECIMALS[_addr.lower()] = _decimals

# ---------------------------------------------------------------------------
# Utilidades de Interfaz de Usuario
# ---------------------------------------------------------------------------

def display_banner():
    console.print(Panel.fit(
        "[bold magenta]Multi-chain ERC20/BEP20 Transfer Toolkit[/bold magenta]\n"
        "[italic white]System Terminal Interface - Ready[/italic white]",
        border_style="magenta"
    ))

def print_config(chain, to, amount, priority, max_fee, gas_limit, symbol="USDT", token=None, amount_wei=None, decimals=None, dry_run=False):
    title = "Configuración de la Transacción" + (" (DRY-RUN)" if dry_run else "")
    table = Table(title=title, show_header=True, header_style="bold cyan")
    table.add_column("Parámetro", style="dim")
    table.add_column("Valor")

    table.add_row("Red", chain.upper())
    if token:
        table.add_row("Contrato Token", token)
    table.add_row("Símbolo", symbol)
    table.add_row("Decimales del token", str(decimals) if decimals is not None else "(desconocido)")
    table.add_row("Destinatario", to)
    table.add_row("Monto (humano)", f"{amount} {symbol}")

    if amount_wei is not None:
        try:
            wei_int = int(amount_wei)
            hex_padded = "0x" + format(wei_int, "x").rjust(64, "0")
        except (TypeError, ValueError):
            hex_padded = "(no representable)"

        table.add_row("Monto (wei / uint256)", f"{amount_wei}")
        table.add_row("Monto (hex 32 bytes)", hex_padded)

    # Verificación cruzada A: interna (amount vs amount_wei vs decimals reportados).
    cross_msgs = []
    if amount_wei is not None and decimals is not None:
        try:
            expected = int(Decimal(str(amount)) * Decimal(10) ** decimals)
            if expected == int(amount_wei):
                cross_msgs.append(f"[green]OK[/green] monto esperado={expected} wei coincide")
            else:
                ratio = (int(amount_wei) / expected) if expected else float("inf")
                cross_msgs.append(
                    f"[bold red]¡MISMATCH![/bold red] esperado={expected} wei, "
                    f"codificado={int(amount_wei)} wei (ratio={ratio:.3g}). "
                    f"Probable bug de decimales."
                )
        except Exception as e:
            cross_msgs.append(f"[warning]No se pudo recomputar: {e}[/warning]")

    # Verificación cruzada B: externa (los decimales reportados frente a los
    # que el contrato declara en cache). Detecta --decimals 9 aplicado a un
    # token BSC USDT de 18 decimales (factor 1e9 exacto que hemos visto).
    # Se ejecuta aunque amount_wei no esté disponible, porque sólo requiere
    # `token` y `decimals`.
    if token and decimals is not None:
        contract_decimals = KNOWN_TOKEN_DECIMALS.get(Web3.to_checksum_address(token).lower())
        if contract_decimals is not None and contract_decimals != decimals:
            cross_msgs.append(
                f"[bold red]Decimales discrepantes[/bold red] "
                f"usuario/CLI={decimals}, contrato declara={contract_decimals}. "
                f"¿Estás seguro de sobreescribir con --decimals?"
            )

    if cross_msgs:
        table.add_row("Verificación cruzada", "\n".join(cross_msgs))

    table.add_row("Prioridad (Gwei)", str(priority))
    table.add_row("Tarifa Máxima (Gwei)", str(max_fee) if max_fee else "Auto")
    table.add_row("Límite de Gas", f"{gas_limit:,}")

    console.print(table)

# ---------------------------------------------------------------------------
# Lógica de Conexión y Transacción
# ---------------------------------------------------------------------------

def connect(rpcs, timeout=10):
    with console.status("[bold info]Estableciendo conexión con nodos RPC...", spinner="dots"):
        for rpc in rpcs:
            try:
                w3 = Web3(Web3.HTTPProvider(rpc, request_kwargs={"timeout": timeout}))
                if w3.is_connected():
                    console.print(f"[success]Conexión exitosa:[/success] {rpc}")
                    return w3
            except Exception:
                continue
    console.print("[error]Error: No se pudo conectar a ningún proveedor RPC.[/error]")
    sys.exit(1)

def load_key(env_name):
    key = os.environ.get(env_name)
    if not key:
        console.print(f"[error]Error: La variable de entorno {env_name} no está configurada.[/error]")
        sys.exit(1)
    key = key.strip()
    if not key.startswith("0x"):
        key = "0x" + key
    if len(key) != 66:
        console.print(f"[error]Error: {env_name} no es una clave privada válida de 32 bytes.[/error]")
        sys.exit(1)
    return key

def encode_transfer(to, amount_wei):
    to = Web3.to_checksum_address(to)
    return (
        TRANSFER_SELECTOR
        + to[2:].lower().rjust(64, "0")
        + format(amount_wei, "x").rjust(64, "0")
    )

def _token_contract(w3, address):
    return w3.eth.contract(
        address=Web3.to_checksum_address(address),
        abi=ERC20_ABI,
    )

def get_token_decimals(w3, token_address, fallback=18):
    """Consulta `decimals()` del contrato; usa fallback o cache si falla."""
    key = token_address.lower()
    if key in KNOWN_TOKEN_DECIMALS:
        return KNOWN_TOKEN_DECIMALS[key]
    try:
        return int(_token_contract(w3, token_address).functions.decimals().call())
    except Exception as e:
        console.print(f"[warning]No se pudo leer decimals() (usando {fallback}): {e}[/warning]")
        return fallback

def get_token_symbol(w3, token_address, fallback="TOKEN"):
    try:
        sym = _token_contract(w3, token_address).functions.symbol().call()
        return sym or fallback
    except Exception:
        return fallback

def get_token_balance(w3, token_address, holder):
    try:
        return int(_token_contract(w3, token_address).functions.balanceOf(
            Web3.to_checksum_address(holder)
        ).call())
    except Exception as e:
        console.print(f"[warning]No se pudo leer balanceOf(): {e}[/warning]")
        return None

def to_wei(amount, decimals):
    """Convierte amount (str|float|Decimal|int) a wei usando Decimal puro.

    `str` es la vía más segura para evitar que silenciosamente se interprete
    como float notación científica tipo '5e-5'. CLI debe pasar siempre str.
    """
    return int(Decimal(str(amount)) * Decimal(10) ** decimals)

def resolve_token(arg, chain):
    """Resuelve un argumento --token según el catálogo de la cadena dada.

    chain: "bsc" | "eth"
    """
    if not arg or not arg.strip():
        catalog = CHAIN_TOKEN_MAP.get(chain, {})
        symbols = ", ".join(sorted(catalog.keys())) if catalog else "ninguno"
        console.print(f"[error]--token está vacío. Indique una dirección 0x... "
                      f"o un símbolo popular {chain.upper()} conocido ({symbols}).[/error]")
        sys.exit(1)
    key = arg.strip()
    catalog = CHAIN_TOKEN_MAP.get(chain, {})
    if key.upper() in catalog:
        return Web3.to_checksum_address(catalog[key.upper()])
    if not Web3.is_address(key):
        console.print(f"[error]--token no es una dirección Ethereum válida: {key!r}[/error]")
        sys.exit(1)
    return Web3.to_checksum_address(key)

def estimate_eip1559(w3, priority_gwei, max_fee_gwei=None):
    """Estima (priority_fee_per_gas, max_fee_per_gas) en wei.

    Si --max-fee-gwei viene del usuario, se respeta. Si no, se lee
    base_fee del último bloque; si falla, asume 5 Gwei (conservador para
    BSC, oscila 3-15 Gwei típicamente). Para ETH mainnet, conviene
    sobreescribir con --max-fee-gwei >= 10.
    """
    priority = w3.to_wei(priority_gwei, "gwei")
    if max_fee_gwei is not None:
        return priority, w3.to_wei(max_fee_gwei, "gwei")

    try:
        block = w3.eth.get_block("latest")
        base_fee = block.get("baseFeePerGas", w3.to_wei(5, "gwei"))
    except Exception:
        base_fee = w3.to_wei(5, "gwei")
    return priority, int(base_fee) + priority

# ---------------------------------------------------------------------------
# Comandos de Ejecución
# ---------------------------------------------------------------------------

def send_bsc_token(to, amount, token_address=None, decimals=None, priority_gwei=1.0, max_fee_gwei=None, gas_limit=DEFAULT_BSC_GAS, dry_run=False, quiet=False):
    """Envía cualquier token BEP20/ERC20 en BSC. Por defecto USDT.

    dry_run=True: construye la transacción y la muestra sin transmitirla.
    quiet=True:    suprime banner y tabla de configuración (usado por el bot).
    Devuelve el hash hex de la transacción ("0x...") o None si fue dry-run.
    """
    if not quiet:
        display_banner()
    token_address = token_address or BSC_USDT
    w3 = connect(BSC_RPCS)

    symbol = get_token_symbol(w3, token_address)
    decimals = decimals if decimals is not None else get_token_decimals(w3, token_address)
    # str() preserva precisión exacta (evita float64 → Decimal perdiendo dígitos).
    amount = str(amount)
    amount_wei = to_wei(amount, decimals)

    pk = load_key("BSC_PRIVATE_KEY")
    sender = Account.from_key(pk).address

    # Estimar fee y verificar saldo BNB antes de firmar (evita intentos
    # inútiles si el fee estimado excede el saldo de la wallet).
    priority, max_fee = estimate_eip1559(w3, priority_gwei, max_fee_gwei)
    estimated_fee_wei = max_fee * gas_limit
    try:
        balance_wei = w3.eth.get_balance(sender)
    except Exception as e:
        console.print(f"[warning]No se pudo leer saldo BNB; continuando sin verificación: {e}[/warning]")
        balance_wei = None

    if balance_wei is not None and balance_wei < estimated_fee_wei:
        balance_bnb = balance_wei / 1e18
        fee_bnb = estimated_fee_wei / 1e18
        deficit_wei = estimated_fee_wei - balance_wei
        console.print("[error]Saldo BNB insuficiente para el fee estimado.[/error]")
        console.print(f"  Saldo actual:    {balance_bnb:.6f} BNB  ({balance_wei} wei)")
        console.print(f"  Fee estimado:    {fee_bnb:.6f} BNB  ({estimated_fee_wei} wei)")
        console.print(f"  Faltan:          {deficit_wei / 1e18:.6f} BNB  ({deficit_wei} wei)")
        console.print("[dim]Sugerencias: --max-fee-gwei más bajo, --gas-limit más bajo, o recarga BNB.[/dim]")
        sys.exit(1)

    nonce = w3.eth.get_transaction_count(sender)
    if not quiet:
        print_config("BSC", to, amount, priority_gwei, max_fee_gwei, gas_limit,
                     symbol=symbol, token=token_address, amount_wei=amount_wei,
                     decimals=decimals, dry_run=dry_run)

    tx = {
        "to": Web3.to_checksum_address(token_address),
        "value": 0,
        "gas": gas_limit,
        "nonce": nonce,
        "chainId": BSC_CHAIN_ID,
        "maxPriorityFeePerGas": priority,
        "maxFeePerGas": max_fee,
        "data": encode_transfer(to, amount_wei),
    }

    if dry_run:
        if not quiet:
            console.print(Panel(
                f"[bold yellow]DRY-RUN[/bold yellow]: transacción construida pero NO enviada.\n\n"
                f"Token: {symbol} ({token_address})\n"
                f"Destino: {to}\n"
                f"Monto (wei): {amount_wei}\n"
                f"From: {sender}\n"
                f"Nonce: {nonce}\n"
                f"maxFeePerGas: {max_fee} ({max_fee / 1e9:.2f} gwei)\n"
                f"Priority fee: {priority} ({priority / 1e9:.2f} gwei)\n"
                f"Gas limit: {gas_limit}",
                title="Estado BSC (simulado)", border_style="yellow"
            ))
        return None

    signed = Account.sign_transaction(tx, pk)

    with console.status(f"[bold yellow]Transmitiendo {symbol} en BSC...", spinner="earth"):
        raw_tx = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
        tx_hash = w3.eth.send_raw_transaction(raw_tx)

    h = "0x" + tx_hash.hex()
    if not quiet:
        console.print(Panel(
            f"[bold success]Transacción Enviada Correctamente[/bold success]\n\n"
            f"Token: {symbol} ({token_address})\n"
            f"Hash: [white]{h}[/white]\n"
            f"Explorador: [link=https://bscscan.com/tx/{h}]https://bscscan.com/tx/{h}[/link]",
            title="Estado BSC", border_style="green"
        ))
    return h

# Wrapper de compatibilidad (mantiene el comportamiento USDT original)
def send_bsc_usdt(to, amount, priority_gwei=1.0, max_fee_gwei=None, gas_limit=DEFAULT_BSC_GAS, dry_run=False):
    send_bsc_token(to, amount, BSC_USDT, 18, priority_gwei, max_fee_gwei, gas_limit, dry_run)

def send_eth_token(to, amount, token_address=None, decimals=None, priority_gwei=1.0, max_fee_gwei=None, gas_limit=DEFAULT_ETH_GAS, dry_run=False):
    """Envía cualquier token ERC20 en Ethereum vía Flashbots Protect. Por defecto USDT.

    dry_run=True: construye la transacción y la muestra sin transmitirla.
    """
    display_banner()
    token_address = token_address or ETH_USDT
    w3 = connect(ETH_RPCS)

    symbol = get_token_symbol(w3, token_address)
    decimals = decimals if decimals is not None else get_token_decimals(w3, token_address)
    amount = str(amount)
    amount_wei = to_wei(amount, decimals)

    pk = load_key("ETH_PRIVATE_KEY")
    sender = Account.from_key(pk).address

    # Sin comprobaciones de saldo: se transmite directamente.
    nonce = w3.eth.get_transaction_count(sender)
    priority, max_fee = estimate_eip1559(w3, priority_gwei, max_fee_gwei)

    print_config("Ethereum", to, amount, priority_gwei, max_fee_gwei, gas_limit,
                 symbol=symbol, token=token_address, amount_wei=amount_wei,
                 decimals=decimals, dry_run=dry_run)

    tx = {
        "to": Web3.to_checksum_address(token_address),
        "value": 0,
        "gas": gas_limit,
        "nonce": nonce,
        "chainId": ETH_CHAIN_ID,
        "maxPriorityFeePerGas": priority,
        "maxFeePerGas": max_fee,
        "data": encode_transfer(to, amount_wei),
    }

    if dry_run:
        console.print(Panel(
            f"[bold yellow]DRY-RUN[/bold yellow]: transacción construida pero NO enviada (Flashbots).\n\n"
            f"Token: {symbol} ({token_address})\n"
            f"Destino: {to}\n"
            f"Monto (wei): {amount_wei}\n"
            f"From: {sender}\n"
            f"Nonce: {nonce}\n"
            f"maxFeePerGas: {max_fee} ({max_fee / 1e9:.4f} gwei)",
            title="Estado Ethereum (simulado)", border_style="yellow"
        ))
        return

    signed = Account.sign_transaction(tx, pk)

    with console.status(f"[bold yellow]Transmitiendo {symbol} vía Flashbots...", spinner="pulse"):
        protect_w3 = Web3(Web3.HTTPProvider(ETH_PROTECT_RPC))
        raw_tx = signed.rawTransaction if hasattr(signed, 'rawTransaction') else signed.raw_transaction
        tx_hash = protect_w3.eth.send_raw_transaction(raw_tx)

    h = "0x" + tx_hash.hex()
    console.print(Panel(
        f"[bold success]Transacción Enviada vía Flashbots[/bold success]\n\n"
        f"Token: {symbol} ({token_address})\n"
        f"Hash: [white]{h}[/white]\n"
        f"Rastreador: [link=https://protect.flashbots.net/tx/{h}]https://protect.flashbots.net/tx/{h}[/link]",
        title="Estado Ethereum", border_style="green"
    ))

# Wrapper de compatibilidad
def send_eth_usdt_via_flashbots(to, amount, priority_gwei=1.0, max_fee_gwei=None, gas_limit=DEFAULT_ETH_GAS, dry_run=False):
    send_eth_token(to, amount, ETH_USDT, 6, priority_gwei, max_fee_gwei, gas_limit, dry_run)

# ---------------------------------------------------------------------------
# Bot de envíos automáticos (BSC BEP20)
# ---------------------------------------------------------------------------

def parse_interval(text):
    """Convierte un intervalo textual a segundos.

    Acepta:
        "60"     -> 60 segundos
        "30s"    -> 30 segundos
        "5m"     -> 300 segundos
        "1h"     -> 3600 segundos

    Devuelve un entero positivo. Lanza ``ValueError`` si el formato es inválido.
    """
    s = str(text).strip().lower()
    if not s:
        raise ValueError("intervalo vacío")
    suffix = s[-1]
    if suffix.isdigit():
        n = int(s)
    elif suffix == "s":
        n = int(s[:-1])
    elif suffix == "m":
        n = int(s[:-1]) * 60
    elif suffix == "h":
        n = int(s[:-1]) * 3600
    else:
        raise ValueError(f"sufijo no soportado: {suffix!r} (use s|m|h o un entero)")
    if n <= 0:
        raise ValueError(f"intervalo debe ser positivo: {n}")
    return n


def _fmt_seconds(s):
    """Formatea segundos en estilo compacto: 65 -> '1m 05s'."""
    s = max(0, int(s))
    if s < 60:
        return f"{s}s"
    if s < 3600:
        m, sec = divmod(s, 60)
        return f"{m}m {sec:02d}s"
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    return f"{h}h {m:02d}m {sec:02d}s"


def _live_countdown(total_seconds, message="Próximo envío en"):
    """Cuenta regresiva en una sola línea, con ANSI CRUDO.

    Evita ``Live``, ``Table.grid`` y ``console.print(..., soft_wrap=True)``
    porque en Windows/PowerShell han disparado ``IndexError: list index
    out of range`` durante refresco o salida. Usa ``\\r\\033[K`` para
    devolver el cursor al inicio y limpiar la línea, y secuencias ANSI
    (cyan bold, white) para colorear. Ningún tipo de rich-internal
    indexing o context manager.

    Ctrl+C propaga al llamador.
    """
    if total_seconds <= 0:
        return
    end_time = time.time() + total_seconds
    try:
        while True:
            remaining = max(0, int(end_time - time.time()))
            # \r            -> cursor a columna 0
            # \033[K        -> limpia hasta el final de la línea
            # \033[1;36m    -> bold cyan
            # \033[37m      -> white
            # \033[0m       -> reset
            sys.stdout.write(
                f"\r\033[K\033[1;36m⏳ {message}\033[0m \033[37m{_fmt_seconds(remaining)}\033[0m"
            )
            sys.stdout.flush()
            if remaining <= 0:
                break
            time.sleep(0.25)
    finally:
        # Salta a una nueva línea para que el próximo ``console.print``
        # del bot no sobrescriba el countdown.
        sys.stdout.write("\n")
        sys.stdout.flush()


def bot_send_bsc_token(amount, every_seconds, max_count=None,
                      priority_gwei=1.0, max_fee_gwei=None,
                      gas_limit=DEFAULT_BSC_GAS, dry_run=False, to=None,
                      token_address=None, decimals=None):
    """Envía un token BEP20 BSC periódicamente al destinatario por defecto.

    - Token: por defecto USDT (``BSC_USDT``). ``token_address`` acepta
      dirección o símbolo popular (USDC, BUSD, CAKE, DAI, etc.).
    - Destinatario: por defecto ``DEFAULT_BOT_RECIPIENT``
      (solicitado por el usuario). ``to`` lo sobrescribe.
    - Decimals: auto-detectados una sola vez al inicio (caché → on-chain
      → 18). ``decimals`` los sobreescribe explícitamente.
    - ``max_count``: tope de seguridad; el bot se detiene tras N envíos
      exitosos.

    Cada iteración invoca ``send_bsc_token(quiet=True)``. La conexión RPC
    se re-establece por iteración para sobrevivir caídas puntuales.
    """
    if not isinstance(every_seconds, int) or every_seconds <= 0:
        console.print(f"[error]--every debe ser un entero positivo. Recibido: {every_seconds!r}[/error]")
        sys.exit(1)

    if max_count is not None and max_count < 0:
        console.print(f"[error]--max-count debe ser >= 0. Recibido: {max_count}[/error]")
        sys.exit(1)

    # Resolver destinatario.
    if to:
        if not Web3.is_address(to):
            console.print(f"[error]Dirección --to inválida: {to!r}[/error]")
            sys.exit(1)
        to_addr = Web3.to_checksum_address(to)
        to_label = (
            f"[white]{to_addr}[/white]  [dim](override; por defecto {DEFAULT_BOT_RECIPIENT})[/dim]"
        )
    else:
        to_addr = Web3.to_checksum_address(DEFAULT_BOT_RECIPIENT)
        to_label = f"[white]{to_addr}[/white]"

    # Resolver token a enviar (default USDT si no se especifica). El
    # subcommand ``bot`` ya pre-resuelve símbolos desde el catálogo BSC
    # vía resolve_token(); aquí normalizamos a checksum.
    if token_address:
        if not Web3.is_address(token_address):
            console.print(f"[error]Dirección de token inválida: {token_address!r}[/error]")
            sys.exit(1)
        token_addr = Web3.to_checksum_address(token_address)
    else:
        token_addr = Web3.to_checksum_address(BSC_USDT)

    # Detectar symbol y decimals una sola vez al inicio. La caché evita
    # round-trips para tokens populares; send_bsc_token ya hace otra
    # conexión por iteración, pero reutilizar estos valores aquí evita
    # inconsistencias entre banner y resumen.
    bot_w3 = connect(BSC_RPCS)
    auto_decimals = get_token_decimals(bot_w3, token_addr)
    token_symbol = get_token_symbol(bot_w3, token_addr, fallback="TKN")

    # Verificación cruzada de --decimals: si el usuario lo fuerza y no
    # coincide con el contrato/caché, abortamos ANTES de codificar un
    # monto erróneo. (print_config en send-bsc hace esto, pero el bot usa
    # quiet=True y lo suprime, así que lo duplicamos aquí.)
    if decimals is not None and int(decimals) != auto_decimals:
        console.print(
            f"[bold red]¡MISMATCH de decimales![/bold red] "
            f"--decimals={decimals} pero el contrato/cache declara {auto_decimals}."
        )
        console.print("Esto codificaría un monto incorrecto al firmar. Abortando.")
        sys.exit(1)

    token_decimals = int(decimals) if decimals is not None else auto_decimals

    # str() preserva precisión exacta (evita float64 → Decimal perdiendo dígitos).
    amount_str = str(amount)
    if Decimal(amount_str) <= 0:
        console.print(f"[error]--amount debe ser > 0. Recibido: {amount}[/error]")
        sys.exit(1)
    amount_wei = to_wei(amount_str, token_decimals)

    mode_str = "[yellow]DRY-RUN[/yellow]" if dry_run else "[green]LIVE[/green]"
    max_str = "∞" if max_count is None else str(max_count)
    console.print(Panel.fit(
        f"[bold magenta]BSC Auto-Send Bot[/bold magenta]\n"
        f"[dim]Token:[/dim] [white]{token_symbol} ({token_addr}, decimals={token_decimals})[/white]\n"
        f"[dim]Destinatario:[/dim] {to_label}\n"
        f"[dim]Monto por envío:[/dim] [white]{amount_str} {token_symbol} (wei: {amount_wei})[/white]\n"
        f"[dim]Intervalo:[/dim] [white]{_fmt_seconds(every_seconds)} ({every_seconds}s)[/white]\n"
        f"[dim]Máx. transacciones:[/dim] [white]{max_str}[/white]\n"
        f"[dim]Modo:[/dim] {mode_str}",
        border_style="magenta",
        title="[bold]Bot iniciado[/bold]"
    ))

    sent_ok = 0
    sent_fail = 0
    last_hash = None

    try:
        iteration = 0
        while True:
            # Tope: no intentar otro envío si ya alcanzamos el límite.
            if max_count is not None and sent_ok >= max_count:
                console.print(f"\n[success]Alcanzado --max-count={max_count}. Bot detenido.[/success]")
                break

            iteration += 1
            console.rule(f"[bold cyan]Envío #{iteration}[/bold cyan]", align="left")
            try:
                h = send_bsc_token(
                    to_addr, amount_str, token_addr, token_decimals,
                    priority_gwei, max_fee_gwei, gas_limit,
                    dry_run, quiet=True,
                )
                sent_ok += 1
                if h:
                    last_hash = h
                if dry_run:
                    console.print(f"[success]Envío #{iteration} (DRY-RUN) OK[/success]")
                else:
                    console.print(f"[success]Envío #{iteration} OK[/success] → [white]{h}[/white]")
            except KeyboardInterrupt:
                raise
            except SystemExit:
                raise
            except Exception as e:
                sent_fail += 1
                console.print(f"[error]Envío #{iteration} FALLÓ: {e}[/error]")

            # Cuenta regresiva para el siguiente envío. Atrapamos excepciones
            # que no sean KeyboardInterrupt (típicamente IndexError desde
            # rich Live.transient=True restore en Windows/PowerShell). Si
            # falla, NO seguimos adelante con cero delay — eso haría que el
            # bot enviara spam de transacciones. En su lugar sleepamos el
            # intervalo completo del usuario con time.sleep plano.
            try:
                _live_countdown(every_seconds)
            except KeyboardInterrupt:
                raise
            except Exception as e:
                console.print(
                    f"[warning]Cuenta regresiva falló ({type(e).__name__}: {e}); "
                    f"fallback a sleep plano de {_fmt_seconds(every_seconds)}.[/warning]"
                )
                try:
                    time.sleep(every_seconds)
                except KeyboardInterrupt:
                    raise
    except KeyboardInterrupt:
        console.print("\n[warning]Bot detenido por el usuario (Ctrl+C).[/warning]")
    finally:
        # Resumen final — corre SIEMPRE al salir, incluido en SystemExit
        # (p.ej. cuando send_bsc_token aborta por saldo BNB insuficiente).
        try:
            total_sent = Decimal(amount_str) * Decimal(sent_ok)
            summary = Table(title="Resumen Final del Bot", header_style="bold cyan", show_header=True)
            summary.add_column("Métrica", style="dim")
            summary.add_column("Valor")
            summary.add_row("Token", f"{token_symbol} ({token_addr}, decimals={token_decimals})")
            summary.add_row("Envíos exitosos", str(sent_ok))
            summary.add_row("Envíos fallidos", str(sent_fail))
            summary.add_row(f"Monto total enviado ({token_symbol})", str(total_sent))
            if sent_ok:
                summary.add_row("Monto total enviado (wei)", str(amount_wei * sent_ok))
            summary.add_row("Último hash", last_hash or "-")
            console.print(summary)
        except Exception as e:
            console.print(f"[warning]No se pudo imprimir el resumen final: {e}[/warning]")

def show_token_info(chain, token_address):
    """Muestra decimales, símbolo y balance del token para la wallet configurada."""
    display_banner()
    w3 = connect(BSC_RPCS if chain == "bsc" else ETH_RPCS)
    env = "BSC_PRIVATE_KEY" if chain == "bsc" else "ETH_PRIVATE_KEY"

    symbol = get_token_symbol(w3, token_address)
    decimals = get_token_decimals(w3, token_address)

    holder = None
    balance_str = "N/A"
    if os.environ.get(env):
        try:
            holder = Account.from_key(load_key(env)).address
            bal_wei = get_token_balance(w3, token_address, holder)
            if bal_wei is not None:
                balance_str = f"{bal_wei / (10 ** decimals):,.{min(decimals, 6)}f} {symbol}"
        except SystemExit:
            holder = None

    table = Table(title=f"Información del Token ({chain.upper()})", header_style="bold cyan")
    table.add_column("Campo", style="dim")
    table.add_column("Valor")
    table.add_row("Contrato", token_address)
    table.add_row("Símbolo", symbol)
    table.add_row("Decimales", str(decimals))
    table.add_row("Titular", holder or "(no se cargó clave privada)")
    table.add_row("Balance", balance_str)

    explorer = "https://bscscan.com/token/" if chain == "bsc" else "https://etherscan.io/token/"
    console.print(table)
    console.print(f"[link={explorer}{token_address}]Ver en explorador[/link]")

def watch_pending(chain, max_n=20, timeout_s=60):
    display_banner()
    w3 = connect(BSC_RPCS if chain == "bsc" else ETH_RPCS)
    console.print(f"[info]Monitoreando mempool de {chain.upper()} (Máx: {max_n} txs)...[/info]")
    
    seen = set()
    start = time.time()
    table = Table(show_header=True, header_style="bold magenta")
    table.add_column("Hora", style="dim", width=12)
    table.add_column("Hash de Transacción Pendiente")

    with Live(table, refresh_per_second=4):
        while time.time() - start < timeout_s and len(seen) < max_n:
            try:
                block = w3.eth.get_block("pending", full_transactions=True)
                for tx in block.transactions:
                    h_hex = tx.hash.hex() if not isinstance(tx.hash, str) else tx.hash
                    if not h_hex.startswith("0x"): h_hex = "0x" + h_hex
                    if h_hex not in seen:
                        seen.add(h_hex)
                        table.add_row(datetime.now().strftime("%H:%M:%S"), h_hex)
                        if len(seen) >= max_n: break
            except Exception:
                pass
            time.sleep(1)

# ---------------------------------------------------------------------------
# Punto de Entrada CLI
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(
        prog="transfer_toolkit",
        description="Transferencia de tokens BEP20/ERC20 (USDT por defecto). Use --token para cualquier token.",
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    def add_common_token_args(parser, chain):
        catalog = CHAIN_TOKEN_MAP.get(chain, {})
        parser.add_argument("--to", required=True)
        # type=str: evita que argparse silenciosamente acepte notación científica
        # tipo "5e-5" como 0.00005. Se parsea con Decimal dentro de to_wei().
        parser.add_argument("--amount", type=str, required=True,
                            help="Monto EXACTO del token como texto (p.ej. '50000' o '50000.5'). "
                                 "Evita notación científica para no perder precisión.")
        parser.add_argument("--token", default=None,
                            help=f"Dirección del contrato {chain.upper()} (por defecto USDT). "
                                 f"También acepta símbolos populares en {chain.upper()}: "
                                 + ", ".join(catalog.keys()))
        parser.add_argument("--decimals", type=int, default=None,
                            help="Decimales del token (auto-detecta si se omite).")
        parser.add_argument("--priority-gwei", type=float, default=1.0)
        parser.add_argument("--max-fee-gwei", type=float, default=None)
        parser.add_argument("--gas-limit", type=int, default=None)
        parser.add_argument("--dry-run", action="store_true",
                            help="Construye la transacción y la muestra sin transmitirla. "
                                 "Útil para verificar monto y gas antes de firmar.")

    b = sub.add_parser("send-bsc", help="Enviar tokens BEP20 en BSC (USDT por defecto)")
    add_common_token_args(b, "bsc")
    b.set_defaults(gas_limit=DEFAULT_BSC_GAS)

    e = sub.add_parser("send-eth", help="Enviar tokens ERC20 en Ethereum vía Flashbots (USDT por defecto)")
    add_common_token_args(e, "eth")
    e.set_defaults(gas_limit=DEFAULT_ETH_GAS)

    bot_p = sub.add_parser(
        "bot",
        help="Bot automático que envía tokens BEP20 BSC (USDT por defecto) "
             f"al destinatario ({DEFAULT_BOT_RECIPIENT}) en intervalos regulares.",
    )
    bot_p.add_argument("--amount", type=str, required=True,
                       help="Monto EXACTO de USDT por envío (p.ej. '10' o '10.5'). "
                            "Evita notación científica para preservar precisión.")
    bot_p.add_argument("--every", required=True,
                       help="Intervalo entre envíos. Acepta segundos enteros "
                            "(--every 60) o con sufijo --every 30s | 5m | 1h.")
    bot_p.add_argument("--max-count", type=int, default=None,
                       help="Detener el bot después de N envíos exitosos "
                            "(tope de seguridad, por defecto ilimitado).")
    bot_p.add_argument("--priority-gwei", type=float, default=0.5,
                       help="Prioridad (tip) en Gwei. Default 0.5 para mantener fees bajas. "
                            "0 = sin tip (puede tardar más en incluirse).")
    bot_p.add_argument("--max-fee-gwei", type=float, default=None)
    bot_p.add_argument("--gas-limit", type=int, default=DEFAULT_BSC_GAS)
    bot_p.add_argument("--to", default=None,
                       help=f"Sobrescribe el destinatario por defecto "
                            f"({DEFAULT_BOT_RECIPIENT}).")
    bot_p.add_argument("--token", default=None,
                       help="Token BEP20 a enviar (símbolo o dirección 0x...). "
                            "Por defecto USDT. Símbolos populares en BSC: "
                            + ", ".join(POPULAR_BEP20.keys()) + ".")
    bot_p.add_argument("--decimals", type=int, default=None,
                       help="Decimales del token (auto-detecta si se omite).")
    bot_p.add_argument("--dry-run", action="store_true",
                       help="Simula cada envío sin transmitirlo (útil para verificar).")

    i = sub.add_parser("info-token", help="Ver decimals/symbol/balance de un token")
    i.add_argument("--chain", choices=["bsc", "eth"], required=True)
    i.add_argument("--token", required=True,
                   help=f"Dirección del contrato o símbolo popular. "
                        f"BSC: {', '.join(POPULAR_BEP20.keys())}; "
                        f"ETH: {', '.join(POPULAR_ERC20.keys())}.")

    w = sub.add_parser("watch", help="Monitorear transacciones pendientes")
    w.add_argument("--chain", choices=["bsc", "eth"], default="bsc")
    w.add_argument("--max", type=int, default=20)
    w.add_argument("--timeout", type=int, default=60)

    args = p.parse_args()

    try:
        if args.cmd in ("send-bsc", "send-eth"):
            chain = "bsc" if args.cmd == "send-bsc" else "eth"
            token_addr = resolve_token(args.token, chain) if args.token else None
            gas = args.gas_limit if args.gas_limit is not None else (
                DEFAULT_BSC_GAS if args.cmd == "send-bsc" else DEFAULT_ETH_GAS
            )
            if args.cmd == "send-bsc":
                send_bsc_token(args.to, args.amount, token_addr, args.decimals,
                               args.priority_gwei, args.max_fee_gwei, gas, args.dry_run)
            else:
                send_eth_token(args.to, args.amount, token_addr, args.decimals,
                               args.priority_gwei, args.max_fee_gwei, gas, args.dry_run)
        elif args.cmd == "info-token":
            show_token_info(args.chain, resolve_token(args.token, args.chain))
        elif args.cmd == "watch":
            watch_pending(args.chain, args.max, args.timeout)
        elif args.cmd == "bot":
            try:
                interval_s = parse_interval(args.every)
                token = resolve_token(args.token, "bsc") if args.token else None
                bot_send_bsc_token(
                    args.amount, interval_s, args.max_count,
                    args.priority_gwei, args.max_fee_gwei, args.gas_limit,
                    args.dry_run, args.to, token, args.decimals,
                )
            except KeyboardInterrupt:
                pass  # ya manejado dentro del bot (imprime resumen en finally:)
            except Exception as e:
                # Errores inesperados (típicamente IndexError rebotado
                # desde rich Live transient-restore en PowerShell) no
                # deben escalar a "Error Crítico": el bot ya imprime su
                # propio resumen en finally:. Aquí avisamos al usuario pero
                # también dejamos un traceback para depurar y devolvemos
                # exit code 1, así pipelines/scripts que dependan del exit
                # code siguen detectando el fallo.
                import traceback as _tb
                console.print(
                    f"\n[warning]El bot terminó con un error inesperado: "
                    f"{type(e).__name__}: {e}[/warning]"
                )
                console.print("[dim]Traceback (para depurar):[/dim]")
                _tb.print_exc()
                sys.exit(1)
    except KeyboardInterrupt:
        console.print("\n[warning]Operación cancelada por el usuario.[/warning]")
    except Exception as e:
        console.print(f"\n[error]Error Crítico:[/error] {str(e)}")

if __name__ == "__main__":
    main()