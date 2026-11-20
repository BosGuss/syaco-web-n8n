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
const { commands, handleCommand, normalizeDevtoCookie, saveAndVerifyDevtoKey, buildFlow2Card, handleFlow2DraftsNotify } = require('./commands');

console.log('🧪 Starting Discord Bot Commands Unit Tests...\n');

// Test 1: Verify commands list structure
console.log('Test 1: Verifying slash commands definitions...');
const cmdNames = commands.map(c => c.name);
assert(!cmdNames.includes('set-gemini-key'), 'set-gemini-key should be removed');
assert(!cmdNames.includes('set-gemini-model'), 'set-gemini-model should be removed');
assert(!cmdNames.includes('set-cookie'), 'duplicate set-cookie should be removed');
assert(cmdNames.includes('status'), 'status command must exist');
assert(cmdNames.includes('settings'), 'settings command must exist');
assert(cmdNames.includes('find'), 'find command must exist');

// Verify /drafts command definition
assert(cmdNames.includes('drafts'), 'drafts command must exist in commands array');
const draftsCmd = commands.find(c => c.name === 'drafts');
assert(draftsCmd, 'drafts command must exist');
const draftsOptions = draftsCmd.options || [];
const limitOpt = draftsOptions.find(o => o.name === 'limit');
assert(limitOpt, 'drafts command must have optional limit option');
assert.strictEqual(limitOpt.required, false, 'limit option must be optional');
const viewOpt = draftsOptions.find(o => o.name === 'view');
assert(viewOpt, 'drafts command must have optional view option');
assert.strictEqual(viewOpt.required, false, 'view option must be optional');
console.log('  ✅ Slash commands cleanly defined: /drafts registered with limit and view options.');

(async () => {
  const queriesExecuted = [];
  const mockPool = {
    query: async (sql, params) => {
      queriesExecuted.push({ sql: sql.trim(), params });
      return { rows: [] };
    }
  };

  // Test 2: Verify /set-devto-cookie opens modal directly
  console.log('\nTest 2: Testing /set-devto-cookie directly shows modal...');
  let shownModal = null;
  const mockDevtoInteraction = {
    commandName: 'set-devto-cookie',
    showModal: async (m) => {
      shownModal = m;
    }
  };
  await handleCommand(mockDevtoInteraction, { pool: mockPool, client: {} });
  assert(shownModal, 'Modal should be shown');
  assert.strictEqual(shownModal.data.custom_id, 'modal_devto_cookie');
  console.log('  ✅ /set-devto-cookie immediately triggers modal_devto_cookie.');

  // Test 3: Verify /set-devto-key opens modal directly
  console.log('\nTest 3: Testing /set-devto-key directly shows modal...');
  let shownKeyModal = null;
  const mockDevtoKeyInteraction = {
    commandName: 'set-devto-key',
    showModal: async (m) => {
      shownKeyModal = m;
    }
  };
  await handleCommand(mockDevtoKeyInteraction, { pool: mockPool, client: {} });
  assert(shownKeyModal, 'Modal should be shown');
  assert.strictEqual(shownKeyModal.data.custom_id, 'modal_devto_key');
  console.log('  ✅ /set-devto-key immediately triggers modal_devto_key.');

  // Test 4: Verify /set-channel executes query
  console.log('\nTest 4: Testing /set-channel executes INSERT query...');
  queriesExecuted.length = 0;

  let replyMessage = null;
  const mockChannelInteraction = {
    commandName: 'set-channel',
    deferReply: async () => {},
    options: {
      getChannel: () => ({ id: '123456789012345678', name: 'general' })
    },
    channel: { id: '123456789012345678', name: 'general' },
    guild: { name: 'Test Guild' },
    editReply: async (msg) => {
      replyMessage = msg;
    }
  };

  await handleCommand(mockChannelInteraction, { pool: mockPool, client: {} });
  assert.strictEqual(queriesExecuted.length, 1, 'Should execute exactly 1 query');
  assert(queriesExecuted[0].sql.includes('INSERT INTO bot_settings'), 'Query should be INSERT');
  assert.deepStrictEqual(queriesExecuted[0].params, ['123456789012345678'], 'Query should pass channel ID');
  assert(replyMessage, 'Reply message should be sent');
  console.log('  ✅ /set-channel executed INSERT query safely.');

  // Test 5: Verify /set-admin-ids executes query
  console.log('\nTest 5: Testing /set-admin-ids executes INSERT query...');
  queriesExecuted.length = 0;
  replyMessage = null;
  const mockAdminInteraction = {
    commandName: 'set-admin-ids',
    deferReply: async () => {},
    options: {
      getString: () => '11111111, 22222222'
    },
    user: { id: '11111111' },
    editReply: async (msg) => {
      replyMessage = msg;
    }
  };
  process.env.DISCORD_ADMIN_IDS = '11111111';

  await handleCommand(mockAdminInteraction, { pool: mockPool, client: {} });
  assert.strictEqual(queriesExecuted.length, 1, 'Should execute exactly 1 query');
  assert(queriesExecuted[0].sql.includes('INSERT INTO bot_settings'), 'Query should be INSERT');
  assert.deepStrictEqual(queriesExecuted[0].params, ['11111111,22222222']);
  console.log('  ✅ /set-admin-ids executed INSERT query safely.');

  // Test 6: Verify /drafts when empty
  console.log('\nTest 6: Testing /drafts when no pending drafts exist...');
  queriesExecuted.length = 0;
  let draftsReply = null;
  const mockDraftsEmptyInteraction = {
    commandName: 'drafts',
    deferReply: async () => {},
    options: {
      getInteger: (name) => (name === 'limit' ? 5 : null),
      getString: (name) => (name === 'view' ? 'pending' : null)
    },
    editReply: async (msg) => {
      draftsReply = msg;
    }
  };

  await handleCommand(mockDraftsEmptyInteraction, { pool: mockPool, client: {} });
  assert.strictEqual(queriesExecuted.length, 1, 'Should execute exactly 1 query to content_drafts');
  assert(queriesExecuted[0].sql.includes('FROM content_drafts'), 'Query should target content_drafts');
  assert(queriesExecuted[0].sql.includes("status = 'pending_review'"), "Query must filter by status = 'pending_review'");
  assert(typeof draftsReply === 'string' && draftsReply.includes('ไม่มีดราฟต์บทความค้างตรวจ'), 'Should reply with friendly empty message');
  console.log('  ✅ /drafts correctly queries content_drafts and handles empty state.');

  // Test 7: Verify /drafts with pending items (produces cards with action buttons)
  console.log('\nTest 7: Testing /drafts with pending items returning review cards...');
  queriesExecuted.length = 0;
  const mockDraftRows = [
    {
      id: 101,
      solution_id: '88',
      solution_title: 'Smart Warehouse Management',
      platform: 'bluesky',
      title_th: 'โซลูชันระบบจัดการคลังสินค้า',
      content_markdown: 'เนื้อหาทดสอบ Bluesky',
      tags: ['wms', 'iot'],
      status: 'pending_review',
      created_at: new Date()
    },
    {
      id: 102,
      solution_id: '88',
      solution_title: 'Smart Warehouse Management',
      platform: 'devto',
      title_th: 'โซลูชันระบบจัดการคลังสินค้า Dev.to',
      content_markdown: 'เนื้อหาทดสอบ Dev.to',
      tags: ['wms', 'cloud'],
      status: 'pending_review',
      created_at: new Date()
    },
    {
      id: 103,
      solution_id: '88',
      solution_title: 'Smart Warehouse Management',
      platform: 'manual',
      title_th: 'โซลูชันระบบจัดการคลังสินค้า Enterprise',
      content_markdown: 'เนื้อหาทดสอบ Manual',
      tags: ['wms', 'enterprise'],
      status: 'pending_review',
      created_at: new Date()
    }
  ];

  const mockDraftsPool = {
    query: async (sql, params) => {
      queriesExecuted.push({ sql: sql.trim(), params });
      return { rows: mockDraftRows };
    }
  };

  const followUpMessages = [];
  let overviewEdit = null;
  const mockDraftsInteraction = {
    commandName: 'drafts',
    deferReply: async () => {},
    options: {
      getInteger: (name) => (name === 'limit' ? 5 : null),
      getString: () => null
    },
    editReply: async (msg) => {
      overviewEdit = msg;
    },
    followUp: async (msg) => {
      followUpMessages.push(msg);
    }
  };

  await handleCommand(mockDraftsInteraction, { pool: mockDraftsPool, client: {} });
  assert.strictEqual(queriesExecuted.length, 1);
  assert(overviewEdit, 'Should send overview reply');
  assert.strictEqual(followUpMessages.length, 3, 'Should follow up with 3 draft review cards');

  // Verify buttons in the action rows
  const blueskyComponents = followUpMessages[0].components[0].components;
  assert(blueskyComponents.some(btn => btn.data.custom_id === 'flow2_publish_101'), 'Bluesky card must have flow2_publish_101');
  assert(blueskyComponents.some(btn => btn.data.custom_id === 'flow2_reject_101'), 'Bluesky card must have flow2_reject_101');

  const devtoComponents = followUpMessages[1].components[0].components;
  assert(devtoComponents.some(btn => btn.data.custom_id === 'flow2_publish_102'), 'Devto card must have flow2_publish_102');

  const manualComponents = followUpMessages[2].components[0].components;
  assert(manualComponents.some(btn => btn.data.custom_id === 'flow2_copy_103'), 'Manual card must have flow2_copy_103');
  console.log('  ✅ /drafts correctly sends overview embed and review cards with Flow 2 buttons.');

  // Test 8: Verify /status view:pending queries both backlink_candidates and content_drafts
  console.log('\nTest 8: Testing /status view:pending queries both backlink_candidates and content_drafts...');
  queriesExecuted.length = 0;
  let statusEdit = null;
  const statusFollowUps = [];

  const mockStatusPool = {
    query: async (sql, params) => {
      queriesExecuted.push({ sql: sql.trim(), params });
      if (sql.includes('backlink_candidates')) {
        return {
          rows: [
            {
              id: 501,
              platform: 'pantip',
              post_title: 'กระทู้ระบบ ERP Pantip',
              post_url: 'https://pantip.com/topic/12345',
              match_score: 95,
              status: 'pending_review',
              created_at: new Date()
            }
          ]
        };
      }
      if (sql.includes('content_drafts')) {
        return {
          rows: [
            {
              id: 201,
              solution_id: '99',
              solution_title: 'AI Inspection',
              platform: 'bluesky',
              title_th: 'ระบบตรวจสอบ AI',
              content_markdown: 'เนื้อหา Bluesky AI',
              tags: ['ai'],
              status: 'pending_review',
              created_at: new Date()
            }
          ]
        };
      }
      return { rows: [] };
    }
  };

  const mockStatusInteraction = {
    commandName: 'status',
    deferReply: async () => {},
    options: {
      getString: (name) => (name === 'view' ? 'pending' : null),
      getInteger: (name) => (name === 'limit' ? 5 : null)
    },
    editReply: async (msg) => {
      statusEdit = msg;
    },
    followUp: async (msg) => {
      statusFollowUps.push(msg);
    }
  };

  await handleCommand(mockStatusInteraction, { pool: mockStatusPool, client: {} });
  const queriedTables = queriesExecuted.map(q => q.sql);
  assert(queriedTables.some(sql => sql.includes('backlink_candidates')), 'Must query backlink_candidates');
  assert(queriedTables.some(sql => sql.includes('content_drafts')), 'Must query content_drafts');

  assert(statusEdit && statusEdit.embeds && statusEdit.embeds.length > 0, 'Must send unified summary embed');
  const embedDesc = JSON.stringify(statusEdit.embeds[0].data);
  assert(embedDesc.includes('Flow 3') || embedDesc.includes('กระทู้'), 'Summary embed must mention Flow 3 / กระทู้');
  assert(embedDesc.includes('Flow 2') || embedDesc.includes('ดราฟต์'), 'Summary embed must mention Flow 2 / ดราฟต์');

  assert.strictEqual(statusFollowUps.length, 2, 'Should follow up with cards for both Flow 3 candidate and Flow 2 draft');
  console.log('  ✅ /status view:pending successfully integrates both Flow 3 and Flow 2 pending items.');

  // Test 9: Verify /notify logic for flow2_drafts with solution_id '90'
  console.log("\nTest 9: Testing /notify logic with { type: 'flow2_drafts', solution_id: '90' }...");
  queriesExecuted.length = 0;
  const channelSends = [];
  const mockNotifyChannel = {
    send: async (payload) => {
      channelSends.push(payload);
    }
  };

  // 9a: When solution_id: '90' has no pending drafts
  const emptyNotifyRes = await handleFlow2DraftsNotify({
    pool: mockPool,
    channel: mockNotifyChannel,
    solution_id: '90'
  });
  assert.strictEqual(emptyNotifyRes.ok, true);
  assert.strictEqual(emptyNotifyRes.message, 'No pending drafts found');
  assert.strictEqual(channelSends.length, 0);

  // 9b: When solution_id: '90' has pending drafts
  const mockNotifyDrafts = [
    {
      id: 901,
      platform: 'bluesky',
      title_th: 'โซลูชันระบบ AI ตรวจสอบการผลิต Solution 90',
      content_markdown: 'โพสต์สั้นเกี่ยวกับ Solution 90',
      tags: ['ai', 'vision'],
      solution_id: '90'
    },
    {
      id: 902,
      platform: 'devto',
      title_th: 'เทคนิค AI ตรวจจับของเสียในโรงงาน Dev.to',
      content_markdown: 'บทความ Dev.to แบบละเอียด Solution 90',
      tags: ['devto', 'ai'],
      solution_id: '90'
    },
    {
      id: 903,
      platform: 'manual',
      title_th: 'Enterprise AI Inspection Manual Solution 90',
      content_markdown: 'คู่มือสำหรับเซลส์ Solution 90',
      tags: ['enterprise', 'sales'],
      solution_id: '90'
    }
  ];

  const mockNotifyPool = {
    query: async (sql, params) => {
      queriesExecuted.push({ sql: sql.trim(), params });
      return { rows: mockNotifyDrafts };
    }
  };

  const notifyRes = await handleFlow2DraftsNotify({
    pool: mockNotifyPool,
    channel: mockNotifyChannel,
    solution_id: '90',
    solution_title: 'Enterprise AI Inspection #90'
  });

  assert.strictEqual(notifyRes.ok, true);
  assert.strictEqual(notifyRes.type, 'flow2_drafts');
  assert.strictEqual(notifyRes.count, 3);
  assert.strictEqual(channelSends.length, 3);

  // Validate cards
  assert(channelSends[0].embeds[0].data.title.includes('Bluesky'));
  assert(channelSends[0].components[0].components.some(btn => btn.data.custom_id === 'flow2_publish_901'));

  assert(channelSends[1].embeds[0].data.title.includes('Dev.to'));
  assert(channelSends[1].components[0].components.some(btn => btn.data.custom_id === 'flow2_publish_902'));
  assert(channelSends[1].components[0].components.some(btn => btn.data.custom_id === 'flow2_edit_902'));

  assert(channelSends[2].embeds[0].data.title.includes('บทความยาว'));
  assert(channelSends[2].components[0].components.some(btn => btn.data.custom_id === 'flow2_copy_903'));

  console.log('  ✅ /notify with { type: "flow2_drafts", solution_id: "90" } builds valid Flow 2 review cards seamlessly.');

  console.log('\n🎉 ALL 9 TESTS PASSED SUCCESSFULLY! Discord Bot commands and /notify logic are fully verified.');
})().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
