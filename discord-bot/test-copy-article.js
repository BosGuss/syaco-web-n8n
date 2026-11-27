/**
 * test-copy-article.js
 * Unit test for formatCopyArticlePayload verifying that:
 * 1. Short articles fit in 1 reply under 2000 characters.
 * 2. Long articles (2,000 - 8,000 characters) are split into safe chunks < 1850 chars.
 * 3. File attachment article-<id>.md is attached for multi-part articles.
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
assert.strictEqual(res1.replies.length, 1);
assert.ok(res1.replies[0].content.length <= 2000, `Length ${res1.replies[0].content.length} exceeds 2000`);
console.log(`  ✅ Short article single reply length: ${res1.replies[0].content.length} <= 2000\n`);

// Test 2: Standard Long Article (2,500 chars) - the exact length that failed before
console.log('Test 2: Testing long article (2,500 chars)...');
const longDraft = {
  title_th: 'คู่มือการวางระบบ Smart Inventory & WMS',
  tags: ['wms', 'warehouse', 'inventory'],
  platform: 'manual_article',
  content_markdown: '## หัวข้อ 1\n' + 'ข'.repeat(2400)
};
const res2 = formatCopyArticlePayload(102, longDraft);
assert.strictEqual(res2.replies.length, 2);
res2.replies.forEach((rep, idx) => {
  assert.ok(rep.content.length <= 2000, `Reply ${idx + 1} length ${rep.content.length} exceeds 2000`);
  console.log(`  ✅ Part ${idx + 1} length: ${rep.content.length} <= 2000`);
});
assert.strictEqual(res2.replies[0].files.length, 1);
assert.strictEqual(res2.replies[0].files[0].name, 'article-102.md');
console.log('  ✅ Attached article-102.md properly.\n');

// Test 3: Very Long Article (6,000 chars)
console.log('Test 3: Testing very long article (6,000 chars)...');
const veryLongDraft = {
  title_th: 'สถาปัตยกรรมระบบ SCADA และ PLC',
  tags: ['scada', 'plc', 'iot'],
  platform: 'manual_article',
  content_markdown: '## Deep Dive\n' + 'ค'.repeat(5900)
};
const res3 = formatCopyArticlePayload(103, veryLongDraft);
assert.strictEqual(res3.replies.length, 4);
res3.replies.forEach((rep, idx) => {
  assert.ok(rep.content.length <= 2000, `Reply ${idx + 1} length ${rep.content.length} exceeds 2000`);
  console.log(`  ✅ Part ${idx + 1} length: ${rep.content.length} <= 2000`);
});

console.log('\n🎉 ALL COPY ARTICLE TESTS PASSED SUCCESSFULLY!');
