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

console.log('✅ Flow 2 sanitization and UTF-8 byte offset tests passed.');
