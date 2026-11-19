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
  const processed = new Set(
    processedDbRows
      .map(i => String(i.solution_id || ''))
      .filter(id => id && id !== '__INIT__')
  );

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

  const newSolutions = allSolutions.filter(s => s && s.id && !processed.has(String(s.id)));
  return newSolutions.map(s => ({
    id: String(s.id),
    titleEn: s.titleEn || '',
    titleTh: s.titleTh || '',
    descEn: s.content?.en?.hero?.description || s.descEn || '',
    descTh: s.content?.th?.hero?.description || s.descTh || '',
    link: s.link || `/solutions/${s.id}`,
    url: `https://www.syaco.co.th${s.link || `/solutions/${s.id}`}`
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

