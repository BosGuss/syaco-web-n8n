"""
SyaCo Workflow Sync Utility
Syncs workflow JSON files in workflows/ into n8n's internal SQLite database (n8n_data/database.sqlite).
Updates workflow_entity, workflow_history, and workflow_published_version.

Usage:
  python scripts/sync-workflows.py          # Syncs all 3 production workflows
  python scripts/sync-workflows.py flow1    # Syncs Flow 1 only
  python scripts/sync-workflows.py flow2    # Syncs Flow 2 only
  python scripts/sync-workflows.py flow3    # Syncs Flow 3 only
"""

import sqlite3
import json
import uuid
import datetime
import os
import sys

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

DB_PATH = r'n8n_data/database.sqlite'

ALL_WORKFLOWS = [
    r'workflows/flow1-solution-discovery.json',
    r'workflows/flow2-content-publisher.json',
    r'workflows/flow3-community-lead-assistant.json'
]

def sync_workflow(cursor, wf_path):
    if not os.path.exists(wf_path):
        print(f"[ERROR] Workflow file not found: {wf_path}")
        return False

    with open(wf_path, 'r', encoding='utf-8') as f:
        wf_data = json.load(f)

    name = wf_data['name']
    nodes_json = json.dumps(wf_data.get('nodes', []))
    connections_json = json.dumps(wf_data.get('connections', {}))
    settings_json = json.dumps(wf_data.get('settings', {}))
    static_data = json.dumps(wf_data.get('staticData')) if wf_data.get('staticData') else None
    pin_data = json.dumps(wf_data.get('pinData', {}))
    meta_json = json.dumps(wf_data.get('meta', {}))

    # 1. Look up existing workflow
    cursor.execute("SELECT id FROM workflow_entity WHERE name=?", (name,))
    row = cursor.fetchone()
    if not row:
        wf_id = str(uuid.uuid4())[:16]
        is_new = True
    else:
        wf_id = row[0]
        is_new = False

    new_version_id = str(uuid.uuid4())
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]

    # 2. Update or Insert workflow_entity
    if is_new:
        cursor.execute("""
        INSERT INTO workflow_entity (id, name, active, nodes, connections, settings, staticData, pinData, versionId, activeVersionId, triggerCount, meta, createdAt, updatedAt)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        """, (wf_id, name, nodes_json, connections_json, settings_json, static_data, pin_data, new_version_id, new_version_id, meta_json, now_str, now_str))
        print(f"[CREATED] Workflow '{name}' (ID: {wf_id})")
    else:
        cursor.execute("""
        UPDATE workflow_entity
        SET nodes=?, connections=?, settings=?, staticData=?, pinData=?, meta=?, versionId=?, activeVersionId=?, updatedAt=?
        WHERE id=?
        """, (nodes_json, connections_json, settings_json, static_data, pin_data, meta_json, new_version_id, new_version_id, now_str, wf_id))
        print(f"[UPDATED] Workflow '{name}' (ID: {wf_id})")

    # 3. Insert into workflow_history (optional audit table)
    try:
        cursor.execute("""
        INSERT INTO workflow_history (versionId, workflowId, nodes, connections, name, createdAt, updatedAt, authors)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Antigravity Agent')
        """, (new_version_id, wf_id, nodes_json, connections_json, name, now_str, now_str))
    except Exception as e:
        print(f"[WARN] workflow_history skipped: {e}")

    # 4. Update workflow_published_version
    try:
        cursor.execute("SELECT workflowId FROM workflow_published_version WHERE workflowId=?", (wf_id,))
        pub_row = cursor.fetchone()
        if pub_row:
            cursor.execute("UPDATE workflow_published_version SET publishedVersionId=?, createdAt=?, updatedAt=? WHERE workflowId=?", (new_version_id, now_str, now_str, wf_id))
        else:
            cursor.execute("INSERT INTO workflow_published_version (workflowId, publishedVersionId, createdAt, updatedAt) VALUES (?, ?, ?, ?)", (wf_id, new_version_id, now_str, now_str))
    except Exception as e:
        print(f"[WARN] workflow_published_version update skipped: {e}")

    # 5. Sync workflow_publication_trigger_status and triggerCount
    trigger_nodes = []
    for node in wf_data.get('nodes', []):
        if node.get('disabled') is True:
            continue
        node_type = node.get('type', '')
        if 'webhook' in node_type.lower():
            trigger_nodes.append((node.get('id'), 'persisted'))
        elif 'schedule' in node_type.lower() or 'poll' in node_type.lower():
            trigger_nodes.append((node.get('id'), 'in-memory'))

    try:
        cursor.execute("UPDATE workflow_entity SET triggerCount=? WHERE id=?", (len(trigger_nodes), wf_id))
        # Remove old trigger statuses that no longer exist in workflow
        valid_node_ids = [t[0] for t in trigger_nodes]
        if valid_node_ids:
            placeholders = ','.join('?' for _ in valid_node_ids)
            cursor.execute(f"DELETE FROM workflow_publication_trigger_status WHERE workflowId=? AND nodeId NOT IN ({placeholders})", [wf_id] + valid_node_ids)
        else:
            cursor.execute("DELETE FROM workflow_publication_trigger_status WHERE workflowId=?", (wf_id,))

        for node_id, kind in trigger_nodes:
            cursor.execute("""
            INSERT INTO workflow_publication_trigger_status (workflowId, nodeId, versionId, status, errorMessage, createdAt, updatedAt, triggerKind)
            VALUES (?, ?, ?, 'activated', NULL, ?, ?, ?)
            ON CONFLICT(workflowId, nodeId) DO UPDATE SET
              versionId=excluded.versionId,
              status=excluded.status,
              errorMessage=NULL,
              updatedAt=excluded.updatedAt,
              triggerKind=excluded.triggerKind
            """, (wf_id, node_id, new_version_id, now_str, now_str, kind))

        # Clear failed retry states so reconciler / trigger manager does not lock out triggers
        cursor.execute("DELETE FROM workflow_publication_retry_state WHERE workflowId=?", (wf_id,))
        cursor.execute("DELETE FROM workflow_publication_outbox WHERE workflowId=? AND status='failed'", (wf_id,))
        print(f"[TRIGGER-SYNC] Synced {len(trigger_nodes)} triggers for workflow '{name}'")
    except Exception as e:
        print(f"[WARN] workflow_publication_trigger_status sync skipped: {e}")

    return True

def main():
    if not os.path.exists(DB_PATH):
        print(f"[ERROR] n8n database not found at {DB_PATH}")
        sys.exit(1)

    targets = []
    if len(sys.argv) > 1:
        arg = sys.argv[1].lower()
        for p in ALL_WORKFLOWS:
            if arg in p.lower():
                targets.append(p)
        if not targets:
            print(f"[ERROR] No matching workflow found for '{sys.argv[1]}'. Available: flow1, flow2, flow3")
            sys.exit(1)
    else:
        targets = ALL_WORKFLOWS

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    success_count = 0
    for wf in targets:
        if sync_workflow(cursor, wf):
            success_count += 1

    conn.commit()
    conn.close()
    print(f"\n[SUCCESS] Synced {success_count}/{len(targets)} workflows to SQLite successfully.")

if __name__ == '__main__':
    main()
