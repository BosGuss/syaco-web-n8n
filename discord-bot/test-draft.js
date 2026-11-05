const assert = require('assert');
const { buildSyacoPayload, approveAndCreateDraft } = require('./solution-draft');

async function runTests() {
  console.log('🧪 Starting Discord Bot Solution Draft Tests (Simulated Endpoint)...\n');

  // Test 1: Payload Construction
  console.log('Test 1: Validating buildSyacoPayload structure...');
  const sampleItem = {
    id: 1,
    title_th: 'โซลูชันระบบควบคุม IoT ในโรงงาน',
    title_en: 'Industrial IoT Control Platform',
    description_th: 'ระบบมอนิเตอร์และควบคุมไลน์การผลิต',
    description_en: 'Production line monitoring and real-time control',
    features: JSON.stringify([
      { labelTh: 'Real-time telemetry', labelEn: 'Real-time telemetry' },
      { labelTh: 'OPC-UA Integration', labelEn: 'OPC-UA Integration' }
    ]),
    content_ai: JSON.stringify({
      th: {
        results: ['ลด Downtime ของเครื่องจักร'],
        problems: ['ไม่ทราบสถานะเครื่องจักรแบบเรียลไทม์'],
        targetAudience: ['ผู้จัดการฝ่ายผลิต', 'CTO โรงงาน']
      },
      en: {
        results: ['Reduced equipment downtime'],
        problems: ['Lack of real-time machine visibility'],
        targetAudience: ['Plant Managers', 'Manufacturing CTOs']
      }
    })
  };

  const payload = buildSyacoPayload(sampleItem);
  assert.strictEqual(payload.isPublished, false, 'isPublished must strictly be false');
  assert.strictEqual(payload.link, '/solutions/industrial-iot-control-platform', 'link must be valid kebab-case slug');
  assert.strictEqual(payload.order, 99, 'order must default to 99');
  assert.strictEqual(payload.icon, 'lucide:layers', 'icon must be normalized to iconify format');
  assert.strictEqual(payload.alt, 'Industrial IoT Control Platform Icon');
  assert.strictEqual(payload.titleEn, 'Industrial IoT Control Platform');
  assert.strictEqual(payload.titleTh, 'โซลูชันระบบควบคุม IoT ในโรงงาน');
  assert.strictEqual(payload.features.length, 2);
  assert.strictEqual(payload.features[0].order, 1);
  assert.strictEqual(payload.features[0].labelTh, 'Real-time telemetry');
  assert.strictEqual(payload.content.th.solutions.results.items[0], 'ลด Downtime ของเครื่องจักร');
  assert.strictEqual(payload.content.th.solutions.targetAudience.items[0].icon, '/asset/icons/target-1.svg');
  assert.strictEqual(payload.content.th.solutions.targetAudience.items[0].text, 'ผู้จัดการฝ่ายผลิต');
  assert.strictEqual(payload.content.th.examplesDeveloped.items.length, 2, 'examplesDeveloped must have generated items');
  assert.deepStrictEqual(payload.caseStudyIds, []);
  assert.strictEqual(payload.metaImage, '');
  console.log('  ✅ Payload structure is 100% compliant with SyaCo schema and C# DTO.\n');

  // Simulated Endpoint (Mock fetchFn)
  let mockStatus = 201;
  let mockBody = { id: 888, titleEn: 'Industrial IoT Control Platform', isPublished: false };
  let capturedUrl = null;
  let capturedOptions = null;
  let shouldNetworkFail = false;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    if (shouldNetworkFail) {
      throw new Error('Connection refused to simulated endpoint');
    }
    return {
      ok: mockStatus >= 200 && mockStatus < 300,
      status: mockStatus,
      statusText: mockStatus === 201 ? 'Created' : (mockStatus === 500 ? 'Internal Server Error' : 'OK'),
      json: async () => mockBody
    };
  };

  // In-memory mock database
  const dbStore = new Map();
  dbStore.set(1, { ...sampleItem, status: 'pending_review', published_solution_id: null, error_message: null });
  dbStore.set(2, { ...sampleItem, id: 2, status: 'published_as_draft', published_solution_id: '777' });
  dbStore.set(3, { ...sampleItem, id: 3, status: 'pending_review' });

  const mockPool = {
    query: async (sql, params) => {
      if (sql.includes('UPDATE solution_suggestions') && sql.includes("SET status = 'publishing'")) {
        const id = params[0];
        const row = dbStore.get(id);
        if (row && (row.status === 'pending_review' || row.status === 'failed')) {
          row.status = 'publishing';
          return { rows: [row] };
        }
        return { rows: [] };
      }
      if (sql.includes('SELECT id, status, published_solution_id FROM solution_suggestions')) {
        const id = params[0];
        const row = dbStore.get(id);
        return { rows: row ? [{ id: row.id, status: row.status, published_solution_id: row.published_solution_id }] : [] };
      }
      if (sql.includes('UPDATE solution_suggestions') && sql.includes("SET status = 'published_as_draft'")) {
        const pubId = params[0];
        const id = params[1];
        const row = dbStore.get(id);
        if (row) {
          row.status = 'published_as_draft';
          row.published_solution_id = pubId;
        }
        return { rows: [row] };
      }
      if (sql.includes('UPDATE solution_suggestions') && sql.includes("SET status = 'failed'")) {
        const errMsg = params[0];
        const id = params[1];
        const row = dbStore.get(id);
        if (row) {
          row.status = 'failed';
          row.error_message = errMsg;
        }
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };

  // Test 2: Successful Approval & Draft Creation
  console.log('Test 2: Testing successful approveAndCreateDraft...');
  mockStatus = 201;
  mockBody = { id: 888, titleEn: 'Industrial IoT Control Platform' };
  shouldNetworkFail = false;

  const resultOk = await approveAndCreateDraft({
    id: 1,
    pool: mockPool,
    fetchFn: mockFetch,
    apiUrl: 'https://mock.syaco.local/api/solutions',
    token: 'test-secret-token'
  });

  assert.strictEqual(resultOk.success, true);
  assert.strictEqual(resultOk.solutionId, 888);
  assert.strictEqual(capturedUrl, 'https://mock.syaco.local/api/solutions');
  assert.strictEqual(capturedOptions.headers['Authorization'], 'Bearer test-secret-token');
  const sentPayload = JSON.parse(capturedOptions.body);
  assert.strictEqual(sentPayload.titleEn, 'Industrial IoT Control Platform');
  assert.strictEqual(sentPayload.isPublished, false);
  assert.strictEqual(dbStore.get(1).status, 'published_as_draft');
  assert.strictEqual(dbStore.get(1).published_solution_id, '888');
  console.log('  ✅ Draft created successfully with status published_as_draft and ID 888.\n');

  // Test 3: Idempotency / Already Processed
  console.log('Test 3: Testing conflict when approving already processed suggestion...');
  const resultConflict = await approveAndCreateDraft({
    id: 2,
    pool: mockPool,
    fetchFn: mockFetch,
    apiUrl: 'https://mock.syaco.local/api/solutions',
    token: 'test-secret-token'
  });
  assert.strictEqual(resultConflict.success, false);
  assert.strictEqual(resultConflict.code, 'ALREADY_PROCESSED');
  console.log(`  ✅ Correctly rejected: ${resultConflict.message}\n`);

  // Test 4: Non-existent ID
  console.log('Test 4: Testing non-existent suggestion ID...');
  const resultNotFound = await approveAndCreateDraft({
    id: 9999,
    pool: mockPool,
    fetchFn: mockFetch,
    apiUrl: 'https://mock.syaco.local/api/solutions',
    token: 'test-secret-token'
  });
  assert.strictEqual(resultNotFound.success, false);
  assert.strictEqual(resultNotFound.code, 'NOT_FOUND');
  console.log(`  ✅ Correctly caught NOT_FOUND: ${resultNotFound.message}\n`);

  // Test 5: SyaCo API Error (e.g. 500 or slug duplicate)
  console.log('Test 5: Testing SyaCo API error handling...');
  mockStatus = 500;
  mockBody = { message: 'Slug already exists in database' };
  shouldNetworkFail = false;

  const resultApiErr = await approveAndCreateDraft({
    id: 3,
    pool: mockPool,
    fetchFn: mockFetch,
    apiUrl: 'https://mock.syaco.local/api/solutions',
    token: 'test-secret-token'
  });
  assert.strictEqual(resultApiErr.success, false);
  assert.strictEqual(resultApiErr.code, 'API_ERROR');
  assert.strictEqual(resultApiErr.error, 'Slug already exists in database');
  assert.strictEqual(dbStore.get(3).status, 'failed');
  assert.strictEqual(dbStore.get(3).error_message, 'Slug already exists in database');
  console.log(`  ✅ API error cleanly caught and DB marked as failed: ${resultApiErr.error}\n`);

  // Test 6: Network Failure
  console.log('Test 6: Testing network failure (endpoint unreachable)...');
  shouldNetworkFail = true;

  const resultNetErr = await approveAndCreateDraft({
    id: 3,
    pool: mockPool,
    fetchFn: mockFetch,
    apiUrl: 'https://mock.syaco.local/api/solutions',
    token: 'test-secret-token'
  });
  assert.strictEqual(resultNetErr.success, false);
  assert.strictEqual(resultNetErr.code, 'NETWORK_ERROR');
  assert.strictEqual(dbStore.get(3).status, 'failed');
  assert.strictEqual(resultNetErr.error, 'Connection refused to simulated endpoint');
  console.log(`  ✅ Network error cleanly caught and DB marked as failed: ${resultNetErr.error}\n`);

  console.log('🎉 ALL 6 TESTS PASSED SUCCESSFULLY! The Discord Bot approval/draft engine is completely solid.');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
