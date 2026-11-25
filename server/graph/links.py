"""Build the Z PM relationship graph with NetworkX and answer link questions."""

import json
import os
import sys
from datetime import datetime

import networkx as nx
import psycopg
from networkx.algorithms.link_analysis.pagerank_alg import _pagerank_python
from psycopg.rows import dict_row

RELATIONS = {
    "owns": "Owns the task",
    "commented": "Commented on the task",
    "precedes": "Must finish first",
    "contains": "Parent task",
    "facilitates": "Facilitates the meeting",
    "attends": "Attends the meeting",
    "leads": "Leads an agenda topic",
    "action": "Owns a meeting action",
    "about": "Meeting about the task",
    "tracks": "Tracker for the task",
    "rolls_up": "Rolls up to a tracker",
    "raises": "Issue on the task",
    "watches": "Owns the issue",
    "noted": "Wrote an issue note",
    "decided": "Decision from the meeting",
    "includes": "Report includes the task",
    "files": "Folder for the task",
    "sent": "Sent the message",
    "received": "Received the message",
    "mentions": "Message about the task",
}


def node_id(kind, ref):
    return f"{kind}:{ref}"


def add_node(graph, kind, ref, label, **attrs):
    if not ref:
        return None
    key = node_id(kind, ref)
    if key not in graph:
        graph.add_node(key, kind=kind, label=label or ref, ref=ref, **attrs)
    return key


def link(graph, left, right, relation):
    if left and right and left != right and left in graph and right in graph:
        graph.add_edge(left, right, key=relation, relation=relation, source=left, target=right)


def build(connection):
    graph = nx.MultiGraph()
    with connection.cursor() as cursor:
        cursor.execute("SELECT id, first_name, last_name, role, permission FROM users")
        for row in cursor.fetchall():
            add_node(
                graph, "user", row["id"], f"{row['first_name']} {row['last_name']}".strip(),
                role=row["role"] or "", permission=row["permission"] or "",
            )

        cursor.execute("""
            SELECT id, name, owner_id, predecessor_id, parent_id, pillar, planned_start, planned_end, level
            FROM tasks ORDER BY position
        """)
        tasks = cursor.fetchall()
        for row in tasks:
            add_node(
                graph, "task", row["id"], row["name"],
                pillar=row["pillar"] or "",
                planned_start=row["planned_start"] or "",
                planned_end=row["planned_end"] or "",
                level=row["level"] or 0,
                parent_id=row["parent_id"] or "",
                owner_id=row["owner_id"] or "",
            )
        for row in tasks:
            task = node_id("task", row["id"])
            link(graph, node_id("user", row["owner_id"]), task, "owns")
            link(graph, node_id("task", row["predecessor_id"]), task, "precedes")
            link(graph, node_id("task", row["parent_id"]), task, "contains")

        cursor.execute("SELECT task_id, author_id FROM task_comments")
        for row in cursor.fetchall():
            link(graph, node_id("user", row["author_id"]), node_id("task", row["task_id"]), "commented")

        cursor.execute("SELECT id, title, facilitator_id, task_id, date FROM meetings")
        for row in cursor.fetchall():
            meeting = add_node(graph, "meeting", row["id"], row["title"], when=row["date"] or "")
            link(graph, node_id("user", row["facilitator_id"]), meeting, "facilitates")
            link(graph, meeting, node_id("task", row["task_id"]), "about")

        cursor.execute("SELECT meeting_id, user_id FROM meeting_participants")
        for row in cursor.fetchall():
            link(graph, node_id("user", row["user_id"]), node_id("meeting", row["meeting_id"]), "attends")

        cursor.execute("SELECT meeting_id, owner_id FROM agenda_items")
        for row in cursor.fetchall():
            link(graph, node_id("user", row["owner_id"]), node_id("meeting", row["meeting_id"]), "leads")

        cursor.execute("""
            SELECT agenda_items.meeting_id, action_items.owner_id
            FROM action_items
            JOIN agenda_items ON agenda_items.id = action_items.agenda_id
        """)
        for row in cursor.fetchall():
            link(graph, node_id("user", row["owner_id"]), node_id("meeting", row["meeting_id"]), "action")

        cursor.execute("SELECT id, name, task_id, parent_id FROM trackers")
        trackers = cursor.fetchall()
        for row in trackers:
            add_node(graph, "tracker", row["id"], row["name"])
        for row in trackers:
            tracker = node_id("tracker", row["id"])
            link(graph, tracker, node_id("task", row["task_id"]), "tracks")
            link(graph, tracker, node_id("tracker", row["parent_id"]), "rolls_up")

        cursor.execute("SELECT id, title, task_id, owner_id FROM issues")
        for row in cursor.fetchall():
            issue = add_node(graph, "issue", row["id"], row["title"])
            link(graph, issue, node_id("task", row["task_id"]), "raises")
            link(graph, node_id("user", row["owner_id"]), issue, "watches")

        cursor.execute("SELECT issue_id, author_id FROM issue_notes")
        for row in cursor.fetchall():
            link(graph, node_id("user", row["author_id"]), node_id("issue", row["issue_id"]), "noted")

        cursor.execute("SELECT id, title, meeting_id FROM decisions")
        for row in cursor.fetchall():
            decision = add_node(graph, "decision", row["id"], row["title"])
            link(graph, decision, node_id("meeting", row["meeting_id"]), "decided")

        cursor.execute("SELECT id, name FROM reports")
        for row in cursor.fetchall():
            add_node(graph, "report", row["id"], row["name"])
        cursor.execute("SELECT report_id, task_id FROM report_tasks")
        for row in cursor.fetchall():
            link(graph, node_id("report", row["report_id"]), node_id("task", row["task_id"]), "includes")

        cursor.execute("SELECT id, name, task_id FROM folders")
        for row in cursor.fetchall():
            folder = add_node(graph, "folder", row["id"], row["name"])
            link(graph, folder, node_id("task", row["task_id"]), "files")

        cursor.execute("SELECT id, subject, from_id, to_id, task_id FROM messages")
        for row in cursor.fetchall():
            message = add_node(graph, "message", row["id"], row["subject"])
            link(graph, node_id("user", row["from_id"]), message, "sent")
            link(graph, node_id("user", row["to_id"]), message, "received")
            link(graph, message, node_id("task", row["task_id"]), "mentions")
    return graph


def public(graph, key):
    data = graph.nodes[key]
    return {"id": key, "kind": data["kind"], "label": data["label"], "ref": data["ref"]}


def summary(graph):
    counts = {}
    catalog = {"user": [], "task": [], "meeting": []}
    for key, data in graph.nodes(data=True):
        counts[data["kind"]] = counts.get(data["kind"], 0) + 1
        if data["kind"] in catalog:
            catalog[data["kind"]].append(public(graph, key))
    for kind in catalog:
        catalog[kind].sort(key=lambda item: item["label"].lower())
    hubs = sorted(
        (public(graph, key) | {"links": graph.degree(key)} for key, data in graph.nodes(data=True) if data["kind"] in {"user", "task", "meeting"}),
        key=lambda item: item["links"],
        reverse=True,
    )[:8]
    return {"counts": counts, "edgeCount": graph.number_of_edges(), "hubs": hubs, "catalog": catalog}


def focus(graph, key):
    if key not in graph:
        raise KeyError(key)
    groups = {}
    for _left, other, data in graph.edges(key, data=True):
        groups.setdefault(data["relation"], {})
        groups[data["relation"]][other] = public(graph, other)
    ordered = []
    for relation, nodes in groups.items():
        ordered.append({
            "relation": relation,
            "label": RELATIONS.get(relation, relation),
            "nodes": sorted(nodes.values(), key=lambda item: item["label"].lower()),
        })
    ordered.sort(key=lambda item: item["label"])
    return {"focus": public(graph, key), "groups": ordered}


LEAD_RANK = {"organization": 0, "project": 1, "tracker": 2, "user": 3}
COLUMN_CHUNK = 8
STRUCTURE_EDGES = {
    "supervises": {"style": "dash", "color": "#305496"},
    "owns": {"style": "dash", "color": "#8aa0b8"},
    "has_meeting": {"style": "dash", "color": "#6b7c93"},
    "about": {"style": "dash", "color": "#b8883a"},
    "step": {"style": "solid", "color": "#3d6b8a"},
    "precedes": {"style": "solid", "color": "#c4554a"},
    "subtask": {"style": "solid", "color": "#c4554a"},
}


def _pretty_date(value):
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return value or ""
    return parsed.strftime("%b %d, %Y").replace(" 0", " ")


def _chunk(columns, column_id, label, members):
    members.sort(key=lambda node: node["sort"])
    chunks = [members[index:index + COLUMN_CHUNK] for index in range(0, len(members), COLUMN_CHUNK)]
    for chunk_index, chunk in enumerate(chunks):
        assigned = column_id if len(chunks) == 1 else f"{column_id}-{chunk_index + 1}"
        for order, node in enumerate(chunk):
            node["column"] = assigned
            node["order"] = order
            node.pop("sort", None)
        columns.append({"id": assigned, "label": label, "kind": chunk[0]["kind"]})


def _edges_by(graph, relation):
    found = []
    for _left, _right, data in graph.edges(data=True):
        if data.get("relation") == relation and data.get("source") and data.get("target"):
            found.append((data["source"], data["target"]))
    return found


def _series(member_ids, precedes):
    ordered = nx.DiGraph()
    ordered.add_nodes_from(member_ids)
    for source, target in precedes:
        if source in ordered and target in ordered:
            ordered.add_edge(source, target)
    if ordered.number_of_edges() and not nx.is_directed_acyclic_graph(ordered):
        return sorted(member_ids)
    return list(nx.topological_sort(ordered))


def diagram(graph, today=None):
    del today
    users = []
    tasks = {}
    meetings = []
    for key, data in graph.nodes(data=True):
        if data["kind"] == "user":
            users.append((key, data))
        elif data["kind"] == "task":
            tasks[key] = data
        elif data["kind"] == "meeting":
            meetings.append((key, data))

    leads = [(key, data) for key, data in users if data.get("permission") in LEAD_RANK]
    employees = [(key, data) for key, data in users if data.get("permission") not in LEAD_RANK]
    lead_ids = {key for key, _data in leads}
    org_lead = min(leads, key=lambda item: LEAD_RANK[item[1].get("permission", "user")])[0] if leads else ""

    children = {}
    for key, data in tasks.items():
        parent = node_id("task", data.get("parent_id"))
        if parent in tasks:
            children.setdefault(parent, []).append(key)
    workflow_roots = [key for key, data in tasks.items() if not data.get("parent_id") and children.get(key)]
    workflow_ids = set(workflow_roots)

    def role_of(key):
        if key in workflow_ids:
            return "workflow"
        parent = node_id("task", tasks[key].get("parent_id"))
        if parent in workflow_ids:
            return "task"
        if parent in tasks:
            return "subtask"
        return "task"

    shown_tasks = {key for key in tasks if role_of(key) != "workflow"}
    pillars_of = {}
    for key, data in tasks.items():
        owner = node_id("user", data.get("owner_id"))
        if owner and data.get("pillar"):
            pillars_of.setdefault(owner, set()).add(data["pillar"])

    meeting_users = {}
    for relation in ("attends", "facilitates"):
        for source, target in _edges_by(graph, relation):
            if source in lead_ids or source in {key for key, _data in employees}:
                meeting_users.setdefault(target, set()).add(source)

    def affinity(lead, employee):
        score = 0
        shared = pillars_of.get(lead, set()) & pillars_of.get(employee, set())
        score += 2 * len(shared)
        for people in meeting_users.values():
            if lead in people and employee in people:
                score += 3
        return score

    supervisor = {}
    for employee, _data in employees:
        best = ""
        best_score = 0
        for lead, _lead_data in leads:
            score = affinity(lead, employee)
            if score > best_score:
                best, best_score = lead, score
        supervisor[employee] = best or org_lead

    precedes = [(source, target) for source, target in _edges_by(graph, "precedes") if source in tasks and target in tasks]
    nodes = []
    edges = []
    seen_edges = set()

    def add_card(key, kind, label, sub, sort, tone):
        nodes.append({
            "id": key, "kind": kind, "label": label, "ref": key.split(":", 1)[-1],
            "sub": sub, "column": kind, "sort": sort, "tone": tone,
        })

    def add_edge(source, target, relation, label):
        if not source or not target or source == target:
            return
        key = (source, target, relation)
        if key in seen_edges:
            return
        seen_edges.add(key)
        edges.append({"source": source, "target": target, "relation": relation, "label": label, **STRUCTURE_EDGES[relation]})

    for key, data in sorted(leads, key=lambda item: LEAD_RANK[item[1].get("permission", "user")]):
        add_card(key, "lead", data["label"], data.get("role") or "Lead", (LEAD_RANK[data.get("permission", "user")],), "lead")
    for key, data in employees:
        lead = supervisor.get(key, "")
        lead_name = graph.nodes[lead]["label"] if lead in graph else ""
        add_card(key, "employee", data["label"], data.get("role") or "Employee", (lead_name.lower(), data["label"].split()[-1].lower()), "employee")
        add_edge(lead, key, "supervises", "Has an employee")

    for key, data in meetings:
        add_card(key, "meeting", data["label"], _pretty_date(data.get("when", "")), (data.get("when") or "9999", data["label"].lower()), "meeting")
    for meeting, people in meeting_users.items():
        for person in people:
            add_edge(person, meeting, "has_meeting", "Has a meeting")

    for root in workflow_roots:
        steps = [key for key in children.get(root, []) if role_of(key) == "task"]
        ordered = _series(steps, precedes)
        label = tasks[root]["label"]
        add_card(f"workflow:{tasks[root]['ref']}", "workflow", label, f"{len(ordered)} tasks", (label.lower(),), "workflow")
        workflow_key = f"workflow:{tasks[root]['ref']}"
        owner = node_id("user", tasks[root].get("owner_id"))
        if owner:
            add_edge(owner, workflow_key, "owns", "Has a workflow")
        for index, step in enumerate(ordered, start=1):
            add_edge(workflow_key, step, "step", f"Step {index}")

    for key, data in tasks.items():
        role = role_of(key)
        if role == "workflow":
            continue
        parent = node_id("task", data.get("parent_id"))
        parent_name = tasks[parent]["label"] if parent in tasks else ""
        if role == "subtask":
            add_card(key, "subtask", data["label"], parent_name, (parent_name.lower(), data["label"].lower()), "subtask")
            if parent in shown_tasks:
                add_edge(parent, key, "subtask", "Has a subtask")
        else:
            workflow_name = tasks[parent]["label"] if parent in workflow_ids else ""
            add_card(key, "task", data["label"], workflow_name or data.get("pillar") or "", ((workflow_name or "zzz").lower(), data.get("planned_start") or "9999", data["label"].lower()), "task")
        owner = node_id("user", data.get("owner_id"))
        if owner:
            add_edge(owner, key, "owns", "Has a task")

    for source, target in precedes:
        if source in shown_tasks and target in shown_tasks:
            add_edge(source, target, "precedes", "Must finish first")

    for source, target in _edges_by(graph, "about"):
        if target in workflow_ids:
            steps = [key for key in children.get(target, []) if role_of(key) == "task"]
            for step in steps:
                add_edge(source, step, "about", "Has a task")
        elif target in shown_tasks:
            add_edge(source, target, "about", "Has a task")

    labels = {
        "lead": "Leads",
        "employee": "Employees",
        "meeting": "Meetings",
        "workflow": "Workflows",
        "task": "Tasks",
        "subtask": "Subtasks",
    }
    grouped = {}
    for node in nodes:
        grouped.setdefault(node["kind"], []).append(node)
    columns = []
    ordered_nodes = []
    for kind in ("lead", "employee", "meeting", "workflow", "task", "subtask"):
        members = grouped.get(kind)
        if not members:
            continue
        _chunk(columns, kind, labels[kind], members)
        ordered_nodes.extend(members)

    dependency = nx.DiGraph()
    dependency.add_nodes_from(key for key in tasks if role_of(key) != "workflow")
    for edge in edges:
        if edge["relation"] == "precedes":
            dependency.add_edge(edge["source"], edge["target"])
        elif edge["relation"] == "subtask":
            dependency.add_edge(edge["target"], edge["source"])
    acyclic = nx.is_directed_acyclic_graph(dependency) if dependency.number_of_nodes() else True
    groups = sum(1 for component in nx.weakly_connected_components(dependency) if len(component) > 1)
    directed = nx.DiGraph()
    directed.add_nodes_from(node["id"] for node in ordered_nodes)
    for edge in edges:
        directed.add_edge(edge["source"], edge["target"])
    possible = max(directed.number_of_nodes() * (directed.number_of_nodes() - 1), 1)
    return {
        "stats": {
            "nodes": len(ordered_nodes),
            "edges": len(edges),
            "dag": acyclic,
            "dependencyGroups": groups,
            "workflows": len(workflow_roots),
            "density": round(directed.number_of_edges() / possible, 4),
            "message": "NetworkX reports a valid graph." if acyclic else "NetworkX found a cycle in the task dependencies.",
        },
        "columns": columns,
        "nodes": ordered_nodes,
        "edges": edges,
    }


def _ranked(graph, scores, limit=6, kinds=("user", "task", "meeting")):
    ranked = []
    for key, score in scores.items():
        value = float(score)
        if value <= 0 or key not in graph:
            continue
        if graph.nodes[key].get("kind") not in kinds:
            continue
        ranked.append(public(graph, key) | {"score": round(value, 4)})
    ranked.sort(key=lambda item: (-item["score"], item["label"].lower()))
    return ranked[:limit]


def analytics(graph):
    simple = nx.Graph(graph)
    node_count = simple.number_of_nodes()
    components = sorted(nx.connected_components(simple), key=len, reverse=True) if node_count else []
    largest = simple.subgraph(components[0]).copy() if components else simple
    average_distance = None
    diameter = None
    if largest.number_of_nodes() > 1 and largest.number_of_edges():
        average_distance = round(nx.average_shortest_path_length(largest), 2)
        diameter = nx.diameter(largest)

    degree = nx.degree_centrality(simple) if node_count else {}
    betweenness = nx.betweenness_centrality(simple, normalized=True) if node_count > 1 else {}
    directed = nx.DiGraph()
    directed.add_nodes_from(simple.nodes)
    for _left, _right, data in graph.edges(data=True):
        source = data.get("source")
        target = data.get("target")
        if source in directed and target in directed and source != target:
            directed.add_edge(source, target)
    pagerank = _pagerank_python(directed, alpha=0.85) if directed.number_of_nodes() else {}

    communities = []
    if simple.number_of_edges():
        groups = [group for group in nx.community.greedy_modularity_communities(simple) if len(group) > 1]
        groups.sort(key=len, reverse=True)
        for index, group in enumerate(groups[:5]):
            members = [public(graph, key) for key in group]
            members.sort(key=lambda item: (item["kind"], item["label"].lower()))
            communities.append({
                "id": index + 1,
                "size": len(group),
                "members": members[:8],
                "more": max(0, len(group) - 8),
            })

    bridges = []
    if simple.number_of_nodes() > 2:
        for key in nx.articulation_points(simple):
            if graph.nodes[key].get("kind") not in {"user", "task", "meeting"}:
                continue
            bridges.append(public(graph, key) | {"links": simple.degree(key)})
        bridges.sort(key=lambda item: (-item["links"], item["label"].lower()))
        bridges = bridges[:8]

    tasks = [key for key, data in graph.nodes(data=True) if data.get("kind") == "task"]
    dependencies = nx.DiGraph()
    dependencies.add_nodes_from(tasks)
    for source, target in _edges_by(graph, "precedes"):
        if source in dependencies and target in dependencies:
            dependencies.add_edge(source, target)
    acyclic = nx.is_directed_acyclic_graph(dependencies)
    chain = []
    cycle = []
    if acyclic and dependencies.number_of_edges():
        longest = nx.dag_longest_path(dependencies)
        if len(longest) > 1:
            chain = [public(graph, key) for key in longest]
    elif not acyclic:
        loop = nx.find_cycle(dependencies)
        seen = []
        for left, _right in loop:
            if left not in seen:
                seen.append(left)
        cycle = [public(graph, key) for key in seen]

    isolates = []
    for key in nx.isolates(simple):
        if graph.nodes[key].get("kind") not in {"user", "task", "meeting"}:
            continue
        isolates.append(public(graph, key))
        if len(isolates) == 8:
            break
    isolates.sort(key=lambda item: item["label"].lower())

    return {
        "overview": {
            "nodes": node_count,
            "edges": graph.number_of_edges(),
            "density": round(nx.density(simple), 4) if node_count > 1 else 0,
            "components": len(components),
            "largestComponent": len(components[0]) if components else 0,
            "isolates": sum(1 for _key in nx.isolates(simple)),
            "clustering": round(nx.average_clustering(simple), 4) if node_count else 0,
            "averageDistance": average_distance,
            "diameter": diameter,
            "dependenciesAcyclic": acyclic,
        },
        "degree": _ranked(graph, degree),
        "betweenness": _ranked(graph, betweenness),
        "pagerank": _ranked(graph, pagerank),
        "bridges": bridges,
        "communities": communities,
        "criticalChain": chain,
        "dependencyCycle": cycle,
        "isolates": isolates,
    }


def path_between(graph, source, target):
    if source not in graph or target not in graph:
        raise KeyError(source if source not in graph else target)
    try:
        keys = nx.shortest_path(graph, source, target)
    except nx.NetworkXNoPath:
        return {"path": [], "steps": [], "connected": False}
    steps = []
    for left, right in zip(keys, keys[1:]):
        relations = sorted({data["relation"] for data in graph.get_edge_data(left, right).values()})
        steps.append({
            "from": public(graph, left),
            "to": public(graph, right),
            "relations": [{"relation": relation, "label": RELATIONS.get(relation, relation)} for relation in relations],
        })
    return {"path": [public(graph, key) for key in keys], "steps": steps, "connected": True}


def main():
    url = os.environ.get("DATABASE_URL")
    if not url:
        print(json.dumps({"error": "DATABASE_URL is not set."}))
        return 1
    command = sys.argv[1] if len(sys.argv) > 1 else "summary"
    with psycopg.connect(url, row_factory=dict_row) as connection:
        graph = build(connection)
    try:
        if command == "summary":
            payload = summary(graph)
        elif command == "focus":
            payload = focus(graph, sys.argv[2])
        elif command == "path":
            payload = path_between(graph, sys.argv[2], sys.argv[3])
        elif command == "diagram":
            payload = diagram(graph)
        elif command == "analytics":
            payload = analytics(graph)
        else:
            payload = {"error": "Unknown graph command."}
    except KeyError:
        payload = {"error": "That record is not in the graph."}
    print(json.dumps(payload))
    return 0 if "error" not in payload else 1


if __name__ == "__main__":
    raise SystemExit(main())
