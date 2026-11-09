const assert = require('assert');
const {
  computeBlueskyFacet,
  sanitizeDevtoTags,
  publishToBluesky,
  publishToDevto,
  publishToHashnode,
  publishDraft,
  rejectDraft
} = require('./flow2-publisher');

async function runTests() {
  console.log('🧪 Starting Flow 2 Publisher Unit Tests...\n');

  // Test 1: computeBlueskyFacet
  console.log('Test 1: Testing computeBlueskyFacet...');
  const text1 = 'ระบบเชื่อมต่อ PLC เข้า SAP อัตโนมัติ ดูรายละเอียดที่ https://www.syaco.co.th/solutions/plc';
  const facets1 = computeBlueskyFacet(text1);
  assert.strictEqual(facets1.length, 1);
  assert.strictEqual(facets1[0].features[0].uri, 'https://www.syaco.co.th/solutions/plc');
  const buf = Buffer.from(text1, 'utf8');
  const sliceUrl = buf.slice(facets1[0].index.byteStart, facets1[0].index.byteEnd).toString('utf8');
  assert.strictEqual(sliceUrl, 'https://www.syaco.co.th/solutions/plc');
  console.log('  ✅ computeBlueskyFacet matches exact UTF-8 byte range.\n');

  // Test 2: sanitizeDevtoTags
  console.log('Test 2: Testing sanitizeDevtoTags...');
  const rawTags = ['SAP ERP', 'เชื่อมต่อ', 'PLC-2026', 'Modbus/TCP', 'Node.js', 'Extra'];
  const cleanTags = sanitizeDevtoTags(rawTags);
  assert.deepStrictEqual(cleanTags, ['saperp', 'plc2026', 'modbustcp', 'nodejs']);
  console.log('  ✅ sanitizeDevtoTags properly cleans and limits tags.\n');

  // Test 3: publishToBluesky with simulated endpoint
  console.log('Test 3: Testing publishToBluesky...');
  const mockFetchBluesky = async (url, options) => {
    if (url.includes('createSession')) {
      return {
        ok: true,
        json: async () => ({
          accessJwt: 'mock-jwt-token',
          did: 'did:plc:mockdid123',
          handle: 'test-user.bsky.social'
        })
      };
    }
    if (url.includes('createRecord')) {
      return {
        ok: true,
        json: async () => ({
          uri: 'at://did:plc:mockdid123/app.bsky.feed.post/3mockrkey456',
          cid: 'mockcid'
        })
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const bskyResult = await publishToBluesky({
    draft: { content_markdown: 'SyaCo Enterprise Platform https://www.syaco.co.th/solutions/ai' },
    fetchFn: mockFetchBluesky,
    handle: 'test-user.bsky.social',
    appPassword: 'mock-password'
  });
  assert.strictEqual(bskyResult.postedUrl, 'https://bsky.app/profile/test-user.bsky.social/post/3mockrkey456');
  console.log('  ✅ publishToBluesky successfully created session and posted.\n');

  // Test 4: publishToDevto with simulated endpoint
  console.log('Test 4: Testing publishToDevto...');
  const mockFetchDevto = async (url, options) => {
    assert.strictEqual(options.headers['api-key'], 'mock-devto-key');
    return {
      ok: true,
      json: async () => ({
        id: 998877,
        url: 'https://dev.to/syaco/automated-data-pipelines-998877'
      })
    };
  };

  const devtoResult = await publishToDevto({
    draft: { title_th: 'โซลูชัน Data Pipeline', content_markdown: '# Markdown', tags: ['architecture'] },
    fetchFn: mockFetchDevto,
    apiKey: 'mock-devto-key'
  });
  assert.strictEqual(devtoResult.postedUrl, 'https://dev.to/syaco/automated-data-pipelines-998877');
  console.log('  ✅ publishToDevto successfully sent article payload.\n');

  // Test 5: publishToHashnode with simulated endpoint
  console.log('Test 5: Testing publishToHashnode...');
  const mockFetchHashnode = async (url, options) => {
    assert.strictEqual(options.headers['Authorization'], 'mock-hashnode-token');
    return {
      ok: true,
      json: async () => ({
        data: {
          publishPost: {
            post: {
              id: 'hashnode-post-1',
              url: 'https://blog.syaco.co.th/automated-data-pipelines',
              title: 'โซลูชัน Data Pipeline'
            }
          }
        }
      })
    };
  };

  const hashnodeResult = await publishToHashnode({
    draft: { title_th: 'โซลูชัน Data Pipeline', content_markdown: '# Content', tags: ['cloud'] },
    fetchFn: mockFetchHashnode,
    token: 'mock-hashnode-token',
    publicationId: 'pub123'
  });
  assert.strictEqual(hashnodeResult.postedUrl, 'https://blog.syaco.co.th/automated-data-pipelines');
  console.log('  ✅ publishToHashnode successfully executed GraphQL mutation.\n');

  // Test 6: In-memory mock database for publishDraft & rejectDraft
  console.log('Test 6: Testing publishDraft with atomic DB locking...');
  const dbStore = new Map();
  dbStore.set(101, {
    id: 101,
    platform: 'bluesky',
    content_markdown: 'Bluesky test post https://www.syaco.co.th/solutions/1',
    status: 'pending_review',
    posted_url: null
  });
  dbStore.set(102, {
    id: 102,
    platform: 'bluesky',
    content_markdown: 'Already posted',
    status: 'posted',
    posted_url: 'https://bsky.app/profile/syaco/post/already'
  });
  dbStore.set(103, {
    id: 103,
    platform: 'devto',
    content_markdown: 'Failing devto post',
    status: 'pending_review'
  });

  const mockPool = {
    query: async (sql, params) => {
      if (sql.includes('UPDATE content_drafts') && sql.includes("SET status = 'publishing'")) {
        const id = params[0];
        const row = dbStore.get(id);
        if (row && (row.status === 'pending_review' || row.status === 'failed')) {
          row.status = 'publishing';
          return { rows: [row] };
        }
        return { rows: [] };
      }
      if (sql.includes('SELECT id, status, posted_url, platform FROM content_drafts')) {
        const id = params[0];
        const row = dbStore.get(id);
        return { rows: row ? [{ id: row.id, status: row.status, posted_url: row.posted_url, platform: row.platform }] : [] };
      }
      if (sql.includes('UPDATE content_drafts') && sql.includes("SET status = 'posted'")) {
        const url = params[0];
        const id = params[1];
        const row = dbStore.get(id);
        if (row) {
          row.status = 'posted';
          row.posted_url = url;
        }
        return { rows: [row] };
      }
      if (sql.includes('UPDATE content_drafts') && sql.includes("SET status = 'failed'")) {
        const errMsg = params[0];
        const id = params[1];
        const row = dbStore.get(id);
        if (row) {
          row.status = 'failed';
          row.error_message = errMsg;
        }
        return { rows: [row] };
      }
      if (sql.includes('UPDATE content_drafts') && sql.includes("SET status = 'rejected'")) {
        const id = params[0];
        const row = dbStore.get(id);
        if (row) {
          row.status = 'rejected';
        }
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };

  const publishOk = await publishDraft({
    id: 101,
    pool: mockPool,
    fetchFn: mockFetchBluesky,
    config: {
      bluesky: { handle: 'test-user.bsky.social', appPassword: 'password' }
    }
  });
  assert.strictEqual(publishOk.success, true);
  assert.strictEqual(publishOk.platform, 'bluesky');
  assert.strictEqual(dbStore.get(101).status, 'posted');
  console.log('  ✅ publishDraft successfully transitioned draft status to posted.\n');

  // Test 7: Idempotency conflict
  console.log('Test 7: Testing conflict on already posted draft...');
  const publishConflict = await publishDraft({
    id: 102,
    pool: mockPool,
    fetchFn: mockFetchBluesky
  });
  assert.strictEqual(publishConflict.success, false);
  assert.strictEqual(publishConflict.code, 'ALREADY_PROCESSED');
  console.log(`  ✅ Idempotency enforced: ${publishConflict.message}\n`);

  // Test 8: Non-existent ID
  console.log('Test 8: Testing non-existent draft ID...');
  const publishNotFound = await publishDraft({
    id: 9999,
    pool: mockPool,
    fetchFn: mockFetchBluesky
  });
  assert.strictEqual(publishNotFound.success, false);
  assert.strictEqual(publishNotFound.code, 'NOT_FOUND');
  console.log(`  ✅ NOT_FOUND caught cleanly: ${publishNotFound.message}\n`);

  // Test 9: Failure handling
  console.log('Test 9: Testing failure handling when API call fails...');
  const mockFetchFailing = async () => {
    throw new Error('Dev.to server unavailable 503');
  };
  const publishFailed = await publishDraft({
    id: 103,
    pool: mockPool,
    fetchFn: mockFetchFailing,
    config: { devto: { apiKey: 'key' } }
  });
  assert.strictEqual(publishFailed.success, false);
  assert.strictEqual(dbStore.get(103).status, 'failed');
  assert.strictEqual(publishFailed.error, 'Dev.to server unavailable 503');
  console.log('  ✅ API failure caught cleanly and DB updated to failed.\n');

  // Test 10: rejectDraft
  console.log('Test 10: Testing rejectDraft...');
  const rejectRes = await rejectDraft({ id: 101, pool: mockPool });
  assert.strictEqual(rejectRes.success, true);
  assert.strictEqual(dbStore.get(101).status, 'rejected');
  console.log('  ✅ rejectDraft successfully updated status to rejected.\n');

  console.log('🎉 ALL 10 TESTS PASSED SUCCESSFULLY! Flow 2 direct publishing engine is completely solid.');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
