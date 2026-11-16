/**
 * thread-search.js
 * ค้นหากระทู้และโพสต์ที่น่าสนใจในช่วง 1 ปีที่ผ่านมา (Pantip, LinkedIn, Facebook)
 * ผ่าน SearXNG (Google CSE Engine)
 */

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://searxng:8080';

/**
 * ทำความสะอาด URL และตัดพารามิเตอร์ที่ไม่จำเป็น
 */
function cleanUrl(rawUrl, platform) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    if (platform === 'pantip' || u.hostname.includes('pantip.com')) {
      const m = u.pathname.match(/\/topic\/(\d+)/);
      return m ? `https://pantip.com/topic/${m[1]}` : u.origin + u.pathname;
    }
    if (platform === 'linkedin' || u.hostname.includes('linkedin.com')) {
      return u.origin + u.pathname;
    }
    if (platform === 'facebook' || u.hostname.includes('facebook.com')) {
      const keepParams = ['story_fbid', 'id', 'post_id'];
      const newParams = new URLSearchParams();
      keepParams.forEach(p => {
        if (u.searchParams.has(p)) newParams.set(p, u.searchParams.get(p));
      });
      const qs = newParams.toString();
      return u.origin + u.pathname + (qs ? '?' + qs : '');
    }
    return u.origin + u.pathname;
  } catch (_) {
    return rawUrl.split('?')[0].split('#')[0];
  }
}

/**
 * ระบุ Platform จาก URL
 */
function detectPlatform(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('pantip.com')) return 'pantip';
  if (u.includes('linkedin.com')) return 'linkedin';
  if (u.includes('facebook.com')) return 'facebook';
  return null;
}

/**
 * ตรวจสอบความถูกต้องของ URL และกรองระยะเวลาไม่เกิน 1 ปี
 */
function isValidCandidate(item, targetPlatform = 'all') {
  const url = item.url || '';
  const title = item.title || '';
  const content = item.content || '';
  const fullText = `${title} ${content}`;

  const platform = detectPlatform(url);
  if (!platform) return false;
  if (targetPlatform !== 'all' && platform !== targetPlatform) return false;

  // 1. Pantip: ต้องเป็นกระทู้จริง (/topic/XXXXX) และมีอายุไม่เกิน ~1 ปี
  if (platform === 'pantip') {
    const topicMatch = url.match(/\/topic\/(\d+)/);
    if (!topicMatch) return false;
    const topicId = parseInt(topicMatch[1], 10);
    // Topic ID >= 42800000 คือช่วงปี 2024 - 2026
    if (topicId >= 42800000) return true;

    // หาก ID เก่ากว่านั้น ให้ดูว่ามีการกล่าวถึงปีล่าสุดในเนื้อหา/หัวข้อหรือไม่
    const hasRecentYear = /(?:202[4-6]|256[7-9])/.test(fullText);
    return hasRecentYear;
  }

  // 2. LinkedIn: ต้องเป็นโพสต์หรือบทความ Pulse (ไม่เอาหน้า login หรือ directory)
  if (platform === 'linkedin') {
    const isPostOrPulse = url.includes('/posts/') || url.includes('/pulse/') || url.includes('/feed/update/');
    if (!isPostOrPulse) return false;
    return true;
  }

  // 3. Facebook: ต้องเป็นโพสต์หรือวิดีโอที่มีเนื้อหา
  if (platform === 'facebook') {
    const isPost = url.includes('/posts/') || url.includes('permalink.php') || url.includes('story_fbid') || url.includes('/videos/');
    if (!isPost) return false;
    return true;
  }

  return false;
}

/**
 * เรียกค้นหาจาก SearXNG
 */
async function querySearxng(query) {
  const endpoint = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json`;
  try {
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(8000),
      headers: {
        'Accept': 'application/json'
      }
    });
    if (!res.ok) {
      console.warn(`[ThreadSearch] SearXNG HTTP ${res.status} for query: ${query}`);
      return [];
    }
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data.results) ? data.results : [];
  } catch (err) {
    console.error(`[ThreadSearch] Query failed (${query}):`, err.message);
    return [];
  }
}

/**
 * ค้นหากระทู้/โพสต์ตาม Keyword และ Platform (ระยะเวลาไม่เกิน 1 ปี)
 * @param {Object} options
 * @param {string} options.keyword - คำค้นหาหลัก
 * @param {string} [options.platform='all'] - 'all' | 'pantip' | 'linkedin' | 'facebook'
 * @param {number} [options.limit=5] - จำนวนผลลัพธ์ที่ต้องการ (1 - 10)
 * @returns {Promise<Array<{ platform: string, title: string, url: string, snippet: string }>>}
 */
async function searchRecentThreads({ keyword, platform = 'all', limit = 5 }) {
  const cleanKeyword = String(keyword || '').trim();
  if (!cleanKeyword) return [];

  // สร้างคำค้นหาตามเงื่อนไขปี 2025 - 2026 เพื่อความสดใหม่
  const currentYear = new Date().getFullYear();
  const lastYear = currentYear - 1;
  const yearConstraint = `${lastYear} OR ${currentYear}`;

  let queries = [];
  if (platform === 'pantip') {
    queries = [
      `site:pantip.com/topic "${cleanKeyword}" ${yearConstraint}`,
      `pantip "${cleanKeyword}" ${yearConstraint}`,
      `pantip ${cleanKeyword}`
    ];
  } else if (platform === 'linkedin') {
    queries = [
      `linkedin "${cleanKeyword}" ${yearConstraint}`,
      `site:linkedin.com/posts "${cleanKeyword}" ${yearConstraint}`,
      `linkedin posts ${cleanKeyword}`
    ];
  } else if (platform === 'facebook') {
    queries = [
      `facebook "${cleanKeyword}" ${yearConstraint}`,
      `site:facebook.com/posts "${cleanKeyword}" ${yearConstraint}`,
      `facebook posts ${cleanKeyword}`
    ];
  } else {
    // all platforms
    queries = [
      `pantip OR linkedin OR facebook "${cleanKeyword}" ${yearConstraint}`,
      `pantip OR linkedin OR facebook ${cleanKeyword}`
    ];
  }

  const results = [];
  const seenUrls = new Set();

  for (const q of queries) {
    const rawList = await querySearxng(q);
    for (const item of rawList) {
      if (isValidCandidate(item, platform)) {
        const itemPlatform = detectPlatform(item.url);
        const url = cleanUrl(item.url, itemPlatform);
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          results.push({
            platform: itemPlatform,
            title: String(item.title || 'ไม่มีหัวข้อ').replace(/ - Pantip$/i, '').replace(/ - LinkedIn$/i, '').replace(/ - Facebook$/i, '').trim(),
            url: url,
            snippet: String(item.content || '').trim().slice(0, 300)
          });
        }
      }
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}

module.exports = {
  searchRecentThreads,
  cleanUrl,
  detectPlatform,
  isValidCandidate
};
