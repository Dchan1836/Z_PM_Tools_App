"""Check NetworkX analytics on a tiny graph. Prints one JSON object."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "graph"))
from links import add_node, analytics, link  # noqa: E402
import networkx as nx  # noqa: E402

graph = nx.MultiGraph()
add_node(graph, "user", "u1", "Ada")
add_node(graph, "user", "u2", "Ben")
add_node(graph, "task", "t1", "Survey")
add_node(graph, "task", "t2", "Install")
add_node(graph, "task", "t3", "Train")
add_node(graph, "meeting", "m1", "Kickoff")
link(graph, "user:u1", "task:t1", "owns")
link(graph, "user:u1", "task:t2", "owns")
link(graph, "user:u2", "task:t3", "owns")
link(graph, "task:t1", "task:t2", "precedes")
link(graph, "task:t2", "task:t3", "precedes")
link(graph, "user:u1", "meeting:m1", "facilitates")
link(graph, "meeting:m1", "task:t2", "about")

print(json.dumps(analytics(graph)))
