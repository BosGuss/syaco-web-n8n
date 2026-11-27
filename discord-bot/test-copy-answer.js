/**
 * test-copy-answer.js
 * Unit test for formatCopyAnswerPayload verifying that:
 * 1. Short answers (< 1800 chars) fit into a single ephemeral message under 2000 chars.
 * 2. Long answers (> 1800 - 4500 chars) are cleanly chunked so EVERY message is < 2000 chars.
 * 3. File attachment is properly attached for long answers.
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
const { formatCopyAnswerPayload } = require('./commands');

console.log('🧪 Starting Copy Answer Unit Tests (testing commands.formatCopyAnswerPayload)...\n');

// Test 1: Short answer (500 chars)
console.log('Test 1: Testing short answer under limit...');
const shortRow = {
  answer: 'ก'.repeat(500),
  platform: 'pantip',
  post_url: 'https://pantip.com/topic/12345678'
};
const res1 = formatCopyAnswerPayload(1, shortRow);
assert.strictEqual(res1.replies.length, 1);
assert.ok(res1.replies[0].content.length <= 2000, `Length ${res1.replies[0].content.length} exceeds 2000`);
console.log(`  ✅ Short answer single reply length: ${res1.replies[0].content.length} <= 2000\n`);

// Test 2: Borderline / Long answer (2200 chars - typical of the error reported by user)
console.log('Test 2: Testing long answer (2,200 chars) that previously threw 2000 limit error...');
const longRow = {
  answer: 'ข'.repeat(2200),
  platform: 'pantip',
  post_url: 'https://pantip.com/topic/42500123'
};
const res2 = formatCopyAnswerPayload(2, longRow);
assert.strictEqual(res2.replies.length, 2, 'Should be split into 2 replies');
assert.ok(res2.replies[0].content.length <= 2000, `Part 1 length ${res2.replies[0].content.length} exceeds 2000`);
assert.ok(res2.replies[1].content.length <= 2000, `Part 2 length ${res2.replies[1].content.length} exceeds 2000`);
assert.strictEqual(res2.replies[0].files.length, 1, 'Should attach text file');
assert.strictEqual(res2.replies[0].files[0].name, 'answer-candidate-2.txt');
console.log(`  ✅ Part 1 length: ${res2.replies[0].content.length} <= 2000`);
console.log(`  ✅ Part 2 length: ${res2.replies[1].content.length} <= 2000`);
console.log('  ✅ Attachment generated with correct file name.\n');

// Test 3: Very long answer (4,500 chars)
console.log('Test 3: Testing very long answer (4,500 chars)...');
const veryLongRow = {
  answer: 'ค'.repeat(4500),
  platform: 'facebook',
  post_url: 'https://www.facebook.com/groups/it/posts/999999'
};
const res3 = formatCopyAnswerPayload(3, veryLongRow);
assert.strictEqual(res3.replies.length, 3, 'Should be split into 3 replies');
res3.replies.forEach((rep, idx) => {
  assert.ok(rep.content.length <= 2000, `Part ${idx + 1} length ${rep.content.length} exceeds 2000`);
  console.log(`  ✅ Part ${idx + 1} length: ${rep.content.length} <= 2000`);
});

console.log('\n🎉 ALL COPY ANSWER TESTS PASSED SUCCESSFULLY!');
