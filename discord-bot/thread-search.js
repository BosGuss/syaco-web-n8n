/**
 * thread-search.js
 * ค้นหากระทู้และโพสต์ที่น่าสนใจในช่วง 1 ปีที่ผ่านมา (Pantip, LinkedIn, Facebook)
 * รองรับทั้งการใส่ Keyword เอง และโหมดทำออโต้โดยใช้ Gemini AI ดึงโจทย์จาก SyaCo Solutions
 */

const SEARXNG_URL = process.env.SEARXNG_URL || 'http://searxng:8080';
const SYACO_API_URL = process.env.SYACO_API_URL || 'https://www.syaco.co.th/api/solutions';

// รายการ SyaCo Solutions มาตรฐาน (ใช้เป็นฐานข้อมูลหลักและ Fallback)
const SYACO_CATALOG = [
  {
    id: 7,
    key: 'data',
    titleTh: 'Data Integration & APIs',
    titleEn: 'Data Integration & APIs',
    descTh: 'แพลตฟอร์มกลางสำหรับเชื่อมโยงข้อมูลระหว่างระบบ SAP/ERP เครื่องจักรหน้างาน (PLC) และระบบภายนอกอื่นๆ เข้าด้วยกัน',
    curatedQueries: [
      'เชื่อมต่อ PLC กับ SAP',
      'ดึงข้อมูลเครื่องจักรขึ้น Cloud',
      'ระบบ ERP โรงงาน เชื่อมต่อ API',
      'SCADA PLC เชื่อมต่อ ฐานข้อมูล'
    ]
  },
  {
    id: 8,
    key: 'logistics',
    titleTh: 'Real-time Tracking & Logistics',
    titleEn: 'Real-time Tracking & Logistics',
    descTh: 'แพลตฟอร์มบริหารจัดการเที่ยววิ่งและการขนส่ง ติดตามพิกัดรถและสินค้าแบบเรียลไทม์ พร้อมบันทึกหลักฐานการส่งมอบงาน',
    curatedQueries: [
      'ระบบติดตามรถขนส่งสินค้า',
      'โปรแกรมบันทึกการส่งของ POD',
      'จัดการเที่ยววิ่ง logistics',
      'ปัญหาพนักงานส่งของส่งไม่ตรงเวลา'
    ]
  },
  {
    id: 9,
    key: 'warehouse',
    titleTh: 'Smart Inventory & Warehouse',
    titleEn: 'Smart Inventory & Warehouse',
    descTh: 'แพลตฟอร์มบริหารจัดการคลังสินค้าและวัตถุดิบ (WMS) ตรวจสอบวันหมดอายุ และติดตามสต๊อกแบบเรียลไทม์ผ่าน Barcode/QR',
    curatedQueries: [
      'โปรแกรมจัดการสต็อกสินค้า คลังสินค้า',
      'ระบบ WMS ตัดสต็อก Barcode',
      'ปัญหาสต็อกของไม่ตรงกับระบบ',
      'โปรแกรมเช็คสต็อกสินค้า'
    ]
  },
  {
    id: 10,
    key: 'analytics',
    titleTh: 'Analytics & Dashboard',
    titleEn: 'Analytics & Dashboard',
    descTh: 'แพลตฟอร์มรวบรวมข้อมูลจากระบบต่างๆ ในองค์กรมาแสดงผลเป็น Dashboard และรายงานเชิงลึกสำหรับผู้บริหาร',
    curatedQueries: [
      'Dashboard ผู้บริหาร โรงงาน',
      'โปรแกรมรวมรายงานยอดขาย KPI',
      'ปัญหาทำรายงานล่าช้า',
      'ระบบ Business Intelligence องค์กร'
    ]
  },
  {
    id: 11,
    key: 'automation',
    titleTh: 'AI & Automation',
    titleEn: 'AI & Automation',
    descTh: 'นำเทคโนโลยี AI มาประยุกต์ใช้กับกระบวนการทำงาน เช่น คัดแยกสิ่งของด้วย Computer Vision หรือตรวจสอบ Defect',
    curatedQueries: [
      'AI ตรวจสอบความผิดปกติการผลิต',
      'ระบบตรวจจับ Defect กล้อง AI โรงงาน',
      'ระบบอัตโนมัติ ลดแรงงานคน',
      'AI OCR อ่านเอกสารอัตโนมัติ'
    ]
  },
  {
    id: 12,
    key: 'apps',
    titleTh: 'Enterprise Web & Mobile Apps',
    titleEn: 'Enterprise Web & Mobile Apps',
    descTh: 'พัฒนาเว็บและโมบายแอปพลิเคชันสำหรับองค์กร รองรับการทำงานแบบ Offline-First บันทึกข้อมูลได้แม้อยู่นอกสัญญาณ',
    curatedQueries: [
      'แอปบันทึกข้อมูลหน้างาน offline',
      'ระบบเก็บข้อมูลพนักงานภาคสนาม',
      'พัฒนาเว็บแอปพลิเคชันองค์กร',
      'ระบบตรวจงานนอกสถานที่'
    ]
  },
  {
    id: 13,
    key: 'alerts',
    titleTh: 'Alerts & Notification System',
    titleEn: 'Alerts & Notification System',
    descTh: 'ระบบแจ้งเตือนและบริหารความเสี่ยง ตรวจจับเหตุการณ์ผิดปกติในกระบวนการทำงาน พร้อมระบบ Workflow อนุมัติเอกสารออนไลน์',
    curatedQueries: [
      'ระบบแจ้งเตือนความผิดปกติในโรงงาน',
      'ระบบอนุมัติเอกสารออนไลน์ workflow',
      'แจ้งเตือนผ่านไลน์ กลุ่มงาน',
      'ลดขั้นตอนเดินเอกสารในองค์กร'
    ]
  },
  {
    id: 14,
    key: 'growth',
    titleTh: 'Digital Growth & Performance',
    titleEn: 'Digital Growth & Performance',
    descTh: 'วางโครงสร้างพื้นฐานด้าน Performance ความปลอดภัย และ Technical SEO ให้กับเว็บไซต์และแพลตฟอร์มขององค์กร',
    curatedQueries: [
      'เว็บองค์กรโหลดช้า ปัญหา performance',
      'ความปลอดภัยระบบคลาวด์ องค์กร',
      'ระบบเว็บรองรับผู้ใช้งานพร้อมกันจำนวนมาก',
      'Technical SEO เว็บไซต์บริษัท'
    ]
  }
];

/**
 * ดึงรายการโซลูชันล่าสุดจาก API ของ SyaCo
 */
async function fetchSyacoSolutions() {
  try {
    const res = await fetch(SYACO_API_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return SYACO_CATALOG;
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || []);
    if (!list.length) return SYACO_CATALOG;

    return list.map(s => ({
      id: s.id,
      titleTh: s.titleTh || s.titleEn || '',
      titleEn: s.titleEn || s.titleTh || '',
      descTh: s.content?.th?.hero?.description || s.descTh || '',
      descEn: s.content?.en?.hero?.description || s.descEn || '',
      curatedQueries: SYACO_CATALOG.find(c => c.id === s.id)?.curatedQueries || [
        `${s.titleTh || s.titleEn} ปัญหา`,
        `แนะนำระบบ ${s.titleTh || s.titleEn}`
      ]
    }));
  } catch (err) {
    console.warn('[thread-search] fetchSyacoSolutions failed, using catalog fallback:', err.message);
    return SYACO_CATALOG;
  }
}

/**
 * สุ่ม/เลือกโซลูชัน และสร้าง Search Queries อัตโนมัติด้วย Gemini AI
 * (จำลองพฤติกรรมเดียวกับโหนด AI Generate Search Queries ใน n8n)
 */
async function generateAutoQueries(category = 'auto') {
  const solutions = await fetchSyacoSolutions();

  // เลือกโซลูชันเป้าหมาย
  let selectedSol = null;
  if (category && category !== 'auto') {
    const catLow = category.toLowerCase();
    selectedSol = solutions.find(s => {
      const matchKey = SYACO_CATALOG.find(c => c.id === s.id)?.key === catLow;
      const matchTitle = (s.titleTh + ' ' + s.titleEn).toLowerCase().includes(catLow);
      return matchKey || matchTitle;
    });
  }

  if (!selectedSol) {
    // สุ่มเลือก 1 โซลูชันจากรายการทั้งหมด
    selectedSol = solutions[Math.floor(Math.random() * solutions.length)];
  }

  const solTitle = selectedSol.titleTh || selectedSol.titleEn;
  const solDesc = selectedSol.descTh || selectedSol.descEn;

  // 1. พยายามเรียก Gemini AI สร้างคำค้นหาตามบริบทแบบเรียลไทม์
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';

  if (apiKey) {
    try {
      const prompt = [
        'You are an expert Enterprise B2B Search Query Generator for SyaCo (https://www.syaco.co.th), an enterprise software development and digital transformation company.',
        '',
        'Target Solution:',
        `Title: ${solTitle}`,
        `Description: ${solDesc}`,
        '',
        'Task:',
        'Generate 3-4 distinct, natural Thai or English search queries that enterprise clients, factory managers, or engineers in Thailand would post online when facing real problems this solution solves.',
        'Target platforms: Pantip, LinkedIn, and Facebook.',
        '',
        'Rules:',
        '- 2 to 5 words per query (natural conversational Thai/English phrases).',
        '- Focus on real pain points, troubleshooting, or system selection (e.g. "โปรแกรมจัดการสต็อก", "เชื่อมต่อ PLC กับ SAP", "ปัญหา ERP โรงงาน").',
        '- Do NOT use search operators like site: or quotes.',
        '- Return valid JSON matching schema.'
      ].join('\n');

      const geminiBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              selectedSolution: { type: 'STRING' },
              targetProblem: { type: 'STRING' },
              queries: {
                type: 'ARRAY',
                items: { type: 'STRING' }
              }
            },
            required: ['selectedSolution', 'targetProblem', 'queries']
          }
        }
      };

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(geminiBody),
        signal: AbortSignal.timeout(6000)
      });

      if (res.ok) {
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          if (Array.isArray(parsed.queries) && parsed.queries.length > 0) {
            return {
              isAuto: true,
              solutionTitle: solTitle,
              targetProblem: parsed.targetProblem || solDesc.slice(0, 100),
              queries: parsed.queries.map(q => q.trim()).filter(Boolean).slice(0, 4)
            };
          }
        }
      }
    } catch (aiErr) {
      console.warn('[thread-search] Gemini AI Generate Queries failed, fallback to curated:', aiErr.message);
    }
  }

  // Fallback: ใช้ Curated Queries ประจำโซลูชัน
  return {
    isAuto: true,
    solutionTitle: solTitle,
    targetProblem: solDesc.split('\n')[0].slice(0, 120),
    queries: selectedSol.curatedQueries || [`${solTitle} ปัญหา`, `แนะนำ ${solTitle}`]
  };
}

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
    // Topic ID >= 42800000 คือช่วงปลายปี 2024 ถึงปัจจุบัน (2025 - 2026)
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
    const isPost = url.includes('/posts/') || url.includes('permalink.php') || url.includes('story_fbid') || url.includes('/videos/') || url.includes('/groups/');
    if (!isPost) return false;
    return true;
  }

  return false;
}

/**
 * เรียกค้นหาจาก SearXNG
 */
async function querySearxng(query) {
  const endpoint = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&engines=duckduckgo+web,yandex`;
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
 * รองรับทั้งใส่ Keyword เอง และ Auto Mode
 * @param {Object} options
 * @param {string} [options.keyword] - คำค้นหาหลัก (ถ้าเว้นว่าง หรือเลือกโหมด auto จะสุ่มจาก SyaCo Solutions)
 * @param {string} [options.mode='manual'] - 'manual' | 'auto'
 * @param {string} [options.platform='all'] - 'all' | 'pantip' | 'linkedin' | 'facebook'
 * @param {number} [options.limit=5] - จำนวนผลลัพธ์ที่ต้องการ (1 - 10)
 * @returns {Promise<{ autoMeta?: Object, results: Array<{ platform: string, title: string, url: string, snippet: string }> }>}
 */
async function searchRecentThreads({ keyword, mode = 'manual', platform = 'all', limit = 5 }) {
  const isAutoMode = mode === 'auto' || (keyword && keyword.startsWith('auto')) || (!keyword && mode !== 'manual');

  let autoMeta = null;
  let queriesToRun = [];

  if (isAutoMode) {
    let cat = 'auto';
    if (keyword && keyword.startsWith('auto:')) {
      cat = keyword.replace('auto:', '');
    }
    autoMeta = await generateAutoQueries(cat);
    queriesToRun = autoMeta.queries || ['ERP'];
  } else {
    const clean = String(keyword || '').trim();
    if (!clean) {
      autoMeta = await generateAutoQueries('auto');
      queriesToRun = autoMeta.queries || ['ERP'];
    } else {
      queriesToRun = [clean];
    }
  }

  function buildSearchQueries(term, plat) {
    if (plat === 'pantip') {
      return [
        `pantip ${term} 2025`,
        `pantip ${term}`
      ];
    }
    if (plat === 'linkedin') {
      return [
        `site:linkedin.com/posts ${term}`,
        `linkedin posts ${term}`
      ];
    }
    if (plat === 'facebook') {
      return [
        `site:facebook.com ${term}`,
        `facebook ${term}`
      ];
    }
    return [
      `pantip ${term} 2025`,
      `site:linkedin.com/posts ${term}`,
      `site:facebook.com ${term}`,
      `pantip ${term}`
    ];
  }

  const results = [];
  const seenUrls = new Set();

  for (let i = 0; i < queriesToRun.length; i++) {
    const term = queriesToRun[i];
    const queries = buildSearchQueries(term, platform);

    for (let qIdx = 0; qIdx < queries.length; qIdx++) {
      if (results.length >= limit) break;
      if (i > 0 || qIdx > 0) {
        await new Promise(r => setTimeout(r, 600));
      }

      const q = queries[qIdx];
      const rawList = await querySearxng(q);
      for (const item of rawList) {
        if (isValidCandidate(item, platform)) {
          const itemPlatform = detectPlatform(item.url);
          const url = cleanUrl(item.url, itemPlatform);
          if (!seenUrls.has(url)) {
            seenUrls.add(url);
            results.push({
              platform: itemPlatform,
              title: String(item.title || 'ไม่มีหัวข้อ')
                .replace(/ - Pantip$/i, '')
                .replace(/ - LinkedIn$/i, '')
                .replace(/ - Facebook$/i, '')
                .trim(),
              url: url,
              snippet: String(item.content || '').trim().slice(0, 300)
            });
          }
        }
        if (results.length >= limit) break;
      }
    }

    if (results.length >= limit) break;
  }

  return {
    autoMeta,
    results: results.slice(0, limit)
  };
}

module.exports = {
  searchRecentThreads,
  generateAutoQueries,
  fetchSyacoSolutions,
  cleanUrl,
  detectPlatform,
  isValidCandidate,
  SYACO_CATALOG
};
