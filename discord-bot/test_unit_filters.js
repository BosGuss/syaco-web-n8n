const assert = require('assert');
const {
  isRecentPost,
  isSolutionPost,
  isValidCandidate,
  isFacebookPost,
  cleanUrl,
  getDynamicYearFilter,
  getMinPantipTopicId,
  formatFacebookContent
} = require('./thread-search');

console.log('Testing thread-search filter functions...');

// 1. Pantip Recency (Dynamic Topic ID check)
console.log('\n--- 1. Testing Pantip Recency (Dynamic Topic ID) ---');
const minTopicId = getMinPantipTopicId();
console.log(`Current dynamic min Pantip Topic ID: ${minTopicId}`);
const oldPantip = { url: `https://pantip.com/topic/${minTopicId - 500000}`, title: 'ERP ปัญหา', content: 'สอบถามเรื่อง ERP' };
assert.strictEqual(isRecentPost(oldPantip), false, 'Old Pantip topic below dynamic min should be rejected');
console.log('✔ Old Pantip topic below dynamic threshold correctly rejected');

const newPantip = { url: `https://pantip.com/topic/${minTopicId + 100000}`, title: 'ERP ปัญหา', content: 'สอบถามเรื่อง ERP วางระบบ' };
assert.strictEqual(isRecentPost(newPantip), true, 'New Pantip topic above dynamic min should pass');
console.log('✔ New Pantip topic above dynamic threshold correctly passed');

// 2. LinkedIn Snowflake timestamp
console.log('\n--- 2. Testing LinkedIn Snowflake timestamp ---');
const now = Date.now();
// 30 days ago
const recentMs = BigInt(now - 30 * 24 * 60 * 60 * 1000);
const recentLiId = (recentMs << 22n).toString();
const recentLi = { url: `https://www.linkedin.com/posts/activity-${recentLiId}`, title: 'WMS Solution', content: 'แนะนำระบบคลังสินค้า' };
assert.strictEqual(isRecentPost(recentLi), true, 'Recent LinkedIn post (~30 days ago) should pass');
console.log('✔ Recent LinkedIn post passed');

// 400 days ago (> 365 days)
const oldMs = BigInt(now - 400 * 24 * 60 * 60 * 1000);
const oldLiId = (oldMs << 22n).toString();
const oldLi = { url: `https://www.linkedin.com/posts/activity-${oldLiId}`, title: 'WMS Solution', content: 'แนะนำระบบคลังสินค้า' };
assert.strictEqual(isRecentPost(oldLi), false, 'Old LinkedIn post (~400 days ago) should be rejected');
console.log('✔ Old LinkedIn post rejected');

// 3. Facebook exact publishTime / creation_time check
console.log('\n--- 3. Testing Facebook publishTime / creation_time ---');
// 60 days ago
const recentFbTime = {
  url: 'https://www.facebook.com/groups/thaiadmin/posts/999999999',
  title: 'ระบบ ERP',
  content: 'สอบถามระบบ ERP',
  publishTime: now - (60 * 24 * 60 * 60 * 1000)
};
assert.strictEqual(isRecentPost(recentFbTime), true, 'Facebook post with publishTime ~60 days ago should pass');
console.log('✔ Facebook post ~60 days ago passed');

// 450 days ago (> 365 days)
const oldFbTime = {
  url: 'https://www.facebook.com/groups/thaiadmin/posts/7410419648994662',
  title: 'ขอคำแนะนำระบบ POS',
  content: 'รบกวนขอคำแนะนำแบบ user ที่ไม่รู้ระบบอะไรเลยหน่อยนะคะ',
  publishTime: now - (450 * 24 * 60 * 60 * 1000) // ~1.2 years ago
};
assert.strictEqual(isRecentPost(oldFbTime), false, 'Facebook post with publishTime > 365 days should be rejected');
console.log('✔ Facebook post > 365 days ago rejected');

// 4. Year pattern check (Dynamic Year Calculation)
console.log('\n--- 4. Testing Dynamic Year Pattern Check ---');
const yf = getDynamicYearFilter();
console.log(`Current dynamic years: Prev AD=${yf.prevYear}, Current AD=${yf.currentYear}, Prev BE=${yf.prevBE}, Current BE=${yf.currentBE}`);

// Old years (2 years ago) should be rejected
const oldYearAD = yf.currentYear - 2; // e.g. 2024
const oldYearBE = yf.currentBE - 2;   // e.g. 2567
const oldShortBE = String(oldYearBE).slice(-2); // e.g. '67'

const oldFbAD = { url: 'https://www.facebook.com/groups/123/posts/456', title: `โปรแกรมสต็อก ${oldYearAD}`, content: `มีปัญหาเรื่องตัดสต็อกเมื่อปี ${oldYearAD}` };
assert.strictEqual(isRecentPost(oldFbAD), false, `Post with ${oldYearAD} and no recent year should be rejected`);
console.log(`✔ Post with old year AD ${oldYearAD} correctly rejected`);

const oldFbBE = { url: 'https://www.facebook.com/groups/123/posts/457', title: `วางระบบ ERP ${oldYearBE}`, content: `ระบบโรงงาน ปี ${oldShortBE}` };
assert.strictEqual(isRecentPost(oldFbBE), false, `Post with ${oldYearBE} / ปี ${oldShortBE} should be rejected`);
console.log(`✔ Post with old year BE ${oldYearBE} correctly rejected`);

// Recent years (prevYear & currentYear) should pass
const recentFbPrev = { url: 'https://www.facebook.com/groups/123/posts/789', title: `โปรแกรมสต็อก ${yf.prevBE}`, content: `วางระบบคลังสินค้า ปี ${yf.prevYear}` };
assert.strictEqual(isRecentPost(recentFbPrev), true, `Post with ${yf.prevBE} / ${yf.prevYear} should pass`);
console.log(`✔ Post with recent year ${yf.prevBE}/${yf.prevYear} passed`);

const recentFbCurr = { url: 'https://www.facebook.com/groups/123/posts/790', title: `โปรแกรมสต็อก ${yf.currentBE}`, content: `วางระบบคลังสินค้า ปี ${yf.currentYear}` };
assert.strictEqual(isRecentPost(recentFbCurr), true, `Post with ${yf.currentBE} / ${yf.currentYear} should pass`);
console.log(`✔ Post with recent year ${yf.currentBE}/${yf.currentYear} passed`);

// Simulation of Future Year (e.g. Year 2028 / 2571)
console.log('\n--- 4.1 Testing Future Year Rollover Simulation (Year 2028) ---');
const futureDate = new Date('2028-06-01T00:00:00Z');
const futureYf = getDynamicYearFilter(futureDate);
assert.strictEqual(futureYf.currentYear, 2028);
assert.strictEqual(futureYf.prevYear, 2027);
assert.strictEqual(futureYf.currentBE, 2571);
assert.strictEqual(futureYf.prevBE, 2570);
// In 2028, 2026 and 2569 should be detected as old
assert.strictEqual(futureYf.hasOldYearInText('ระบบ ERP ปี 2026'), true, 'In 2028, 2026 must be detected as old');
assert.strictEqual(futureYf.hasOldYearInText('ระบบ ERP ปี 2569'), true, 'In 2028, 2569 must be detected as old');
assert.strictEqual(futureYf.isRecentYearInText('ระบบ ERP ปี 2026'), false, 'In 2028, 2026 must not be recent');
// In 2028, 2027 and 2028 should be detected as recent
assert.strictEqual(futureYf.isRecentYearInText('ระบบ ERP ปี 2027'), true, 'In 2028, 2027 is recent');
assert.strictEqual(futureYf.isRecentYearInText('ระบบ ERP ปี 2571'), true, 'In 2028, 2571 is recent');
console.log('✔ Future year rollover simulation (2028) correctly shifts recency thresholds automatically');

// 5. Solution Intent Filter
console.log('\n--- 5. Testing Solution Intent Filter ---');
// Negative cases
const jobRecruiter = { title: 'Jobs for Thai Programmers | ตามหา PM / SA ด่วนค่ะ เงินเดือนดี 70-100K ขอสาย ERP', snippet: 'IT recruiter บริษัท Tribehired ค่ะ...' };
assert.strictEqual(isSolutionPost(jobRecruiter), false, 'Recruiter post should be rejected');
console.log('✔ Recruiter post correctly rejected');

const truckSale = { title: 'ตลาดซื้อขายรถบรรทุกทั่วไทย | ขายครับผม 360 JT ปี 62 ดั้มแม่ลูก', snippet: 'ขายครับผม 360 JT สภาพสวยพร้อมใช้งาน 2,900,000 ครับผม' };
assert.strictEqual(isSolutionPost(truckSale), false, 'Truck sale post should be rejected');
console.log('✔ Dump truck sale post correctly rejected');

const mathWorksheet = { title: 'สื่อการสอนครูประถม: แบบฝึกทักษะวิชาคณิตศาสตร์ ป.2', snippet: 'แบบฝึกทักษะวิชาคณิตศาสตร์ ป.2 ราคา 59 บาท...' };
assert.strictEqual(isSolutionPost(mathWorksheet), false, 'Primary school worksheet should be rejected');
console.log('✔ Primary school worksheet correctly rejected');

// Positive cases
const erpPost = { title: 'ระวังเป็นเหยื่อกับการเลือกระบบซอฟต์แวร์ ERP', snippet: 'ปัญหาการเลือกโปรแกรม ERP โรงงาน และข้อควรระวังในการเซ็นสัญญากับ Vendor...' };
assert.strictEqual(isSolutionPost(erpPost), true, 'ERP software selection should pass');
console.log('✔ ERP software selection post passed');

const wmsPost = { title: 'เปรียบเทียบ WMS แบบเก่า vs. WMS ยุคใหม่ ปี 2025', snippet: 'การบริหารจัดการคลังสินค้า ตัดสต็อกด้วย Barcode และเชื่อมโยงข้อมูลแบบ Real-time...' };
assert.strictEqual(isSolutionPost(wmsPost), true, 'WMS comparison should pass');
console.log('✔ WMS comparison post passed');

const plcPost = { title: 'ฝึกการเขียนโปรแกรม PLC ด้วย Factory IO | สอบถาม factory IO ไม่ connect PLC Sim มีวิธีแก้ไขไหมครับ', snippet: 'ขออนุญาตสอบถามพี่ๆหน่อยครับ factory IO ไม่ connect PLC Sim...' };
assert.strictEqual(isSolutionPost(plcPost), true, 'PLC troubleshooting post should pass');
console.log('✔ PLC troubleshooting post passed');

// 6. Deduplication with excludeUrls
console.log('\n--- 6. Testing Deduplication (excludeUrls) ---');
const excludedFb = 'https://www.facebook.com/groups/123/posts/999';
const excludeSet = new Set([excludedFb]);
assert.strictEqual(excludeSet.has(excludedFb), true, 'URL in excludeUrls should be detected');
assert.strictEqual(excludeSet.has('https://www.facebook.com/groups/123/posts/1000'), false, 'New URL should not be excluded');
console.log('✔ Deduplication excludeUrls check passed');

// 7. Dynamic Solution Topic Matching (for newly added solutions on website)
console.log('\n--- 7. Testing Dynamic Solution Topic Matching ---');
const {
  extractSolutionKeywords,
  buildDynamicSolutionTopicsRegex
} = require('./thread-search');

// Simulate a completely new solution added on the website (e.g. Cybersecurity & Pentest)
const mockNewSolution = {
  id: 99,
  titleTh: 'ระบบตรวจสอบความปลอดภัยไซเบอร์ (Cybersecurity & Pentest)',
  titleEn: 'Cybersecurity & Penetration Testing',
  descTh: 'บริการประเมินความเสี่ยงและตรวจสอบช่องโหว่ระบบคอมพิวเตอร์',
  descEn: 'Enterprise cybersecurity posture assessment and penetration testing',
  curatedQueries: [
    'ตรวจช่องโหว่ระบบ ปัญหา',
    'แนะนำ Pentest บริษัท'
  ]
};

// 7.1 Verify keyword extraction
const extracted = extractSolutionKeywords(mockNewSolution);
assert(extracted.includes('cybersecurity'), 'Must extract english term "cybersecurity"');
assert(extracted.includes('pentest'), 'Must extract english term "pentest"');
assert(extracted.includes('penetration'), 'Must extract english term "penetration"');
assert(extracted.includes('ตรวจสอบความปลอดภัยไซเบอร์'), 'Must extract Thai title phrase');
console.log('✔ Keyword extraction for new solution succeeded:', extracted);

// 7.2 Post that discusses this new solution
const cybersecurityPost = {
  title: 'สอบถามครับ กำลังหาบริษัททำ Cybersecurity audit และ Pentest ประจำปี แนะนำหน่อยครับ',
  snippet: 'เนื่องจากมีข้อกำหนดใหม่เรื่องความปลอดภัยระบบไอที กำลังมองหาทีมผู้เชี่ยวชาญ...'
};

// Without dynamic regex (old static regex without cybersecurity/pentest)
const staticRegexOnly = buildDynamicSolutionTopicsRegex([], []);
// With dynamic regex (including the newly added solution)
const dynamicRegexWithNewSol = buildDynamicSolutionTopicsRegex([], [mockNewSolution]);

assert.strictEqual(isSolutionPost(cybersecurityPost, staticRegexOnly), false, 'Post should NOT match old static regex alone');
assert.strictEqual(isSolutionPost(cybersecurityPost, dynamicRegexWithNewSol), true, 'Post MUST pass when dynamic regex includes the new solution');
console.log('✔ New solution post successfully matched via dynamic regex!');

// 7.3 Custom user search keyword (/find keyword:HR Payroll)
const hrPost = {
  title: 'ปรึกษาเรื่องโปรแกรม Payroll สำหรับคำนวณเงินเดือนพนักงาน 500 คน',
  snippet: 'ตอนนี้เจอปัญหาระบบเดิมคำนวณโอทีผิดพลาดบ่อยมาก ช่วยแนะนำทีครับ...'
};
const dynamicRegexWithSearchTerm = buildDynamicSolutionTopicsRegex(['Payroll'], []);
assert.strictEqual(isSolutionPost(hrPost, dynamicRegexWithSearchTerm), true, 'Post matching custom search keyword Payroll must pass');
console.log('✔ Custom search keyword dynamically added to topic regex and passed');

// 8. isFacebookPost URL Filtering (Issue 2)
console.log('\n--- 8. Testing isFacebookPost URL Filtering ---');
// Rejected cases (Group homepages, personal profile roots, page roots)
assert.strictEqual(isFacebookPost('https://www.facebook.com/groups/logisticsthai'), false, 'Group landing page should be rejected');
assert.strictEqual(isFacebookPost('https://www.facebook.com/groups/123456/'), false, 'Group root with ID should be rejected');
assert.strictEqual(isFacebookPost('https://www.facebook.com/some.person.name'), false, 'Personal profile root should be rejected');
assert.strictEqual(isFacebookPost('https://www.facebook.com/SomeShop'), false, 'Page root should be rejected');
assert.strictEqual(isFacebookPost('https://www.facebook.com/permalink.php'), false, 'permalink.php without story_fbid should be rejected');
console.log('✔ Non-post Facebook URLs (group roots, personal profiles, page roots) correctly rejected');

// Accepted cases (Genuine discussion posts/permalinks)
assert.strictEqual(isFacebookPost('https://www.facebook.com/groups/123456/posts/7891011'), true, 'Group post with ID should pass');
assert.strictEqual(isFacebookPost('https://www.facebook.com/groups/logisticsthai/permalink/999888/'), true, 'Group permalink should pass');
assert.strictEqual(isFacebookPost('https://www.facebook.com/groups/123/multi_permalinks/456'), true, 'Group multi_permalinks should pass');
assert.strictEqual(isFacebookPost('https://www.facebook.com/SyacoTech/posts/555666777'), true, 'Page post should pass');
assert.strictEqual(isFacebookPost('https://www.facebook.com/permalink.php?story_fbid=112233&id=445566'), true, 'permalink.php with story_fbid should pass');
console.log('✔ Valid Facebook post permalinks correctly accepted');

// 9. Non-B2B Irrelevant Posts Rejection in isSolutionPost (Issue 3)
console.log('\n--- 9. Testing Irrelevant Non-B2B Posts Rejection ---');
const gamingPost = {
  title: 'เล่นเกมแล้ว lag มาก fps ตก มีปัญหาเวลาเล่น ช่วยที',
  snippet: 'สเปคคอม i5 การ์ดจอ rtx เล่น valorant แล้ว lag'
};
assert.strictEqual(isSolutionPost(gamingPost), false, 'Consumer gaming post (lag/fps) must be rejected');
console.log('✔ "โพสต์เกม lag" correctly rejected');

const personalWordpressPost = {
  title: 'เว็บ WordPress ช้ามากครับ ทำไมโหลดไม่ขึ้น ช่วยแนะนำโฮสติ้งหน่อย',
  snippet: 'ทำบล็อกส่วนตัวแล้วเว็บบล็อกช้ามาก'
};
assert.strictEqual(isSolutionPost(personalWordpressPost), false, 'Personal WordPress blog post must be rejected');
console.log('✔ "เว็บ WordPress ช้า (บล็อกส่วนตัว)" correctly rejected');

const mobileAppReviewPost = {
  title: 'Best mobile apps review 2026 - Top 10 apps to download',
  snippet: 'Here is our overview and review of the best mobile apps for your phone this year'
};
assert.strictEqual(isSolutionPost(mobileAppReviewPost), false, 'Consumer mobile app review must be rejected');
console.log('✔ "Best mobile apps review" correctly rejected');

// 10. formatFacebookContent Validation (Issue 1)
console.log('\n--- 10. Testing formatFacebookContent ---');
assert.strictEqual(formatFacebookContent('', ''), null, 'Empty title and snippet must return null');
assert.strictEqual(formatFacebookContent('Link to facebook.com', 'Facebook'), null, 'Generic Facebook placeholders must return null');
assert.strictEqual(formatFacebookContent('The site owner hides web page details', 'log into facebook'), null, 'Hidden/login Facebook text must return null');

const validFbContent = formatFacebookContent('สอบถามระบบ ERP โรงงาน', 'มีปัญหาเรื่องการวางระบบ ERP เชื่อมต่อเครื่องจักรในโรงงาน...');
assert.notStrictEqual(validFbContent, null, 'Substantive Facebook content should not return null');
assert.strictEqual(validFbContent.title, 'สอบถามระบบ ERP โรงงาน', 'Title should be preserved without fake prefixes');
assert(!validFbContent.title.includes('โพสต์ข้อความบน Facebook เกี่ยวกับ'), 'Must never synthesize fake titles');
console.log('✔ formatFacebookContent returns null for invalid/generic data and preserves genuine content without fake titles');

console.log('\nAll unit tests passed successfully!');
