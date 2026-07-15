import asyncio
from web3 import Web3
import websocket
import threading
import json

class Peer:
    def __init__(self,ip,port):
        self.ip = ip
        self.port = port
        self.connected = False

    def connect(self):
        try:
            self.ws = websocket.create_connection(f'ws://{self.ip}:{self.port}/rpc')
            self.connected = True
        except:
            self.connected = False

    def send_transaction(self,unsigned_tx):
        if self.connected:
            self.ws.send(json.dumps({
                "jsonrpc": "2.0",
                "method": "sendRawTransaction",
                "params": [unsigned_tx.hex()],
                "id": 1
            }))
            return True
        return False

class P2PPropagator:
    def __init__(self,peer_nodes):
        self.peers = [Peer(ip,port) for ip,port in peer_nodes]
        self.active_peers = []
        self.lock = threading.Lock()

    def initialize_peers(self):
        for peer in self.peers:
            thread = threading.Thread(target=peer.connect)
            thread.start()
            self.active_peers.append(peer)

    def broadcast(self,unsigned_tx):
        with self.lock:
            for peer in self.active_peers:
                if peer.send_transaction(unsigned_tx):
                    return True
        return False

# Configuration
propagator = P2PPropagator([("127.0.0.1",8546),("10.0.0.5",8547)])
propagator.initialize_peers()

# Usage with reliable P2P
propagator.broadcast(unsigned_tx)