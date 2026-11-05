const https = require('https');
const assert = require('assert');

function fetchUrl(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
  });
}

function parseRss(xmlText, sourceName) {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const items = [];
  const itemBlocks = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemBlocks) {
    const titleMatch = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const descMatch = block.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/i);
    const title = (titleMatch ? titleMatch[1] : '').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    const desc = (descMatch ? descMatch[1] : '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').trim();
    const link = (linkMatch ? linkMatch[1] : '').trim();
    if (title) {
      items.push({ source: sourceName, title, desc: desc.slice(0, 300), link });
    }
  }
  return items;
}

async function run() {
  console.log('1. Reproducing old URL issue (https://www.blognone.com/feed)...');
  const oldRes = await fetchUrl('https://www.blognone.com/feed', {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  });
  console.log(`   Old URL status: ${oldRes.statusCode}`);
  assert(oldRes.statusCode === 404 || oldRes.statusCode === 403, 'Old URL should fail with 404 or 403');

  console.log('2. Testing correct URL (https://www.blognone.com/node/feed)...');
  const newRes = await fetchUrl('https://www.blognone.com/node/feed', {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  console.log(`   New URL status: ${newRes.statusCode}`);
  assert.strictEqual(newRes.statusCode, 200, 'New URL should return 200');

  console.log('3. Testing RSS parsing on Blognone XML...');
  const bnItems = parseRss(newRes.data, 'Blognone');
  console.log(`   Parsed ${bnItems.length} items from Blognone.`);
  assert(bnItems.length > 0, 'Should parse items from Blognone');
  assert(bnItems[0].title, 'Item must have title');
  assert(bnItems[0].link, 'Item must have link');

  console.log('4. Testing TechTalkThai Feed...');
  const tttRes = await fetchUrl('https://www.techtalkthai.com/feed/', {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  console.log(`   TechTalkThai status: ${tttRes.statusCode}`);
  assert.strictEqual(tttRes.statusCode, 200, 'TechTalkThai should return 200');
  const tttItems = parseRss(tttRes.data, 'TechTalkThai');
  console.log(`   Parsed ${tttItems.length} items from TechTalkThai.`);
  assert(tttItems.length > 0, 'Should parse items from TechTalkThai');

  console.log('\nAll tests passed successfully!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
