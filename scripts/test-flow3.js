const assert = require('assert');

function normalizeUrl(rawUrl, platform) {
  try {
    const u = new URL(rawUrl.trim());
    if (platform === 'pantip' || u.hostname.includes('pantip.com')) {
      const m = u.pathname.match(/\/topic\/(\d+)/);
      return m ? `https://pantip.com/topic/${m[1]}` : u.origin + u.pathname;
    }
    if (platform === 'facebook_group' || u.hostname.includes('facebook.com')) {
      const keepParams = ['story_fbid', 'id', 'post_id'];
      const newParams = new URLSearchParams();
      keepParams.forEach(p => { if (u.searchParams.has(p)) newParams.set(p, u.searchParams.get(p)); });
      const qs = newParams.toString();
      return u.origin + u.pathname + (qs ? '?' + qs : '');
    }
    return u.origin + u.pathname;
  } catch (e) {
    return rawUrl.trim();
  }
}

// 1. Pantip URL normalizer
const p1 = normalizeUrl('https://pantip.com/topic/43012345?utm_source=facebook&utm_medium=share', 'pantip');
assert.strictEqual(p1, 'https://pantip.com/topic/43012345');

// 2. Facebook Group URL normalizer (Must retain story_fbid/id)
const fb1 = normalizeUrl('https://www.facebook.com/groups/itprothailand/permalink/?story_fbid=987654321&id=123456789&ref=notif', 'facebook_group');
assert(fb1.includes('story_fbid=987654321'));
assert(fb1.includes('id=123456789'));
assert(!fb1.includes('ref=notif'));

// 3. Blognone URL normalizer
const bn1 = normalizeUrl('https://www.blognone.com/node/139999?fbclid=IwAR2345', 'blognone');
assert.strictEqual(bn1, 'https://www.blognone.com/node/139999');

console.log('✅ Flow 3 platform-aware URL normalization tests passed.');
