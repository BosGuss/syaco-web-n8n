/**
 * test-copy-article.js
 * Unit test for formatCopyArticlePayload verifying that:
 * 1. Articles are returned in a single reply (replies.length === 1) without dividing into parts.
 * 2. No file attachments are included (files.length === 0, no download).
 * 3. Message length is always <= 2,000 characters under all circumstances.
 * 4. 1,800-character articles fit fully without truncation.
 */

// Hook module resolution for discord.js if run in standalone environment without NODE_PATH
const Module = require('module');
const origResolve = Module._resolveFilename;
const fallbackPaths = [
  'C:\\Users\\dYflyTaxi\\AppData\\Roaming\\npm\\node_modules\\n8n\\node_modules',
  require('path').join(process.env.APPDATA || '', 'npm/node_modules/n8n/node_modules')
];
Module._resolveFilename = function (request, parent, isMain, options) {
  try {
    return origResolve.call(this, request, parent, isMain, options);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      for (const fallback of fallbackPaths) {
        try {
          return origResolve.call(this, request, { paths: [fallback] }, isMain, options);
        } catch (_) {}
      }
    }
    throw err;
  }
};

const assert = require('assert');
const { formatCopyArticlePayload } = require('./commands');

console.log('🧪 Starting Copy Article Unit Tests (testing commands.formatCopyArticlePayload)...\n');

// Test 1: Short article (800 chars)
console.log('Test 1: Testing short article...');
const shortDraft = {
  title_th: 'ระบบ ERP สำหรับโรงงาน',
  tags: ['erp', 'manufacturing'],
  platform: 'manual_article',
  content_markdown: '# บทความ\n' + 'ก'.repeat(700)
};
const res1 = formatCopyArticlePayload(101, shortDraft);
assert.strictEqual(res1.replies.length, 1, 'Must be 1 single reply without dividing into parts');
assert.strictEqual(res1.replies[0].files.length, 0, 'Must not attach any download files');
assert.ok(!res1.replies[0].content.includes('[ตอนที่'), 'Must not have episode/part markers');
assert.ok(res1.replies[0].content.length <= 2000, `Length ${res1.replies[0].content.length} exceeds 2000`);
console.log(`  ✅ Short article single reply length: ${res1.replies[0].content.length} <= 2000\n`);

// Test 2: Source Max Article (1,800 chars)
console.log('Test 2: Testing source-capped article (1,800 chars)...');
const cappedDraft = {
  title_th: 'คู่มือการวางระบบ Smart Inventory & WMS',
  tags: ['wms', 'warehouse', 'inventory'],
  platform: 'manual_article',
  content_markdown: '## หัวข้อ 1\n' + 'ข'.repeat(1780)
};
const res2 = formatCopyArticlePayload(102, cappedDraft);
assert.strictEqual(res2.replies.length, 1, 'Must be 1 single reply');
assert.strictEqual(res2.replies[0].files.length, 0, 'Must not attach any download files');
assert.ok(!res2.replies[0].content.includes('[ตอนที่'), 'Must not have episode/part markers');
assert.ok(res2.replies[0].content.length <= 2000, `Length ${res2.replies[0].content.length} exceeds 2000`);
assert.ok(res2.replies[0].content.includes('ข'.repeat(1780)), 'Full 1800 character article must be preserved intact without truncation');
console.log(`  ✅ 1,800 chars article preserved intact (total reply length: ${res2.replies[0].content.length} <= 2000)\n`);

// Test 3: Legacy Over-sized Article (2,500 chars)
console.log('Test 3: Testing legacy oversized article (2,500 chars)...');
const legacyDraft = {
  title_th: 'สถาปัตยกรรมระบบ SCADA และ PLC',
  tags: ['scada', 'plc', 'iot'],
  platform: 'manual_article',
  content_markdown: '## Deep Dive\n' + 'ค'.repeat(2480)
};
const res3 = formatCopyArticlePayload(103, legacyDraft);
assert.strictEqual(res3.replies.length, 1, 'Must be 1 single reply even for legacy oversized articles');
assert.strictEqual(res3.replies[0].files.length, 0, 'Must not attach any download files');
assert.ok(!res3.replies[0].content.includes('[ตอนที่'), 'Must not have episode/part markers');
assert.ok(res3.replies[0].content.length <= 2000, `Reply length ${res3.replies[0].content.length} exceeds 2000`);
console.log(`  ✅ Legacy article safely clamped in single reply (length: ${res3.replies[0].content.length} <= 2000)\n`);

console.log('🎉 ALL COPY ARTICLE TESTS PASSED SUCCESSFULLY! (Single message copy, no parts, no downloads)');
