import sqlite3
import json
import sys

db_path = 'n8n_data/database.sqlite'
conn = sqlite3.connect(db_path)
c = conn.cursor()

execution_id = None
if len(sys.argv) > 1:
    execution_id = sys.argv[1]
else:
    c.execute('SELECT id FROM execution_entity ORDER BY id DESC LIMIT 1')
    latest = c.fetchone()
    if latest:
        execution_id = latest[0]

if not execution_id:
    print('No execution found.')
    sys.exit(0)

print(f'=== Inspecting Execution #{execution_id} ===')

c.execute('SELECT id, workflowId, status, mode, startedAt, stoppedAt FROM execution_entity WHERE id = ?', (execution_id,))
ent = c.fetchone()
if ent:
    print(f'Status: {ent[2]} | Mode: {ent[3]} | Started: {ent[4]} | Stopped: {ent[5]}')
else:
    print(f'Execution #{execution_id} not found in execution_entity')

c.execute('SELECT executionId, data FROM execution_data WHERE executionId = ?', (execution_id,))
row = c.fetchone()
if row:
    try:
        parsed = json.loads(row[1])
        print('Data Type:', type(parsed).__name__)
        if isinstance(parsed, dict):
            res_data = parsed.get('resultData', {})
            run_data = res_data.get('runData', {})
            print('Executed Nodes:', list(run_data.keys()))
            last_node = res_data.get('lastNodeExecuted')
            print('Last Node Executed:', last_node)
            err = res_data.get('error')
            if err:
                print('Execution Error:', json.dumps(err, indent=2))
    except Exception as e:
        print('Error parsing execution data JSON:', e)
else:
    print(f'No data payload in execution_data for Execution #{execution_id}')

conn.close()
