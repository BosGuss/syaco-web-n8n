const assert = require('assert');

// 1. Test Dev.to Tag Sanitization
function sanitizeDevtoTags(rawTags) {
  return (rawTags || [])
    .map(t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter(t => t.length >= 2)
    .slice(0, 4);
}

const dirtyTags = ['SAP ERP', 'เชื่อมต่อ', 'PLC-2026', 'Modbus/TCP', 'Node.js', 'Extra'];
const cleanTags = sanitizeDevtoTags(dirtyTags);
assert.deepStrictEqual(cleanTags, ['saperp', 'plc2026', 'modbustcp', 'nodejs']);
assert(cleanTags.length <= 4);

// 2. Test Bluesky UTF-8 Byte Offset
function computeBlueskyFacet(text, link) {
  const byteLen = (str) => Buffer.byteLength(str, 'utf8');
  const linkIndex = text.indexOf(link);
  if (linkIndex === -1) return null;

  const byteStart = byteLen(text.slice(0, linkIndex));
  const byteEnd = byteStart + byteLen(link);

  return {
    index: { byteStart, byteEnd },
    features: [{ "$type": "app.bsky.richtext.facet#link", uri: link }]
  };
}

const thaiText = "ระบบเชื่อมต่อ PLC เข้า SAP อัตโนมัติ ดูรายละเอียดที่ https://www.syaco.co.th/solutions/plc";
const link = "https://www.syaco.co.th/solutions/plc";
const facet = computeBlueskyFacet(thaiText, link);

assert(facet !== null);
// Verify slice matches link bytes exactly
const textBuf = Buffer.from(thaiText, 'utf8');
const extractedUrl = textBuf.slice(facet.index.byteStart, facet.index.byteEnd).toString('utf8');
assert.strictEqual(extractedUrl, link, 'Extracted URL using byte offsets must match original link');

// 3. Test Filter New Solutions Logic
function filterNewSolutions(allSolutionItems, processedDbRows) {
  const processedMap = new Map();
  for (const row of processedDbRows || []) {
    const id = String(row.solution_id || '');
    if (id && id !== '__INIT__') {
      const hasPending = row.has_pending === true || row.has_pending === 'true' || row.has_pending === 1;
      processedMap.set(id, hasPending);
    }
  }

  const allSolutions = [];
  for (const item of allSolutionItems) {
    const data = item.json || item;
    if (Array.isArray(data)) {
      allSolutions.push(...data);
    } else if (Array.isArray(data?.data)) {
      allSolutions.push(...data.data);
    } else if (data && data.id) {
      allSolutions.push(data);
    }
  }

  const candidateSolutions = [];
  for (const s of allSolutions) {
    if (!s || !s.id) continue;
    const solId = String(s.id);
    if (!processedMap.has(solId)) {
      // Completely new solution -> run AI
      candidateSolutions.push({ ...s, isReminder: false });
    } else if (processedMap.get(solId) === true) {
      // Already in processed_solutions but has pending review drafts -> reminder bypass
      candidateSolutions.push({ ...s, isReminder: true });
    }
    // If in DB with has_pending === false -> completed, exclude
  }

  return candidateSolutions.map(s => ({
    id: String(s.id),
    titleEn: s.titleEn || '',
    titleTh: s.titleTh || '',
    descEn: s.content?.en?.hero?.description || s.descEn || '',
    descTh: s.content?.th?.hero?.description || s.descTh || '',
    link: s.link || `/solutions/${s.id}`,
    url: `https://www.syaco.co.th${s.link || `/solutions/${s.id}`}`,
    isReminder: s.isReminder === true
  }));
}

const mockProcessed = [
  { solution_id: '7' }, { solution_id: '8' }, { solution_id: '9' }, { solution_id: '10' },
  { solution_id: '11' }, { solution_id: '12' }, { solution_id: '13' }, { solution_id: '14' }
];

const mockCurrentApiItems = [
  { json: { id: 7, titleEn: 'Data Integration & APIs' } },
  { json: { id: 8, titleEn: 'Real-time Tracking & Logistics' } },
  { json: { id: 9, titleEn: 'Smart Inventory & Warehouse' } },
  { json: { id: 10, titleEn: 'Analytics & Dashboard' } },
  { json: { id: 11, titleEn: 'AI & Automation' } },
  { json: { id: 12, titleEn: 'Enterprise Web & Mobile Apps' } },
  { json: { id: 13, titleEn: 'Alerts & Notification System' } },
  { json: { id: 14, titleEn: 'Digital Growth & Performance' } },
  { json: { id: 31, titleEn: 'Secure Enterprise AI & API Gateway' } }
];

const filtered = filterNewSolutions(mockCurrentApiItems, mockProcessed);
assert.strictEqual(filtered.length, 1, 'Must find exactly 1 new solution');
assert.strictEqual(filtered[0].id, '31');
assert.strictEqual(filtered[0].titleEn, 'Secure Enterprise AI & API Gateway');

// Test Empty DB scenario: when processed_solutions is completely empty (returns [{ solution_id: '__INIT__' }])
const filteredEmptyDb = filterNewSolutions(mockCurrentApiItems, [{ solution_id: '__INIT__' }]);
assert.strictEqual(filteredEmptyDb.length, 9, 'When DB is completely empty, all 9 solutions must be processed as new');

// Test When all are completed
const filteredNone = filterNewSolutions(mockCurrentApiItems, [...mockProcessed, { solution_id: '31' }]);
assert.strictEqual(filteredNone.length, 0, 'Must find 0 new solutions when all are completed');

// Test Pending Drafts vs New Solutions vs Completed Solutions classification
const mockProcessedWithPending = [
  { solution_id: '7', has_pending: false },
  { solution_id: '8', has_pending: true }, // Has pending review drafts -> should be re-notified
  { solution_id: '9', has_pending: false },
  { solution_id: '10', has_pending: false },
  { solution_id: '11', has_pending: false },
  { solution_id: '12', has_pending: false },
  { solution_id: '13', has_pending: false },
  { solution_id: '14', has_pending: false }
];

const classified = filterNewSolutions(mockCurrentApiItems, mockProcessedWithPending);
assert.strictEqual(classified.length, 2, 'Must include 1 pending reminder (id 8) and 1 new solution (id 31)');

const reminderSolution = classified.find(s => s.id === '8');
assert(reminderSolution, 'Solution 8 must be present in output');
assert.strictEqual(reminderSolution.isReminder, true, 'Solution 8 with has_pending=true must have isReminder: true');

const newSolution = classified.find(s => s.id === '31');
assert(newSolution, 'Solution 31 must be present in output');
assert.strictEqual(newSolution.isReminder, false, 'New solution 31 must have isReminder: false');

console.log('✅ Flow 2 sanitization, UTF-8 byte offset, and Filter New Solutions tests passed.');

// 4. Test Unified Shared Persona & Anti-Spam Rules in Flow 2
const { buildFlow2Prompts, SHARED_WRITING_AND_ANTI_SPAM_RULES } = require('../skills/shared_persona_rules');
const fs = require('fs');
const path = require('path');

const mockSol = {
  id: '31',
  titleTh: 'ระบบ Enterprise AI & API Gateway',
  titleEn: 'Secure Enterprise AI & API Gateway',
  descTh: 'ระบบเชื่อมต่อ API และจัดคิว AI องค์กรความปลอดภัยสูง',
  url: 'https://www.syaco.co.th/solutions/31'
};

const { promptA, promptB } = buildFlow2Prompts(mockSol);

// Verify Zero AI Footprint rules are present
assert(promptA.includes('ZERO AI FOOTPRINT'), 'Prompt A must include ZERO AI FOOTPRINT rule');
assert(promptA.includes('REMOVE ROBOTIC BUZZWORDS & HYPE'), 'Prompt A must ban robotic buzzwords');
assert(promptA.includes('WRITE LIKE A REAL ENGINEER'), 'Prompt A must instruct to write like real engineer');
assert(promptA.includes('VALUE-FIRST'), 'Prompt A must include VALUE-FIRST rule');
assert(promptA.includes(mockSol.url), 'Prompt A must include exact solution URL');

assert(promptB.includes('ZERO AI FOOTPRINT'), 'Prompt B must include ZERO AI FOOTPRINT rule');
assert(promptB.includes('REMOVE ROBOTIC BUZZWORDS & HYPE'), 'Prompt B must ban robotic buzzwords');
assert(promptB.includes('WRITE LIKE A REAL ENGINEER'), 'Prompt B must instruct to write like real engineer');
assert(promptB.includes('PRESERVE TECHNICAL ACCURACY & NO FABRICATION'), 'Prompt B must preserve technical accuracy');
assert(promptB.includes(mockSol.url), 'Prompt B must include exact solution URL');

// Verify workflow JSON node actually contains the shared rules
const wf2Path = path.join(__dirname, '../workflows/flow2-content-publisher.json');
const wf2 = JSON.parse(fs.readFileSync(wf2Path, 'utf8'));
const promptNode = wf2.nodes.find(n => n.name === 'Build AI Prompts for Call A & B');
assert(promptNode, 'Flow 2 must have Build AI Prompts node');
assert(promptNode.parameters.jsCode.includes('ZERO AI FOOTPRINT'), 'Flow 2 prompt node jsCode must include ZERO AI FOOTPRINT');
assert(promptNode.parameters.jsCode.includes('REMOVE ROBOTIC BUZZWORDS & HYPE'), 'Flow 2 prompt node jsCode must include REMOVE ROBOTIC BUZZWORDS');
assert(promptNode.parameters.jsCode.includes('WRITE LIKE A REAL ENGINEER'), 'Flow 2 prompt node jsCode must include WRITE LIKE A REAL ENGINEER');

console.log('✅ Flow 2 unified anti-spam & humanizer prompt tests passed successfully!');

// 5. Test Flow 2 Workflow Structure: Draft Re-Notification & AI Bypass
const loadProcessedNode = wf2.nodes.find(n => n.name === 'Load Processed IDs');
assert(loadProcessedNode, 'Flow 2 must have Load Processed IDs node');
assert(loadProcessedNode.parameters.query.includes('has_pending'), 'Load Processed IDs query must select has_pending');
assert(loadProcessedNode.parameters.query.includes('content_drafts'), 'Load Processed IDs query must check content_drafts');

const filterNewNode = wf2.nodes.find(n => n.name === 'Filter New Solutions');
assert(filterNewNode, 'Flow 2 must have Filter New Solutions node');
assert(filterNewNode.parameters.jsCode.includes('isReminder'), 'Filter New Solutions jsCode must handle isReminder');

const ifNeedsAiNode = wf2.nodes.find(n => n.name === 'If Needs AI Generation');
assert(ifNeedsAiNode, 'Flow 2 must have If Needs AI Generation node');
assert.strictEqual(ifNeedsAiNode.type, 'n8n-nodes-base.if', 'If Needs AI Generation must be an IF node');

// Verify connections for AI bypass
const connections = wf2.connections;
const splitConn = connections['Split In Batches'];
assert(splitConn && splitConn.main && splitConn.main[1], 'Split In Batches must have batch output (main index 1)');
assert.strictEqual(splitConn.main[1][0]?.node, 'If Needs AI Generation', 'Split In Batches output 1 must connect to If Needs AI Generation');

const ifAiConn = connections['If Needs AI Generation'];
assert(ifAiConn && ifAiConn.main && ifAiConn.main[0] && ifAiConn.main[1], 'If Needs AI Generation must have True (main 0) and False (main 1) branches');
assert.strictEqual(ifAiConn.main[0][0]?.node, 'Lock Solution Status', 'If Needs AI Generation True branch must connect to Lock Solution Status');
assert.strictEqual(ifAiConn.main[1][0]?.node, 'Notify Discord Review Cards', 'If Needs AI Generation False branch must connect to Notify Discord Review Cards');

const saveCteConn = connections['Save Drafts & Complete Status (CTE)'];
assert(saveCteConn?.main?.[0]?.[0]?.node === 'Notify Discord Review Cards', 'Save Drafts CTE must connect to Notify Discord Review Cards');

const notifyConn = connections['Notify Discord Review Cards'];
assert(notifyConn?.main?.[0]?.[0]?.node === 'Split In Batches', 'Notify Discord Review Cards must loop back to Split In Batches');

// Verify Notify Discord Review Cards payload compatibility
const notifyNode = wf2.nodes.find(n => n.name === 'Notify Discord Review Cards');
assert(notifyNode, 'Flow 2 must have Notify Discord Review Cards node');
const jsonBody = notifyNode.parameters.jsonBody || '';
assert(jsonBody.includes('$json.id') && jsonBody.includes('$json.solution_id'), 'Notify Discord Review Cards must accept $json.id || $json.solution_id');
assert((jsonBody.includes('$json.titleEn') || jsonBody.includes('$json.titleTh')) && jsonBody.includes('$json.solution_title'), 'Notify Discord Review Cards must accept solution title from both paths');

console.log('✅ Flow 2 AI bypass and workflow structure tests passed successfully!');


