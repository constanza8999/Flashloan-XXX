import asyncio
from web3 import Web3
import geopy.distance
from datetime import datetime,timedelta
import threading

class Node:
    def __init__(self,node_id,node_type,ip,port,region):
        self.node_id = node_id
        self.node_type = node_type # 'master','slave','follower'
        self.ip = ip
        self.port = port
        self.region = region
        self.heartbeat = timedelta(seconds=30)
        self.last_seen = datetime.now()
        self.failed_count = 0

    def heartbeat(self):
        # Updates last seen time
        self.last_seen = datetime.now()
        self.failed_count = 0

    def is_alive(self):
        return (datetime.now() - self.last_seen) < self.heartbeat

class MasterNode:
    def __init__(self,master_ip,master_port):
        self.master_ip = master_ip
        self.master_port = master_port
        self.nodes = []
        self.failed_nodes = []

    def add_node(self,new_node):
        self.nodes.append(new_node)

    def remove_node(self,node_id):
        self.nodes = [n for n in self.nodes if n.node_id != node_id]

    async def manage_network(self):
        while True:
            # Check node status
            for node in self.nodes:
                if not node.is_alive():
                    node.failed_count +=1
                    if node.failed_count >=3:
                        self.failed_nodes.append(node)
                        self.nodes.remove(node)
            # Rebalance if needed
            
            await asyncio.sleep(10)


class RelayNetwork:
    def __init__(self,master_node_url):
        # Initialize with central master node
        self.master = MasterNode(master_node_url.split(':')[0],master_node_url.split(':')[1])
        self.masternode_url = f"{master_node_url}/relay"

    def register_slave(self,slave_address,region):
        # Register new slave nodes
        slave_node = Node(
            node_id=f"slave_{len(self.master.nodes)}",
            node_type="slave",
            ip=slave_address,
            port=8545,
            region=region
        )
        self.master.add_node(slave_node)
        # Send registration signal
        asyncio.run_coroutine_threadsafe(
            send_registration(self.master,
                               slave_node),
            threading.Thread()
        )

    def broadcast_to_nodes(self,unsigned_tx):
        # Send transaction to all active slaves
        for node in self.master.nodes:
            if node.node_type == "slave" and node.is_alive():
                # Use Web3 provider pattern
                web3 = Web3(Web3.HTTPProvider(f"{node.ip}:{node.port}"))
                web3.eth.account.sign_transaction(unsigned_tx)
                web3.eth.sendRawTransaction(unsigned_tx)

    def replace_failed_nodes(self):
        # Automatic failover
        for failed in self.master.failed_nodes:
            # Find replacement candidates
            for node in self.master.nodes:
                if node not in failed and node.node_type == "follower":
                    # Promote to slave
                    node.node_type = "slave"
                    self.master.add_node(node)
                    break

class P2PPropagator:
    def __init__(self,peer_nodes):
        self.peers = peer_nodes

    def propagate(self,unsigned_tx):
        # Direct P2P transmission
        for peer in self.peers:
            peer.send_raw_transaction(unsigned_tx)

# Configuration
relay = RelayNetwork("127.0.0.1:8545")
relay.register_slave("192.168.1.10", "us-east")
relay.register_slave("10.0.0.5", "eu-west")
relay.broadcast_to_nodes(unsigned_tx)