/**
 * test-ui-flow3.js
 * Unit test verifying that the Flow 3 Radar UI:
 * 1. Has removed quick action buttons [⚡ ร่างข้อ 1-5]
 * 2. Retains only the StringSelectMenu component row
 * 3. Contains the updated instruction copy and placeholder
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
const { buildRadarEmbedsAndMenu } = require('./commands');

console.log('🧪 Starting Flow 3 UI Improvement Unit Tests...\n');

const mockThreads = [
  { id: 101, platform: 'pantip', post_title: 'กำลังมองหาโปรแกรม WMS แนะนำทีครับ', snippet: 'สต็อกของไม่ตรง', solutionCategory: 'warehouse' },
  { id: 102, platform: 'facebook', post_title: 'แจกฟรี Template จัดการคลังสินค้า', snippet: 'แนวทางบริหารสต็อก', solutionCategory: 'warehouse' },
  { id: 103, platform: 'linkedin', post_title: 'ERP Integration best practices', snippet: 'SAP and PLC connections', solutionCategory: 'data' }
];

const mockSolutions = ['Warehouse Management', 'Data Integration'];

// Test 1: Verify components structure
const { embeds, components } = buildRadarEmbedsAndMenu(mockThreads, mockSolutions);

console.log('Test 1: Verifying components array structure...');
assert.strictEqual(components.length, 1, `Expected 1 ActionRow (Select Menu only), got ${components.length}`);

const actionRow = components[0];
assert.ok(actionRow.components && actionRow.components.length === 1, 'ActionRow should contain exactly 1 component');

const selectMenu = actionRow.components[0];
assert.strictEqual(selectMenu.data.type, 3, 'Component should be a String Select Menu (type 3)');
assert.strictEqual(selectMenu.data.custom_id, 'select_radar_draft', 'Custom ID should be select_radar_draft');
console.log('  ✅ Components contain only the Select Menu row.');

// Test 2: Verify NO draft buttons (lead_draft_) exist anywhere in components
console.log('Test 2: Verifying no draft buttons exist...');
const allButtons = actionRow.components.filter(c => c.data.type === 2);
assert.strictEqual(allButtons.length, 0, `Expected 0 buttons, found ${allButtons.length}`);

for (const comp of actionRow.components) {
  assert.ok(!comp.data.custom_id || !comp.data.custom_id.startsWith('lead_draft_'), 'Found legacy lead_draft_ button');
}
console.log('  ✅ No [⚡ ร่างข้อ 1-5] buttons present in components.');

// Test 3: Verify Embed description instruction copy
console.log('Test 3: Verifying Embed instructional copy...');
const embedDesc = embeds[0].data.description;
assert.ok(!embedDesc.includes('แตะปุ่ม **[⚡ ร่างข้อ X]**'), 'Embed description should not reference draft buttons');
assert.ok(embedDesc.includes('🎯 **วิธีสั่งงาน:** เลือกกระทู้จากเมนูดรอปดาวน์ด้านล่างเพื่อสั่ง AI ร่างคำตอบทันที'), 'Embed description should include updated dropdown instruction');
console.log('  ✅ Embed description correctly updated.');

// Test 4: Verify Select Menu placeholder text
console.log('Test 4: Verifying Select Menu placeholder...');
assert.strictEqual(selectMenu.data.placeholder, '🎯 เลือกกระทู้ที่ต้องการให้ AI ช่วยตอบจากเมนูนี้...', 'Placeholder should match updated wording');
console.log('  ✅ Select Menu placeholder correctly updated.');

console.log('\n🎉 ALL FLOW 3 UI TESTS PASSED SUCCESSFULLY!');
