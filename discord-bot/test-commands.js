const assert = require('assert');
const { commands, handleCommand, normalizeDevtoCookie } = require('./commands');

console.log('🧪 Starting Discord Bot Commands Unit Tests...\n');

// Test 1: Verify commands list structure
console.log('Test 1: Verifying slash commands definitions...');
const cmdNames = commands.map(c => c.name);
assert(!cmdNames.includes('set-gemini-key'), 'set-gemini-key should be removed');
assert(!cmdNames.includes('set-gemini-model'), 'set-gemini-model should be removed');
assert(!cmdNames.includes('set-cookie'), 'duplicate set-cookie should be removed');
assert(cmdNames.includes('set-devto-cookie'), 'set-devto-cookie must exist');

const devtoCmd = commands.find(c => c.name === 'set-devto-cookie');
assert(devtoCmd, 'set-devto-cookie command must exist');
const devtoOptions = devtoCmd.options || [];
assert.strictEqual(devtoOptions.length, 0, 'set-devto-cookie must NOT have any options (modal only)');
console.log('  ✅ Slash commands cleanly trimmed: set-cookie, set-gemini-key, set-gemini-model removed; set-devto-cookie has 0 options.');

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

  // Test 3: Verify /set-channel executes separate queries (no multiple statements in single parameterized query)
  console.log('\nTest 3: Testing /set-channel separates CREATE TABLE and INSERT queries...');
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
  assert.strictEqual(queriesExecuted.length, 2, 'Should execute exactly 2 separate queries');
  assert(queriesExecuted[0].sql.includes('CREATE TABLE IF NOT EXISTS bot_settings'), 'First query should be CREATE TABLE');
  assert(!queriesExecuted[0].params, 'First query should have no parameters');
  assert(queriesExecuted[1].sql.includes('INSERT INTO bot_settings'), 'Second query should be INSERT');
  assert.deepStrictEqual(queriesExecuted[1].params, ['123456789012345678'], 'Second query should pass channel ID');
  assert(replyMessage, 'Reply message should be sent');
  console.log('  ✅ /set-channel executed CREATE TABLE and INSERT as 2 independent queries with zero semicolon parameter bugs.');

  // Test 4: Verify /set-admin-ids separates queries
  console.log('\nTest 4: Testing /set-admin-ids separates CREATE TABLE and INSERT queries...');
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
  assert.strictEqual(queriesExecuted.length, 2, 'Should execute exactly 2 separate queries');
  assert(queriesExecuted[0].sql.includes('CREATE TABLE IF NOT EXISTS bot_settings'), 'First query should be CREATE TABLE');
  assert(!queriesExecuted[0].params, 'First query should have no parameters');
  assert(queriesExecuted[1].sql.includes('INSERT INTO bot_settings'), 'Second query should be INSERT');
  assert.deepStrictEqual(queriesExecuted[1].params, ['11111111,22222222']);
  console.log('  ✅ /set-admin-ids executed CREATE TABLE and INSERT as 2 independent queries.');

  console.log('\n🎉 ALL 4 TESTS PASSED SUCCESSFULLY! Commands refactoring is completely verified.');
})().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
