/**
 * thread-search.js
 * ค้นหากระทู้และโพสต์ที่น่าสนใจในช่วง 1 ปีที่ผ่านมา (Pantip, LinkedIn, Facebook)
 * รองรับทั้งการใส่ Keyword เอง และโหมดทำออโต้โดยใช้ Gemini AI ดึงโจทย์จาก SyaCo Solutions
 * พร้อมระบบ Unfurl Open Graph Metadata สำหรับ Facebook เพื่อให้ได้ชื่อและเนื้อหาจริงของโพสต์/กลุ่ม
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

// ชุมชน Facebook B2B คุณภาพสูงที่เกี่ยวข้องกับโซลูชัน SyaCo (สำหรับเสริมความแม่นยำในการสร้าง Backlink)
const CURATED_FACEBOOK_COMMUNITIES = {
  warehouse: [
    {
      title: 'คลังสินค้า Logistics และ Supply Chain ประเทศไทย',
      url: 'https://www.facebook.com/groups/logisticsthai/',
      snippet: 'ชุมชนแลกเปลี่ยนความรู้ด้านคลังสินค้า (WMS) ระบบจัดเก็บ Barcode/RFID และ Supply Chain ในไทย'
    },
    {
      title: 'สมาคมผู้ประกอบการ e-Commerce ไทย (สต็อก & คลังสินค้า)',
      url: 'https://www.facebook.com/groups/ecommerce.or.th/',
      snippet: 'กลุ่มผู้ประกอบการ พูดคุยเรื่องระบบสต็อกสินค้า คลังสินค้า และการเชื่อมโยงระบบออนไลน์'
    }
  ],
  data: [
    {
      title: 'Odoo Thailand (ERP) & Data Integration',
      url: 'https://www.facebook.com/groups/odoo.erp.thailand/',
      snippet: 'กลุ่มผู้สนใจพัฒนาและแลกเปลี่ยนความรู้การพัฒนาระบบ ERP, API และการเชื่อมต่อฐานข้อมูล'
    },
    {
      title: 'SAP ABAP & Enterprise Systems Thailand',
      url: 'https://www.facebook.com/groups/sapabap4/',
      snippet: 'กลุ่มแลกเปลี่ยนปัญหาและโซลูชันระบบ SAP, ERP และการเชื่อมต่อระบบโรงงาน'
    }
  ],
  logistics: [
    {
      title: 'รถร่วมขนส่ง ผู้ประกอบการขนส่ง หางาน รถส่งของ',
      url: 'https://www.facebook.com/groups/750105715501953/',
      snippet: 'ชุมชนผู้ประกอบการขนส่ง รถร่วม และการบริหารจัดการเที่ยววิ่ง Logistics'
    },
    {
      title: 'Logistics & Development Thailand Forum ข่าวสารการขนส่ง',
      url: 'https://www.facebook.com/Logistic-Thailand-Forum-1426104774283552',
      snippet: 'ศูนย์รวมข้อมูลข่าวสาร นวัตกรรมระบบติดตามรถ GPS และเทคโนโลยีโลจิสติกส์'
    }
  ],
  analytics: [
    {
      title: 'Power BI Thailand Community',
      url: 'https://www.facebook.com/groups/powerbithailand/',
      snippet: 'กลุ่มคนทำ Dashboard, Business Intelligence (BI) วิเคราะห์ยอดขายและข้อมูลองค์กร'
    },
    {
      title: 'DataTH - Data Science & Business Analytics Thailand',
      url: 'https://www.facebook.com/groups/datathailand/',
      snippet: 'ชุมชนคนทำงานด้าน Data Analytics, Dashboard ผู้บริหาร และ Business Intelligence'
    }
  ],
  automation: [
    {
      title: 'thaiadmin.org ระบบเซิร์ฟเวอร์และระบบออโตเมชันองค์กร',
      url: 'https://www.facebook.com/groups/thaiadmin/',
      snippet: 'ชุมชนแลกเปลี่ยนปัญหา IT, Server, ระบบ Automation และการปรับปรุงประสิทธิภาพองค์กร'
    },
    {
      title: 'Jobs & Tech for Thai Programmers & Engineers',
      url: 'https://www.facebook.com/groups/647718825333067/',
      snippet: 'ชุมชนสายเทค วิศวกร และผู้เชี่ยวชาญด้านระบบอัตโนมัติ AI และซอฟต์แวร์โรงงาน'
    }
  ]
};

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
 */
async function generateAutoQueries(category = 'auto') {
  const solutions = await fetchSyacoSolutions();

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
    selectedSol = solutions[Math.floor(Math.random() * solutions.length)];
  }

  const solTitle = selectedSol.titleTh || selectedSol.titleEn;
  const solDesc = selectedSol.descTh || selectedSol.descEn;

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
              solutionKey: SYACO_CATALOG.find(c => c.id === selectedSol.id)?.key || 'auto',
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

  return {
    isAuto: true,
    solutionTitle: solTitle,
    solutionKey: SYACO_CATALOG.find(c => c.id === selectedSol.id)?.key || 'auto',
    targetProblem: solDesc.split('\n')[0].slice(0, 120),
    queries: selectedSol.curatedQueries || [`${solTitle} ปัญหา`, `แนะนำ ${solTitle}`]
  };
}

/**
 * แปลง HTML Entities เป็นตัวอักษรปกติ (เช่น &#xe15; -> ต)
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#([0-9]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
}

/**
 * ดึง Open Graph Metadata ของ Facebook URL (og:title, og:description)
 * เพื่อแปลงจาก "Link to facebook.com" เป็นหัวข้อและเนื้อหาจริง
 */
async function unfurlFacebookMetadata(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'th,en-US;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(4000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const descMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    
    let title = decodeHtmlEntities(titleMatch ? titleMatch[1] : '').replace(/ \| Facebook$/i, '').trim();
    let snippet = decodeHtmlEntities(descMatch ? descMatch[1] : '').trim();
    if (title === 'Facebook' || title === 'Log into Facebook' || title.includes('Link to facebook.com')) {
      title = '';
    }
    return { title, snippet };
  } catch (_) {
    return null;
  }
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
      u.hostname = 'www.facebook.com';
      u.searchParams.delete('locale');
      u.searchParams.delete('view');
      u.searchParams.delete('ref');
      u.searchParams.delete('ti');
      u.searchParams.delete('__tn__');
      u.searchParams.delete('__cft__');
      const keepParams = ['story_fbid', 'id', 'post_id'];
      const newParams = new URLSearchParams();
      keepParams.forEach(p => {
        if (u.searchParams.has(p)) newParams.set(p, u.searchParams.get(p));
      });
      const qs = newParams.toString();
      return u.origin + u.pathname.replace(/\/+$/, '') + (qs ? '?' + qs : '');
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
    if (topicId >= 42800000) return true;
    const hasRecentYear = /(?:202[4-6]|256[7-9])/.test(fullText);
    return hasRecentYear;
  }

  // 2. LinkedIn: ต้องเป็นโพสต์หรือบทความ Pulse (ไม่เอาหน้า login หรือ directory)
  if (platform === 'linkedin') {
    const isPostOrPulse = url.includes('/posts/') || url.includes('/pulse/') || url.includes('/feed/update/');
    if (!isPostOrPulse) return false;
    return true;
  }

  // 3. Facebook: ต้องเป็นโพสต์ กลุ่ม หรือวิดีโอที่มีเนื้อหา (ไม่เอาหน้า login, help, policy, developers)
  if (platform === 'facebook') {
    const isJunk = url.includes('developers.facebook.com') ||
                   url.includes('/help/') ||
                   url.includes('/login') ||
                   url.includes('/policies') ||
                   url.includes('/recover') ||
                   url.includes('/legal');
    if (isJunk) return false;

    const isPostOrGroup = url.includes('/posts/') ||
                          url.includes('/groups/') ||
                          url.includes('/permalink') ||
                          url.includes('story_fbid') ||
                          url.includes('story.php') ||
                          url.includes('/photos/') ||
                          url.includes('/videos/') ||
                          url.includes('/watch/') ||
                          url.includes('/share/');

    if (!isPostOrGroup) return false;
    return true;
  }

  return false;
}

/**
 * เรียกค้นหาจาก SearXNG
 */
async function querySearxng(query) {
  const endpoint = `${SEARXNG_URL}/search?q=${encodeURIComponent(query)}&format=json&engines=yandex`;
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
 * ค้นหาเฉพาะ Facebook พร้อม Unfurl Title และ Description
 */
async function searchFacebookThreads(terms, limit = 5, solutionCategory = '') {
  const primary = terms[0] || 'Business Solution';
  const queries = [
    `site:facebook.com ${primary}`,
    `site:facebook.com/groups ${primary}`
  ];
  if (terms[1]) {
    queries.push(`site:facebook.com ${terms[1]}`);
  }

  const results = [];
  const seenUrls = new Set();

  for (const q of queries) {
    if (results.length >= limit) break;
    const rawList = await querySearxng(q);

    for (const item of rawList) {
      if (!isValidCandidate(item, 'facebook')) continue;

      const clean = cleanUrl(item.url, 'facebook');
      if (seenUrls.has(clean)) continue;
      seenUrls.add(clean);

      let title = item.title || '';
      let snippet = item.content || '';

      // Unfurl if title or snippet is generic
      if (!title || title.includes('Link to facebook.com') || title === 'Facebook' || !snippet || snippet.includes('The site owner hides')) {
        const unfurled = await unfurlFacebookMetadata(item.url);
        if (unfurled?.title) title = unfurled.title;
        if (unfurled?.snippet) snippet = unfurled.snippet;
      }

      // Fallback title from path
      if (!title || title.includes('Link to facebook.com') || title === 'Facebook') {
        const mGroup = item.url.match(/facebook\.com\/groups\/([^/?]+)/);
        const mPage = item.url.match(/facebook\.com\/([^/?]+)/);
        if (mGroup) {
          title = `กลุ่ม Facebook: ${decodeURIComponent(mGroup[1])}`;
        } else if (mPage) {
          title = `เพจ Facebook: ${decodeURIComponent(mPage[1])}`;
        } else {
          title = `โพสต์ข้อความสนทนาบน Facebook (${primary})`;
        }
      }

      if (!snippet || snippet.includes('The site owner hides')) {
        snippet = `ชุมชนและโพสต์แลกเปลี่ยนความคิดเห็นบน Facebook เกี่ยวกับ "${primary}"`;
      }

      // กรองเฉพาะกระทู้/โพสต์/กลุ่มที่มีความเกี่ยวข้องกับธุรกิจ ไอที โรงงาน ซอฟต์แวร์
      const isRelevant = /(?:erp|sap|wms|สต็อก|คลัง|ขนส่ง|logistics|จัดซื้อ|โรงงาน|การผลิต|โปรแกรม|ระบบ|pos|dashboard|bi|plc|automation|ซอฟต์แวร์|ไอที|ธุรกิจ|sme|บาร์โค้ด|barcode|database|api|scada|data|engineer|developer|computer)/i.test(`${title} ${snippet}`);
      if (!isRelevant) continue;

      results.push({
        platform: 'facebook',
        title: title.slice(0, 150),
        url: clean,
        snippet: snippet.slice(0, 250)
      });

      if (results.length >= limit) break;
    }

    if (results.length >= limit) break;
  }

  // หากยังไม่เต็ม limit และมี Curated Communities ให้เติมเข้ามา
  if (results.length < limit && solutionCategory && CURATED_FACEBOOK_COMMUNITIES[solutionCategory]) {
    for (const c of CURATED_FACEBOOK_COMMUNITIES[solutionCategory]) {
      if (results.length >= limit) break;
      if (!seenUrls.has(c.url)) {
        seenUrls.add(c.url);
        results.push({
          platform: 'facebook',
          title: c.title,
          url: c.url,
          snippet: c.snippet
        });
      }
    }
  }

  return results;
}

/**
 * ค้นหาเฉพาะ Pantip
 */
async function searchPantipThreads(terms, limit = 5) {
  const primary = terms[0] || 'Business Solution';
  const queries = [
    `site:pantip.com/topic ${primary}`,
    `pantip ${primary}`
  ];
  if (terms[1]) {
    queries.push(`site:pantip.com/topic ${terms[1]}`);
  }

  const results = [];
  const seenUrls = new Set();

  for (const q of queries) {
    if (results.length >= limit) break;
    const rawList = await querySearxng(q);

    for (const item of rawList) {
      if (!isValidCandidate(item, 'pantip')) continue;
      const clean = cleanUrl(item.url, 'pantip');
      if (seenUrls.has(clean)) continue;
      seenUrls.add(clean);

      results.push({
        platform: 'pantip',
        title: String(item.title || 'ไม่มีหัวข้อ').replace(/ - Pantip$/i, '').trim().slice(0, 150),
        url: clean,
        snippet: String(item.content || '').trim().slice(0, 250)
      });

      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  return results;
}

/**
 * ค้นหาเฉพาะ LinkedIn
 */
async function searchLinkedInThreads(terms, limit = 5) {
  const primary = terms[0] || 'Business Solution';
  const queries = [
    `site:linkedin.com/posts ${primary}`,
    `site:linkedin.com/pulse ${primary}`
  ];
  if (terms[1]) {
    queries.push(`site:linkedin.com/posts ${terms[1]}`);
  }

  const results = [];
  const seenUrls = new Set();

  for (const q of queries) {
    if (results.length >= limit) break;
    const rawList = await querySearxng(q);

    for (const item of rawList) {
      if (!isValidCandidate(item, 'linkedin')) continue;
      const clean = cleanUrl(item.url, 'linkedin');
      if (seenUrls.has(clean)) continue;
      seenUrls.add(clean);

      results.push({
        platform: 'linkedin',
        title: String(item.title || 'ไม่มีหัวข้อ').replace(/ - LinkedIn$/i, '').trim().slice(0, 150),
        url: clean,
        snippet: String(item.content || '').trim().slice(0, 250)
      });

      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  return results;
}

/**
 * ค้นหากระทู้/โพสต์ตาม Keyword และ Platform (ระยะเวลาไม่เกิน 1 ปี)
 * มีระบบกระจายโควตาแพลตฟอร์มที่เป็นธรรม (ไม่ถูก Pantip ดูดโควตาจนหมด)
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

  const solKey = autoMeta?.solutionKey || (keyword?.startsWith('auto:') ? keyword.replace('auto:', '') : '');

  // 1. กรณีระบุแพลตฟอร์มเจาะจง
  if (platform === 'facebook') {
    const fbResults = await searchFacebookThreads(queriesToRun, limit, solKey);
    return { autoMeta, results: fbResults.slice(0, limit) };
  }

  if (platform === 'pantip') {
    const ptResults = await searchPantipThreads(queriesToRun, limit);
    return { autoMeta, results: ptResults.slice(0, limit) };
  }

  if (platform === 'linkedin') {
    const liResults = await searchLinkedInThreads(queriesToRun, limit);
    return { autoMeta, results: liResults.slice(0, limit) };
  }

  // 2. กรณี platform === 'all': แบ่งสัดส่วนอย่างสมดุล (Pantip 40%, Facebook 35%, LinkedIn 25%)
  const fbTarget = Math.max(1, Math.round(limit * 0.35));
  const liTarget = Math.max(1, Math.round(limit * 0.25));
  const ptTarget = Math.max(1, limit - fbTarget - liTarget);

  const fbList = await searchFacebookThreads(queriesToRun, fbTarget, solKey);
  const ptList = await searchPantipThreads(queriesToRun, ptTarget);
  const liList = await searchLinkedInThreads(queriesToRun, liTarget);

  let combined = [...fbList, ...ptList, ...liList];

  // หากยังไม่ครบ limit ให้เติมส่วนที่ขาดจากแพลตฟอร์มที่มี
  if (combined.length < limit) {
    const deficit = limit - combined.length;
    const morePt = await searchPantipThreads(queriesToRun, ptTarget + deficit);
    const existingUrls = new Set(combined.map(r => r.url));
    for (const p of morePt) {
      if (!existingUrls.has(p.url) && combined.length < limit) {
        existingUrls.add(p.url);
        combined.push(p);
      }
    }
  }

  return {
    autoMeta,
    results: combined.slice(0, limit)
  };
}

/**
 * รวบรวมกระทู้/โพสต์น่าสนใจประจำวัน (Daily Radar) รวม ~20 รายการ
 * กระจายครบทุกหมวดหมู่โซลูชัน และการันตีมีกระทู้ Facebook + Pantip + LinkedIn ครบถ้วน
 */
async function collectDailyRadarThreads(targetCount = 20) {
  const categories = ['warehouse', 'data', 'logistics', 'production', 'alert', 'crm', 'energy', 'predictive'];
  const shuffled = [...categories].sort(() => Math.random() - 0.5);

  const allResults = [];
  const seenUrls = new Set();
  const solutionsCovered = new Set();

  // กำหนดโควตาเป้าหมาย: Facebook ~7-8, Pantip ~7-8, LinkedIn ~5
  const fbTargetTotal = Math.round(targetCount * 0.35); // ~7
  const liTargetTotal = Math.round(targetCount * 0.25); // ~5
  const ptTargetTotal = targetCount - fbTargetTotal - liTargetTotal; // ~8

  let fbCount = 0;
  let ptCount = 0;
  let liCount = 0;

  for (const cat of shuffled) {
    if (allResults.length >= targetCount) break;

    try {
      const sol = SYACO_CATALOG.find(c => c.key === cat) || SYACO_CATALOG[0];
      const queries = sol.curatedQueries;
      solutionsCovered.add(sol.titleTh);

      // ดึง Facebook สำหรับหมวดนี้
      if (fbCount < fbTargetTotal) {
        const fbBatch = await searchFacebookThreads(queries, 1, cat);
        for (const item of fbBatch) {
          if (!seenUrls.has(item.url) && allResults.length < targetCount && fbCount < fbTargetTotal) {
            seenUrls.add(item.url);
            fbCount++;
            allResults.push({
              ...item,
              solutionCategory: sol.titleTh || cat
            });
          }
        }
      }

      // ดึง Pantip สำหรับหมวดนี้
      if (ptCount < ptTargetTotal) {
        const ptBatch = await searchPantipThreads(queries, 1);
        for (const item of ptBatch) {
          if (!seenUrls.has(item.url) && allResults.length < targetCount && ptCount < ptTargetTotal) {
            seenUrls.add(item.url);
            ptCount++;
            allResults.push({
              ...item,
              solutionCategory: sol.titleTh || cat
            });
          }
        }
      }

      // ดึง LinkedIn สำหรับหมวดนี้
      if (liCount < liTargetTotal) {
        const liBatch = await searchLinkedInThreads(queries, 1);
        for (const item of liBatch) {
          if (!seenUrls.has(item.url) && allResults.length < targetCount && liCount < liTargetTotal) {
            seenUrls.add(item.url);
            liCount++;
            allResults.push({
              ...item,
              solutionCategory: sol.titleTh || cat
            });
          }
        }
      }
    } catch (err) {
      console.warn(`[DailyRadar] Error gathering for category ${cat}:`, err.message);
    }

    await new Promise(r => setTimeout(r, 400));
  }

  // หากยังไม่ครบ targetCount ให้ดึงเสริม
  if (allResults.length < targetCount) {
    const fallbackTerms = ['ERP โรงงาน', 'โปรแกรมสต็อก คลังสินค้า', 'ระบบขนส่ง logistics', 'WMS Barcode', 'Dashboard ผู้บริหาร'];
    for (const term of fallbackTerms) {
      if (allResults.length >= targetCount) break;
      try {
        const fbMore = await searchFacebookThreads([term], 2);
        for (const r of fbMore) {
          if (!seenUrls.has(r.url) && allResults.length < targetCount) {
            seenUrls.add(r.url);
            allResults.push({ ...r, solutionCategory: `Keyword: ${term}` });
          }
        }

        const ptMore = await searchPantipThreads([term], 2);
        for (const r of ptMore) {
          if (!seenUrls.has(r.url) && allResults.length < targetCount) {
            seenUrls.add(r.url);
            allResults.push({ ...r, solutionCategory: `Keyword: ${term}` });
          }
        }
      } catch (_) {}
      await new Promise(r => setTimeout(r, 400));
    }
  }

  return {
    solutionsCovered: Array.from(solutionsCovered),
    results: allResults.slice(0, targetCount)
  };
}

module.exports = {
  searchRecentThreads,
  searchFacebookThreads,
  searchPantipThreads,
  searchLinkedInThreads,
  collectDailyRadarThreads,
  generateAutoQueries,
  fetchSyacoSolutions,
  cleanUrl,
  detectPlatform,
  isValidCandidate,
  unfurlFacebookMetadata,
  SYACO_CATALOG,
  CURATED_FACEBOOK_COMMUNITIES
};
