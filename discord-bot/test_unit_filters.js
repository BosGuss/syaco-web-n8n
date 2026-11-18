const assert = require('assert');
const {
  isRecentPost,
  isSolutionPost,
  isValidCandidate,
  isFacebookPost,
  cleanUrl
} = require('./thread-search');

console.log('Testing thread-search filter functions...');

// 1. Pantip Recency
console.log('\n--- 1. Testing Pantip Recency ---');
const oldPantip = { url: 'https://pantip.com/topic/42900000', title: 'ERP ปัญหา', content: 'สอบถามเรื่อง ERP' };
assert.strictEqual(isRecentPost(oldPantip), false, 'Old Pantip topic < 43300000 should be rejected');
console.log('✔ Old Pantip topic < 43300000 correctly rejected');

const newPantip = { url: 'https://pantip.com/topic/43500000', title: 'ERP ปัญหา', content: 'สอบถามเรื่อง ERP วางระบบ' };
assert.strictEqual(isRecentPost(newPantip), true, 'New Pantip topic >= 43300000 should pass');
console.log('✔ New Pantip topic >= 43300000 correctly passed');

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

// 4. Year pattern check (Facebook & general)
console.log('\n--- 4. Testing Old Year pattern check ---');
const oldFb2564 = { url: 'https://www.facebook.com/groups/123/posts/456', title: 'โปรแกรมสต็อก 2564', content: 'มีปัญหาเรื่องตัดสต็อกเมื่อปี 2564' };
assert.strictEqual(isRecentPost(oldFb2564), false, 'Post with 2564 and no recent year should be rejected');
console.log('✔ Post with old year 2564 correctly rejected');

const oldFb2567 = { url: 'https://www.facebook.com/groups/123/posts/457', title: 'วางระบบ ERP 2567', content: 'ระบบโรงงาน ปี 2024' };
assert.strictEqual(isRecentPost(oldFb2567), false, 'Post with 2567 / 2024 should be rejected in 2026');
console.log('✔ Post with 2567/2024 correctly rejected in 2026');

const newFb = { url: 'https://www.facebook.com/groups/123/posts/789', title: 'โปรแกรมสต็อก 2568', content: 'วางระบบคลังสินค้า ปี 2025' };
assert.strictEqual(isRecentPost(newFb), true, 'Post with 2568 / 2025 should pass');
console.log('✔ Post with recent year 2568/2025 passed');

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

console.log('\nAll unit tests passed successfully!');
