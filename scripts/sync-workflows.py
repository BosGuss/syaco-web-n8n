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
        INSERT INTO workflow_entity (id, name, active, nodes, connections, settings, staticData, pinData, versionId, triggerCount, meta, createdAt, updatedAt)
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        """, (wf_id, name, nodes_json, connections_json, settings_json, static_data, pin_data, new_version_id, meta_json, now_str, now_str))
        print(f"[CREATED] Workflow '{name}' (ID: {wf_id})")
    else:
        cursor.execute("""
        UPDATE workflow_entity
        SET nodes=?, connections=?, settings=?, staticData=?, pinData=?, meta=?, versionId=?, updatedAt=?
        WHERE id=?
        """, (nodes_json, connections_json, settings_json, static_data, pin_data, meta_json, new_version_id, now_str, wf_id))
        print(f"[UPDATED] Workflow '{name}' (ID: {wf_id})")

    # 3. Insert into workflow_history
    cursor.execute("""
    INSERT INTO workflow_history (versionId, workflowId, nodes, connections, name, createdAt, updatedAt, authors)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'Antigravity Agent')
    """, (new_version_id, wf_id, nodes_json, connections_json, name, now_str, now_str))

    # 4. Update workflow_published_version
    cursor.execute("SELECT workflowId FROM workflow_published_version WHERE workflowId=?", (wf_id,))
    pub_row = cursor.fetchone()
    if pub_row:
        cursor.execute("UPDATE workflow_published_version SET publishedVersionId=?, createdAt=?, updatedAt=? WHERE workflowId=?", (new_version_id, now_str, now_str, wf_id))
    else:
        cursor.execute("INSERT INTO workflow_published_version (workflowId, publishedVersionId, createdAt, updatedAt) VALUES (?, ?, ?, ?)", (wf_id, new_version_id, now_str, now_str))

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
