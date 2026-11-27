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
      'เชื่อมต่อ PLC',
      'SCADA PLC',
      'ERP API',
      'PLC SAP'
    ]
  },
  {
    id: 8,
    key: 'logistics',
    titleTh: 'Real-time Tracking & Logistics',
    titleEn: 'Real-time Tracking & Logistics',
    descTh: 'แพลตฟอร์มบริหารจัดการเที่ยววิ่งและการขนส่ง ติดตามพิกัดรถและสินค้าแบบเรียลไทม์ พร้อมบันทึกหลักฐานการส่งมอบงาน',
    curatedQueries: [
      'ระบบติดตามรถ',
      'ขนส่งสินค้า ปัญหา',
      'logistics ปัญหา',
      'โปรแกรมติดตามรถ'
    ]
  },
  {
    id: 9,
    key: 'warehouse',
    titleTh: 'Smart Inventory & Warehouse',
    titleEn: 'Smart Inventory & Warehouse',
    descTh: 'แพลตฟอร์มบริหารจัดการคลังสินค้าและวัตถุดิบ (WMS) ตรวจสอบวันหมดอายุ และติดตามสต๊อกแบบเรียลไทม์ผ่าน Barcode/QR',
    curatedQueries: [
      'WMS',
      'คลังสินค้า',
      'สต็อกสินค้า ปัญหา',
      'โปรแกรมจัดการคลังสินค้า'
    ]
  },
  {
    id: 10,
    key: 'analytics',
    titleTh: 'Analytics & Dashboard',
    titleEn: 'Analytics & Dashboard',
    descTh: 'แพลตฟอร์มรวบรวมข้อมูลจากระบบต่างๆ ในองค์กรมาแสดงผลเป็น Dashboard และรายงานเชิงลึกสำหรับผู้บริหาร',
    curatedQueries: [
      'Dashboard ผู้บริหาร',
      'Power BI ปัญหา',
      'รายงานยอดขาย ปัญหา',
      'Power BI ERP'
    ]
  },
  {
    id: 11,
    key: 'automation',
    titleTh: 'AI & Automation',
    titleEn: 'AI & Automation',
    descTh: 'นำเทคโนโลยี AI มาประยุกต์ใช้กับกระบวนการทำงาน เช่น คัดแยกสิ่งของด้วย Computer Vision หรือตรวจสอบ Defect',
    curatedQueries: [
      'กล้องตรวจ Defect',
      'Defect โรงงาน',
      'ลดของเสียในกระบวนการผลิต',
      'ตรวจ Defect'
    ]
  },
  {
    id: 12,
    key: 'apps',
    titleTh: 'Enterprise Web & Mobile Apps',
    titleEn: 'Enterprise Web & Mobile Apps',
    descTh: 'พัฒนาเว็บและโมบายแอปพลิเคชันสำหรับองค์กร รองรับการทำงานแบบ Offline-First บันทึกข้อมูลได้แม้อยู่นอกสัญญาณ',
    curatedQueries: [
      'แอปองค์กร',
      'ระบบเก็บข้อมูลพนักงาน',
      'เขียนเว็บแอป',
      'แอปโรงงาน'
    ]
  },
  {
    id: 13,
    key: 'alerts',
    titleTh: 'Alerts & Notification System',
    titleEn: 'Alerts & Notification System',
    descTh: 'ระบบแจ้งเตือนและบริหารความเสี่ยง ตรวจจับเหตุการณ์ผิดปกติในกระบวนการทำงาน พร้อมระบบ Workflow อนุมัติเอกสารออนไลน์',
    curatedQueries: [
      'แจ้งเตือนเครื่องจักร',
      'Workflow อนุมัติเอกสาร',
      'เครื่องจักรโรงงาน ปัญหา',
      'แจ้งเตือน LINE โรงงาน'
    ]
  },
  {
    id: 14,
    key: 'growth',
    titleTh: 'Digital Growth & Performance',
    titleEn: 'Digital Growth & Performance',
    descTh: 'วางโครงสร้างพื้นฐานด้าน Performance ความปลอดภัย และ Technical SEO ให้กับเว็บไซต์และแพลตฟอร์มขององค์กร',
    curatedQueries: [
      'เว็บองค์กร ช้า',
      'ระบบเว็บล่ม',
      'Technical SEO ปัญหา',
      'Cloud ค่าใช้จ่ายสูง'
    ]
  }
];

// @deprecated ยกเลิกการใช้งานหน้าแรกของกลุ่ม Facebook สำเร็จรูป (ไม่เติมหน้าแรกของกลุ่มเข้าผลการค้นหาอีกต่อไปเพื่อความถูกต้องของข้อมูลตามกระทู้จริง)
const CURATED_FACEBOOK_COMMUNITIES = {};

/**
 * ดึงรายการโซลูชันล่าสุดจาก API ของ SyaCo
 */
let cachedSolutionsList = SYACO_CATALOG;

async function fetchSyacoSolutions() {
  try {
    const res = await fetch(SYACO_API_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return cachedSolutionsList;
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.data || []);
    if (!list.length) return cachedSolutionsList;

    const mapped = list.map(s => ({
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

    cachedSolutionsList = mapped;
    if (typeof updateGlobalTopicsRegex === 'function') {
      updateGlobalTopicsRegex(mapped);
    }

    return mapped;
  } catch (err) {
    console.warn('[thread-search] fetchSyacoSolutions failed, using catalog fallback:', err.message);
    return cachedSolutionsList;
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
        'Generate 3-4 distinct, natural Thai or English search queries that clients, factory managers, IT leads, or engineers in Thailand would post online when facing real PAIN POINTS, troubleshooting issues, or seeking software/vendor recommendations that this solution addresses.',
        'Target platforms: Pantip, LinkedIn, and Facebook.',
        '',
        'Rules:',
        '- 2 to 5 words per query (natural conversational Thai/English phrases).',
        '- Focus strictly on real PAIN POINTS, troubleshooting questions, or system seeking inquiries (e.g. "ปัญหาสต็อกสินค้าไม่ตรง", "เชื่อมต่อ PLC กับ SAP error แก้ยังไง", "หาโปรแกรม WMS เจ้าไหนดี", "กล้องตรวจ Defect หลุดบ่อย").',
        '- Do NOT generate vendor promotional phrases (no "รับทำ", "บริการ", "วางระบบ").',
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
      signal: AbortSignal.timeout(5000)
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

    // ถอด Timestamp วันเวลาที่โพสต์จาก Metadata ของ Facebook (creation_time, created_time, data-utime)
    const timeMatch = html.match(/"creation_time"\s*:\s*(\d{10})/i) ||
                      html.match(/"created_time"\s*:\s*(\d{10})/i) ||
                      html.match(/data-utime="(\d{10})"/i);
    const publishTime = timeMatch ? parseInt(timeMatch[1], 10) * 1000 : null;

    return { title, snippet, publishTime };
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
      const keepParams = ['story_fbid', 'id', 'post_id', 'v'];
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
 * ตรวจสอบความถูกต้องของ URL ของ Facebook
 * ต้องเป็น "กระทู้/โพสต์ที่สามารถตอบได้" (Post/Discussion Thread) เท่านั้น
 * ปฏิเสธหน้าโปรไฟล์ส่วนบุคคล (ป้องกันประเด็น PDPA), หน้าแรกของเพจ และหน้าแรกของกลุ่ม (/groups/<id>)
 */
function isFacebookPost(rawUrl) {
  if (!rawUrl) return false;
  let pathname = '';
  let searchParams = null;
  try {
    const u = new URL(rawUrl);
    pathname = u.pathname.toLowerCase();
    searchParams = u.searchParams;
  } catch (_) {
    pathname = String(rawUrl).toLowerCase();
  }

  // 1. กรองหน้าระบบ, ความช่วยเหลือ, กฎหมาย หรือหน้าทั่วไปที่ไม่ใช่โพสต์
  const isJunk = pathname.includes('/help') ||
                 pathname.includes('/login') ||
                 pathname.includes('/policies') ||
                 pathname.includes('/recover') ||
                 pathname.includes('/legal') ||
                 pathname.includes('/about') ||
                 pathname.includes('/settings') ||
                 pathname.includes('/privacy') ||
                 pathname.includes('/checkpoint') ||
                 pathname.includes('/events') ||
                 pathname.includes('/hashtag') ||
                 pathname.includes('/marketplace') ||
                 pathname.includes('/gaming') ||
                 pathname.includes('/jobs') ||
                 pathname.includes('/dialog') ||
                 pathname.includes('/sharer') ||
                 pathname.includes('developers.facebook.com');
  if (isJunk) return false;

  // 2. โพสต์ในกลุ่ม Facebook (ต้องมี post ID หรือ permalink เท่านั้น ไม่รับหน้าแรกของกลุ่ม)
  if (pathname.includes('/groups/')) {
    return /\/groups\/[^/]+\/posts\/(?:[^/]+\/)?(\d+|[a-zA-Z0-9._%-]+)/.test(pathname) ||
           /\/groups\/[^/]+\/permalink\/(\d+)/.test(pathname) ||
           /\/groups\/[^/]+\/multi_permalinks\/(\d+)/.test(pathname);
  }

  // 3. โพสต์ของเพจ: /<name>/posts/<post_id> หรือ /<name>/posts/<slug>/<post_id>
  if (/\/[^/]+\/posts\/(?:[^/]+\/)?(\d+|[a-zA-Z0-9._%-]+)/.test(pathname)) {
    return true;
  }

  // 4. permalink.php หรือ story.php (ต้องมี story_fbid หรือ id เพื่อระบุว่าเป็นโพสต์จริง)
  if (pathname.includes('/permalink.php') || pathname.includes('/story.php')) {
    return Boolean(searchParams && (searchParams.has('story_fbid') || searchParams.has('id')));
  }

  // 5. โพสต์รูปภาพหรือวิดีโอที่มี ID เจาะจง
  if (/\/[^/]+\/photos\/(?:[^/]+\/)?(\d+)/.test(pathname) ||
      /\/[^/]+\/videos\/(\d+)/.test(pathname) ||
      (pathname.includes('/watch') && Boolean(searchParams && searchParams.has('v')))) {
    return true;
  }

  // ปฏิเสธ Single Segment Path (เช่น /some.person, /SomeShop) และหน้า profile.php ทั่วไป
  return false;
}

// คำภาษาอังกฤษทั่วไปที่ไม่ใช่ชื่อเฉพาะทางเทคนิค B2B (ป้องกันการสกัดคำเดี่ยวที่กว้างเกินไป)
const GENERIC_ENGLISH_STOP_WORDS = new Set([
  'and', 'the', 'for', 'with', 'system', 'systems', 'platform', 'platforms',
  'solution', 'solutions', 'data', 'time', 'real', 'web', 'app', 'apps',
  'smart', 'growth', 'performance', 'digital', 'service', 'services',
  'management', 'track', 'tracking', 'test', 'testing', 'tech', 'online',
  'free', 'best', 'guide', 'review', 'reviews', 'how', 'pro', 'new',
  'top', 'center', 'lead', 'flow', 'chat', 'auto', 'good', 'great',
  'fast', 'speed', 'slow', 'post', 'posts', 'page', 'pages', 'user',
  'users', 'work', 'works', 'business', 'company', 'tool', 'tools',
  'enterprise', 'cloud', 'mobile', 'development', 'software'
]);

// คำภาษาไทยทั่วไปที่ไม่ใช่หัวข้อเฉพาะทางเทคนิค B2B
const THAI_STOP_WORDS = new Set([
  'และ', 'หรือ', 'ของ', 'กับ', 'ปัญหา', 'แนะนำ', 'ระบบ', 'โปรแกรม',
  'จัดการ', 'ทำงาน', 'บริการ', 'ข้อมูล', 'ออนไลน์', 'เวลา', 'บริษัท',
  'ประเทศไทย', 'ทั่วไป', 'ช่วย', 'สอบถาม', 'ขอคำแนะนำ', 'อยากรู้',
  'วิธี', 'แบบ', 'การ', 'ความ', 'อะไร', 'ทำไม', 'อย่างไร', 'ดีไหม',
  'แนะนำหน่อย', 'แนะนำที', 'แก้ยังไง', 'ทำยังไง', 'ทำไงดี', 'ทำยังไงดี',
  'เจ้าไหนดี', 'มีปัญหา', 'เจอปัญหา', 'ช่วยด้วย', 'ช่วยที', 'สอบถามหน่อย',
  'ปรึกษาหน่อย', 'ป้องกันยังไง', 'เวิร์คไหม', 'โอเคไหม', 'หลุดบ่อย',
  'ไม่รู้เรื่อง', 'ล่าช้า', 'ไม่ตรง', 'ล่มบ่อย', 'โดนแฮก', 'ไม่มีเน็ต',
  'ปรึกษา', 'หาคนช่วย', 'จ้างเขียน', 'ช้ามาก', 'แก้ปัญหา', 'ติดปัญหา',
  'ใครเคยใช้', 'มีใครเคย', 'รีวิว', 'เชื่อมต่อ', 'ติดตั้ง', 'ใช้งาน',
  'ตั้งค่า', 'วิธีใช้', 'มีวิธี'
]);

// คำค้น/เจตนาที่ไม่เกี่ยวข้องกับการหาโซลูชันหรือบริการทางธุรกิจ B2B
// (กรองทิ้ง เช่น รับสมัครงาน/หางาน, ขายรถบรรทุก/ของมือสอง, สื่อการสอน/การบ้านเด็ก, สุขภาพ/บันเทิง, เกม/คอมเล่นเกม, บล็อกส่วนตัว)
const NEGATIVE_INTENT = [
  // รับสมัครงาน / หางาน
  'รับสมัคร', 'ตามหาคน', 'หางาน', 'เปิดรับสมัคร', 'recruiter', 'เงินเดือน', 'สัมภาษณ์', 'resume', 'เรซูเม่', 'job description', 'สมัครงาน', 'หาคนร่วมงาน', 'ร่วมงานกับเรา',
  // ซื้อขายของมือสอง / รถบรรทุก / อสังหา / สินเชื่อ
  'ขายครับ', 'ขายด่วน', 'มือสอง', 'รถบรรทุก', 'รถพ่วง', 'รถดั้ม', 'สภาพสวย', 'ราคา...', 'ดาวน์', 'ผ่อน', 'ให้เช่า', 'ขายที่ดิน', 'ส่งฟรี', 'พร้อมส่ง',
  'mortgage', 'zoning', 'เงินกู้', 'สินเชื่อ', 'คอนโด', 'บ้านเดี่ยว', 'ทาวน์เฮ้าส์', 'อสังหาริมทรัพย์',
  // สื่อการสอน / การบ้าน
  'แบบฝึกหัด', 'สื่อการสอน', 'วิชาคณิตศาสตร์', 'การบ้าน', 'เฉลย', 'ชั้น ป.', 'ชั้น ม.', 'รายงาน', 'วิทยานิพนธ์', 'โครงงานมัธยม', 'โครงงานนักเรียน',
  // สุขภาพ / อาหาร / แฟชั่น / บันเทิง / ไลฟ์สไตล์
  'เปลี่ยนเส้นเอ็น', 'ลดน้ำหนัก', 'อาหารเสริม', 'รีวิวหนัง', 'trailer', 'สิว', 'ผิวขาว', 'เสื้อผ้า', 'ดูดวง', 'ดวงชะตา', 'ราศี', 'รีวิวคาเฟ่', 'ร้านอาหาร', 'ที่พัก', 'โรงแรม', 'ตั๋วเครื่องบิน', 'ท่องเที่ยว', 'สถานที่ท่องเที่ยว', 'ทริปท่องเที่ยว', 'ซีรีส์', 'ละคร', 'เพลง', 'ศิลปิน', 'คอนเสิร์ต', 'ความรัก', 'แฟน', 'อกหัก',
  // เกม / บันเทิง / คอมพิวเตอร์เล่นเกม (Consumer Gaming)
  'เกม', 'เล่นเกม', 'game', 'games', 'gaming', 'gamer', 'steam', 'roblox', 'valorant', 'rov', 'free fire', 'garena', 'discord bot', 'fps', 'คอมเล่นเกม', 'สตรีมเมอร์', 'mod',
  // บล็อกส่วนตัว / คอนซูเมอร์แอป / ซ่อมมือถือทั่วไป / แกดเจ็ตส่วนบุคคล / อุปกรณ์ครัวเรือน
  'บล็อกเกอร์', 'เขียนบล็อก', 'บล็อกส่วนตัว', 'แอปแต่งรูป', 'แอปดูหนัง', 'แอปหาคู่', 'เกมมือถือ', 'ซ่อมมือถือ', 'หน้าจอแตก', 'แบตเสื่อม', 'หูฟัง', 'เคสมือถือ',
  'ไอแพด', 'ipad', 'apple pencil', 'ปากกาไอแพด', 'iphone', 'ไอโฟน', 'แผงโซลาร์', 'โซลาร์เซลล์', 'โซล่าเซลล์',
  // ภาษาต่างประเทศที่ไม่ใช่ภาษาเป้าหมาย (เช่น ภาษาอินโดนีเซีย, เวียดนาม)
  'sudah', 'banyak', 'yang pakai', 'berlangganan', 'untuk anda', 'dengan mudah', 'bisa di'
];

// คำระบุหัวข้อระบบ / ซอฟต์แวร์ / ดิจิทัลทรานส์ฟอร์เมชัน B2B พื้นฐาน (เฉพาะเจาะจงทางธุรกิจ)
const BASE_B2B_KEYWORDS = [
  'erp', 'sap', 'wms', 'tms', 'mes', 'plc', 'scada', 'pos', 'iot', 'ocr', 'api', 'database',
  'dashboard', 'power\\s*bi', 'automation', 'สต็อกสินค้า', 'สต๊อกสินค้า', 'ตัดสต็อก', 'คลังสินค้า',
  'โลจิสติกส์', 'logistics', 'ระบบโรงงาน', 'บาร์โค้ด', 'barcode', 'rfid', 'ซอฟต์แวร์องค์กร',
  'แอปพลิเคชันองค์กร', 'line\\s*oa', 'workflow', 'อนุมัติเอกสาร', 'defect', 'วางระบบ', 'จัดซื้อ',
  'การผลิต', 'จัดการข้อมูลองค์กร', 'supply\\s*chain', 'smart\\s*warehouse', 'smart\\s*inventory',
  'digital\\s*transformation', 'crm', 'payroll', 'โปรแกรมเงินเดือน',
  'โปรแกรมสต็อก', 'ระบบสต็อก', 'โปรแกรมคลังสินค้า', 'ระบบคลังสินค้า', 'โปรแกรม erp',
  'ระบบ erp', 'โปรแกรม wms', 'ระบบ wms', 'โปรแกรม pos', 'ระบบ pos', 'โปรแกรมบัญชี', 'ระบบบัญชี',
  'ระบบขนส่ง', 'โปรแกรมขนส่ง', 'ขนส่งสินค้า', 'จัดการขนส่ง', 'บริหารจัดการรถ', 'บริหารรถขนส่ง', 'ติดตามรถ', 'โปรแกรมติดตามรถ', 'เที่ยววิ่ง',
  'network', 'ระบบเครือข่าย', 'server', 'เซิร์ฟเวอร์', 'infrastructure', 'cloud'
];

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * สกัดคำสำคัญเชิงเทคนิคจากชื่อและรายละเอียดของโซลูชัน
 * กรอง Stop words ทั่วไปออก เพื่อไม่ให้คำสามัญ (เช่น data, time, web, apps) ผ่านเข้ามาเป็น Topic เดี่ยว
 */
function extractSolutionKeywords(sol) {
  if (!sol) return [];
  const terms = new Set();
  const rawTexts = [
    sol.titleTh || '',
    sol.titleEn || '',
    ...(sol.curatedQueries || [])
  ];

  for (const text of rawTexts) {
    if (!text) continue;
    // 1. ดึงกลุ่มคำภาษาอังกฤษ (Phrases 2-3 คำ) เช่น Data Integration, Smart Inventory, Mobile App
    const enPhrases = text.match(/\b[A-Za-z0-9_-]+(?:\s+[A-Za-z0-9_-]+)+\b/g) || [];
    for (const ph of enPhrases) {
      const lower = ph.toLowerCase().trim();
      const words = lower.split(/\s+/);
      // ถ้าคำใน phrase ไม่ใช่ stop words ล้วนๆ ให้เก็บเป็น pattern
      const meaningful = words.filter(w => !GENERIC_ENGLISH_STOP_WORDS.has(w));
      if (meaningful.length > 0 && lower.length >= 5) {
        terms.add(escapeRegex(lower).replace(/\s+/g, '\\s+'));
      }
    }

    // 2. ดึงคำศัพท์ภาษาอังกฤษเฉพาะทางเดี่ยวๆ (ต้องไม่อยู่ใน Stop Words)
    const enWords = text.match(/\b[A-Za-z0-9_-]{3,}\b/g) || [];
    for (const w of enWords) {
      const lower = w.toLowerCase();
      if (!GENERIC_ENGLISH_STOP_WORDS.has(lower) && lower.length >= 3) {
        terms.add(escapeRegex(lower));
      }
    }

    // 3. ดึงคำภาษาไทยเฉพาะทาง (ตัด Stop words ทั่วไป)
    const thClean = text.replace(/^ระบบ\s*/i, '').replace(/[0-9A-Za-z_&/()\\-]/g, ' ').trim();
    const thWords = thClean.split(/\s+/).filter(w => w.length >= 4);
    for (const tw of thWords) {
      const lower = tw.toLowerCase();
      if (!THAI_STOP_WORDS.has(lower)) {
        terms.add(escapeRegex(lower));
      }
    }
  }

  return Array.from(terms);
}

/**
 * สร้าง Dynamic Topic Regex ที่รวมทั้งคำพื้นฐาน และคำสำคัญจากโซลูชันล่าสุดบนเว็บ
 * ป้องกันไม่ให้ Search terms ทั่วไปแทรกเข้ามาเป็นคำผ่านอัตโนมัติ
 */
function buildDynamicSolutionTopicsRegex(extraTerms = [], solutions = []) {
  const allTerms = new Set(BASE_B2B_KEYWORDS);

  // 1. เพิ่มคำสำคัญจากโซลูชัน (SyaCo Catalog หรือ API)
  const solList = (Array.isArray(solutions) && solutions.length) ? solutions : (cachedSolutionsList || SYACO_CATALOG);
  for (const sol of solList) {
    const kws = extractSolutionKeywords(sol);
    kws.forEach(k => allTerms.add(k));
  }

  // 2. เพิ่ม extraTerms ที่ผ่านการกรองความปลอดภัยแล้วเท่านั้น (ไม่ใส่คำทั่วไป/stop words)
  if (Array.isArray(extraTerms)) {
    for (const t of extraTerms) {
      const clean = String(t || '')
        .replace(/site:[^\s]+/gi, '')
        .replace(/inurl:[^\s]+/gi, '')
        .replace(/["']/g, '')
        .trim();
      if (clean.length >= 3) {
        clean.split(/\s+/).forEach(part => {
          const lower = part.toLowerCase();
          if (
            lower.length >= 3 &&
            !GENERIC_ENGLISH_STOP_WORDS.has(lower) &&
            !THAI_STOP_WORDS.has(lower)
          ) {
            allTerms.add(escapeRegex(lower));
          }
        });
      }
    }
  }

  const shortEnTerms = [];
  const phraseTerms = [];

  for (const term of allTerms) {
    if (/^[a-z0-9]{2,4}$/i.test(term)) {
      shortEnTerms.push(term);
    } else {
      phraseTerms.push(term);
    }
  }

  const regexParts = [];
  if (shortEnTerms.length > 0) {
    regexParts.push(`\\b(?:${shortEnTerms.join('|')})\\b`);
  }
  if (phraseTerms.length > 0) {
    regexParts.push(phraseTerms.join('|'));
  }

  return new RegExp(`(?:${regexParts.join('|')})`, 'i');
}

// Global Regex เริ่มต้นจาก SYACO_CATALOG และจะอัปเดตอัตโนมัติเมื่อดึง API สำเร็จ
let B2B_SOLUTION_TOPICS_REGEX = buildDynamicSolutionTopicsRegex([], SYACO_CATALOG);

function updateGlobalTopicsRegex(solutions) {
  B2B_SOLUTION_TOPICS_REGEX = buildDynamicSolutionTopicsRegex([], solutions);
}

// คำ/วลีระบุการโฆษณาขายบริการ หรือประกาศของผู้รับจ้าง/เซลล์ (ต้องปฏิเสธทันที)
const SELLER_PROMOTION_REGEX = /(?:เรารับทำ|บริษัทเรารับ|รับทำระบบ|รับเขียนโปรแกรม|รับพัฒนาระบบ|รับวางระบบ|รับติดตั้งระบบ|รับออกแบบระบบ|ยินดีให้บริการ|พร้อมให้บริการ|ให้บริการด้าน(?:ระบบ|ซอฟต์แวร์|ไอที)|บริการของเรา|สนใจติดต่อ(?:สอบถาม|เรา|ได้ที่|โทร)?|ติดต่อเรา(?:ได้ที่|โทร)?|สอบถามเพิ่มเติมโทร|โทร\s*0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{3,4}|ทักแชท(?:ได้เลย|เข้ามา|มาได้)|inbox\s*(?:ได้เลย|มาได้เลย|สอบถาม)|แอดไลน์|line\s*id|@line|ราคาเริ่มต้น\s*\d|โปรโมชั่นพิเศษ|ขอใบเสนอราคา|ทดลองใช้ฟรี|demo\s*ฟรี|จำหน่ายโปรแกรม|ขายโปรแกรม|เสนอขายโปรแกรม|\b(?:our\s+services?|contact\s+us|dm\s+us|reach\s+out\s+to\s+us|request\s+a\s+demo|free\s+trial|we\s+offer|we\s+provide|click\s+the\s+link|sign\s+up\s+today|download\s+now)\b)/i;

// คำระบุเจตนาปัญหา / ถามวิธีแก้ / ขอคำปรึกษา / กำลังมองหาซอฟต์แวร์หรือ Vendor (Pain Point & Discussion Intent)
const PAIN_POINT_INTENT_REGEX = /(?:(?:เจอ|มี|ติด|พบ|แก้|ช่วยแก้)?ปัญหา(?:การ|เรื่อง|ของ)?|(?:ขอ|ช่วย|รบกวน)?(?:คำแนะนำ|คำปรึกษา)|(?:ช่วย|รบกวน)?แนะนำ(?:.{0,40}?(?:หน่อย|ที|ครับ|ค่ะ|ไหม|บ้าง|ดี))?|(?:รบกวน)?สอบถาม(?:ผู้รู้|พี่ๆ|หน่อย|ครับ|ค่ะ)?|ปรึกษา(?:เรื่อง|หน่อย|ครับ|ค่ะ)?|ช่วยด้วย|ช่วยที|ทำยังไง(?:ดี|ครับ|ค่ะ)?|ทำไง(?:ดี)?|แก้(?:ยังไง|ตรงไหน|อย่างไร)|มีวิธี(?:แก้|ทำ|จัดการ|ป้องกัน)|ใคร(?:เคยเจอ|มีวิธี|ทำเป็น|รู้วิธี)|อยากทราบว่า|อยากปรึกษา|หา(?:โปรแกรม|ระบบ|vendor|บริษัท|ซอฟต์แวร์|เครื่องมือ|คนช่วย|ทีมพัฒนา)|กำลัง(?:หา|มองหา|เลือก|จะทำ|จะซื้อ|ศึกษา)|(?:เลือก|ใช้|เจ้า|ค่าย)?ไหนดี|ดีไหม|เวิร์คไหม|โอเคไหม|เลือกยังไง|เริ่มยังไง|(?:เลือก|จัดซื้อ|หา).{0,25}?(?:ยังไง|เจ้าไหน|ค่ายไหน|ที่ไหน|แบบไหน|ดี)|(?:มี|ใช้).{0,20}?อะไรบ้าง|เปรียบเทียบ|เทียบกับ|เทียบระหว่าง|มีใครเคยใช้|มีใครใช้|แชร์ประสบการณ์|รีวิวจากผู้ใช้จริง|ปวดหัวกับ|เซ็งกับ|เหนื่อยกับ|ติดตรง|(?:ระบบ|เว็บ|แอป|เครื่องจักร|เน็ต|ข้อมูล|สต็อก|สต๊อก).{0,30}?(?:พัง|ค้าง|ช้ามาก|ช้าจัง|หลุด|ล่ม|error|เออเร่อ|ไม่ตรง|หาย|ไม่ขึ้น|เชื่อมไม่ติด|ส่งไม่ไป|ไม่เสถียร|มีปัญหา)|ทำไม.{0,30}?(?:ไม่|ไม่ได้|พัง|ช้า|ติด|ค้าง|ไม่ทัน|หลุด|ล่ม)|ข้อควรระวัง|ล้มเหลว|ผิดพลาด|\b(?:looking for|struggling with|facing (?:an? )?issue|having trouble|troubleshoot(?:ing)?|how to (?:fix|solve|handle)|anyone recommend|which (?:is better|one should I)|comparison|compare|vs|versus|help needed|any advice|stuck with|recommendations? needed|best practices?|implementation|guide|options?|dilemma)\b)/i;

// รองรับ Backward Compatibility สำหรับโค้ดที่อ้างอิงชื่อเดิม
const SOLUTION_INQUIRY_INTENT_REGEX = PAIN_POINT_INTENT_REGEX;

/**
 * คำนวณช่วงปีและสร้างตัวกรองปีแบบไดนามิกอัตโนมัติ (ไม่ฮาร์ดโค้ดปี)
 * ปรับตามเวลาจริงเสมอ แม้ปีจะเปลี่ยนไปในอนาคต (เช่น 2026, 2027, 2028...)
 */
function getDynamicYearFilter(date = new Date()) {
  const currentYear = date.getFullYear();
  const currentBE = currentYear + 543;
  const prevYear = currentYear - 1;
  const prevBE = currentBE - 1;
  const nextYear = currentYear + 1;
  const nextBE = currentBE + 1;

  const recentAD = [prevYear, currentYear, nextYear];
  const recentBE = [prevBE, currentBE, nextBE];
  const recentShortBE = [
    String(prevBE).slice(-2),
    String(currentBE).slice(-2),
    String(nextBE).slice(-2)
  ];

  return {
    currentYear,
    currentBE,
    prevYear,
    prevBE,
    nextYear,
    nextBE,
    recentAD,
    recentBE,
    recentShortBE,
    // ตรวจสอบว่าข้อความมีปีล่าสุดหรือไม่ (ค.ศ., พ.ศ., หรือ ปี XX)
    isRecentYearInText(text) {
      if (!text) return false;
      for (const y of recentAD) {
        if (text.includes(String(y))) return true;
      }
      for (const y of recentBE) {
        if (text.includes(String(y))) return true;
      }
      for (const s of recentShortBE) {
        const re = new RegExp(`ปี\\s*${s}\\b`);
        if (re.test(text)) return true;
      }
      return false;
    },
    // ตรวจสอบว่าข้อความมีปีเก่าที่เกิน 1 ปีหรือไม่
    hasOldYearInText(text) {
      if (!text) return false;
      // 1. ค.ศ. 4 หลัก (1900 ถึง 2099)
      const adMatches = text.match(/\b(19\d{2}|20\d{2})\b/g);
      if (adMatches) {
        for (const m of adMatches) {
          const y = parseInt(m, 10);
          if (y < prevYear) return true;
        }
      }
      // 2. พ.ศ. 4 หลัก (2500 ถึง 2599)
      const beMatches = text.match(/\b(25\d{2})\b/g);
      if (beMatches) {
        for (const m of beMatches) {
          const y = parseInt(m, 10);
          if (y < prevBE) return true;
        }
      }
      // 3. ปีย่อ เช่น ปี 60, ปี 65, ปี 67
      const shortBeMatches = text.match(/ปี\s*([4-9]\d)\b/g);
      if (shortBeMatches) {
        const threshold = prevBE % 100;
        for (const m of shortBeMatches) {
          const numMatch = m.match(/\d+/);
          if (numMatch) {
            const shortVal = parseInt(numMatch[0], 10);
            if (shortVal < threshold && shortVal >= 40) return true;
          }
        }
      }
      return false;
    }
  };
}

/**
 * คำนวณขีดจำกัด Topic ID ต่ำสุดของ Pantip แบบไดนามิก (~1 ปีย้อนหลังจากเวลาปัจจุบัน)
 * อ้างอิงสถิติการสร้างกระทู้ Pantip เฉลี่ย ~600,000 กระทู้ต่อปี (~1,640 กระทู้ต่อวัน)
 */
function getMinPantipTopicId(now = Date.now()) {
  const refTime = new Date('2026-01-01T00:00:00Z').getTime();
  const refId = 43500000;
  const topicsPerDay = 1640;
  const daysDiff = (now - refTime) / (24 * 60 * 60 * 1000);
  const currentEstimatedId = refId + Math.round(daysDiff * topicsPerDay);
  return Math.max(43000000, currentEstimatedId - (365 * topicsPerDay));
}

/**
 * ตรวจสอบความสดใหม่ของโพสต์/กระทู้ ย้อนหลังไม่เกิน 1 ปี (<= 365 วัน)
 * - Exact publishTime / creation_time (จาก OpenGraph/Facebook HTML/JSON): ต้องไม่เกิน 365 วัน
 * - Pantip: กระทู้ต้องมี Topic ID >= minPantipTopicId (คำนวณไดนามิกย้อนหลัง ~1 ปี จากเวลาปัจจุบัน)
 * - LinkedIn: ถอด Snowflake timestamp จาก Activity ID ต้องไม่เกิน 365 วัน
 * - Facebook & ทั่วไป: ตรวจสอบปี โดยคำนวณตามปีปัจจุบันแบบไดนามิกอัตโนมัติ (ไม่ฮาร์ดโค้ดปี)
 * - Facebook permalink: ถ้าไม่มี timestamp และไม่มีการระบุปีใหม่ ให้ตัดออกเนื่องจากเป็นโครงสร้าง URL เก่า
 */
function isRecentPost(item) {
  const url = item.url || '';
  const text = `${item.title || ''} ${item.content || item.snippet || ''}`;
  const now = Date.now();
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  // 1. ตรวจสอบ Timestamp ที่ได้จากการ Unfurl / API โดยตรง (แม่นยำ 100%)
  const publishTime = item.publishTime || item.creationTime;
  if (publishTime && typeof publishTime === 'number') {
    const age = now - publishTime;
    if (age > ONE_YEAR_MS) {
      return false;
    }
  }

  // 2. Pantip topic ID check แบบไดนามิกตามเวลาปัจจุบัน
  if (url.includes('pantip.com')) {
    const m = url.match(/\/topic\/(\d+)/);
    if (m) {
      const topicId = parseInt(m[1], 10);
      const minPantipId = getMinPantipTopicId(now);
      if (topicId < minPantipId) return false;
    }
  }

  // 3. LinkedIn Snowflake timestamp check
  if (url.includes('linkedin.com')) {
    const m = url.match(/activity[a-zA-Z0-9_-]*?(\d{18,20})/);
    if (m) {
      try {
        const idBig = BigInt(m[1]);
        const ms = Number(idBig >> 22n);
        if (ms > 1000000000000 && ms < now + 86400000) {
          const age = now - ms;
          if (age > ONE_YEAR_MS) return false;
        }
      } catch (_) {}
    }
  }

  // 4. กรองปีในข้อความแบบไดนามิกอัตโนมัติ (ไม่ฮาร์ดโค้ดปี)
  const yearFilter = getDynamicYearFilter(new Date(now));
  const hasOld = yearFilter.hasOldYearInText(text);
  const hasRecent = yearFilter.isRecentYearInText(text);

  if (hasOld && !hasRecent) {
    return false;
  }

  return true;
}

/**
 * ตรวจสอบว่าเป็นโพสต์ที่มีปัญหา (Pain Point) หรือมองหาโซลูชัน/ขอคำแนะนำจริงๆ
 * 1. ปฏิเสธ Negative Intent (รับสมัครงาน, ขายรถ/ของมือสอง, การบ้านเด็ก, บันเทิง/สุขภาพ)
 * 2. ปฏิเสธ Seller / Vendor Promotions (โฆษณารับจ้างทำระบบ, บริการของเรา, ทัก inbox, โทรติดต่อ)
 * 3. ตรวจสอบหัวข้อทางเทคโนโลยี/โรงงาน/ซอฟต์แวร์ (Dynamic Topic Matching)
 * 4. ตรวจสอบเจตนา Pain Point / ถามปัญหา / ขอคำปรึกษา / เปรียบเทียบซอฟต์แวร์
 */
function isSolutionPost(item, dynamicRegex = null) {
  const text = `${item.title || ''} ${item.content || item.snippet || ''}`.toLowerCase();
  if (!text.trim()) return false;

  // 1. Negative Intent Check
  for (const neg of NEGATIVE_INTENT) {
    if (text.includes(neg.toLowerCase())) {
      // ข้อยกเว้น: หากพบคำว่า "เงินเดือน" ในบริบทของระบบ/โปรแกรม หรือซอฟต์แวร์ Payroll ให้ถือเป็น Solution Inquiry
      if (neg === 'เงินเดือน' && /(?:โปรแกรม|ระบบ|คำนวณ|จัดการ|สลิป|ซอฟต์แวร์|payroll)\s*เงินเดือน|เงินเดือน\s*(?:พนักงาน|ออนไลน์|โอที)/i.test(text)) {
        continue;
      }
      return false;
    }
  }

  // 2. Reject Seller / Vendor Promotions (ปฏิเสธโพสต์รับทำระบบ / โฆษณาขายบริการ)
  if (SELLER_PROMOTION_REGEX.test(text)) {
    return false;
  }

  // 3. B2B Solution / System Topic Check (Dynamic or Global Regex)
  const regex = dynamicRegex || B2B_SOLUTION_TOPICS_REGEX;
  if (!regex.test(text)) {
    return false;
  }

  // 4. Pain Point & Inquiry Intent Check (ต้องมีเจตนาถามปัญหา ขอคำปรึกษา หรือมองหาระบบ)
  if (!PAIN_POINT_INTENT_REGEX.test(text)) {
    return false;
  }

  return true;
}

// คำ/วลีระบุการโฆษณาขายบริการฮาร์ดเซลส์โดยเฉพาะ (เฉพาะโพสต์ประเภทนี้ที่ปฏิเสธบน Facebook)
const FB_HARD_SPAM_REGEX = /(?:ราคาเริ่มต้น\s*\d|รับจ้างทำรายงาน|รับจ้างทำการบ้าน|รับทำวิทยานิพนธ์|เงินกู้ด่วน|ขายตรง|จำหน่ายโปรแกรม\s*โทร|ขายโปรแกรม\s*โทร|ดาวน์\s*0%|โปรโมชั่นลดกระหน่ำ)/i;

/**
 * ตรวจสอบความเหมาะสมของโพสต์ Facebook (Option 1):
 * - ยอมรับบทความ, คู่มือ, ทริปแก้ปัญหา, การแชร์เทมเพลต, แนะนำระบบ จาก Fanpage ไอทีและชุมชนซอฟต์แวร์ B2B
 * - ผู้ใช้งานมักแลกเปลี่ยน สอบถาม และระบุ Pain Point ในส่วนของคอมเมนต์ใต้โพสต์
 * - กรองเนื้อหาที่ไม่เกี่ยวข้อง (Negative Intent: เกม, ซ่อมจอมือถือ, การบ้าน, หางานส่วนตัว)
 * - กรองโฆษณาฮาร์ดเซลส์ (Hard spam)
 * - ต้องตรงกับหัวข้อระบบธุรกิจ B2B (dynamicTopicsRegex)
 */
function isFacebookSolutionPost(item, dynamicRegex = null) {
  const title = (item.title || '').trim();
  const text = `${title} ${item.content || item.snippet || ''}`.toLowerCase();
  if (!text.trim()) return false;

  // ปฏิเสธหัวข้อที่เป็น Synthetic Placeholder หรือข้อความระบบ
  if (title.includes('โพสต์ข้อความบน Facebook เกี่ยวกับ') ||
      title.includes('Link to facebook.com') ||
      title.toLowerCase() === 'facebook' ||
      title.toLowerCase() === 'log into facebook') {
    return false;
  }

  // 1. Negative Intent Check (ตรวจทั้งข้อความและ URL สำหรับคำต่างประเทศหรือสิ่งที่ไม่เกี่ยวข้อง)
  const urlLower = String(item.url || '').toLowerCase();
  for (const neg of NEGATIVE_INTENT) {
    const negLow = neg.toLowerCase();
    if (text.includes(negLow) || urlLower.includes(negLow)) {
      if (neg === 'เงินเดือน' && /(?:โปรแกรม|ระบบ|คำนวณ|จัดการ|สลิป|ซอฟต์แวร์|payroll)\s*เงินเดือน|เงินเดือน\s*(?:พนักงาน|ออนไลน์|โอที)/i.test(text)) {
        continue;
      }
      return false;
    }
  }

  // 2. Reject Hard Sales Spam
  if (FB_HARD_SPAM_REGEX.test(text)) {
    return false;
  }

  // 3. Must match B2B Topic (Dynamic Topic Matching)
  const regex = dynamicRegex || B2B_SOLUTION_TOPICS_REGEX;
  if (!regex.test(text)) {
    return false;
  }

  return true;
}

/**
 * ตรวจสอบความถูกต้องของ URL และกรองระยะเวลาไม่เกิน 1 ปีนิดๆ
 */
function isValidCandidate(item, targetPlatform = 'all') {
  const url = item.url || '';
  const platform = detectPlatform(url);
  if (!platform) return false;
  if (targetPlatform !== 'all' && platform !== targetPlatform) return false;

  // 1. Pantip: ต้องเป็นกระทู้จริง (/topic/XXXXX) และสดใหม่ภายใน ~1 ปี
  if (platform === 'pantip') {
    const topicMatch = url.match(/\/topic\/(\d+)/);
    if (!topicMatch) return false;
    return isRecentPost(item);
  }

  // 2. LinkedIn: ต้องเป็นโพสต์หรือบทความ Pulse และสดใหม่ภายใน ~1 ปี
  if (platform === 'linkedin') {
    const isPostOrPulse = url.includes('/posts/') || url.includes('/pulse/') || url.includes('/feed/update/');
    if (!isPostOrPulse) return false;
    return isRecentPost(item);
  }

  // 3. Facebook: ต้องเป็น "โพสต์" เท่านั้น และสดใหม่ภายใน ~1 ปี (ปฏิเสธซับโดเมนภาษาต่างประเทศที่มักเป็นสแปม)
  if (platform === 'facebook') {
    if (url.includes('ar-ar.facebook.com') || url.includes('zh-cn.facebook.com') || url.includes('ru-ru.facebook.com')) {
      return false;
    }
    if (!isFacebookPost(url)) return false;
    return isRecentPost(item);
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
      signal: AbortSignal.timeout(6000),
      headers: {
        'Accept': 'application/json',
        'X-Real-IP': '127.0.0.1',
        'X-Forwarded-For': '127.0.0.1',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
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

function formatFacebookContent(rawTitle, rawSnippet) {
  let title = (rawTitle || '').trim();
  let snippet = (rawSnippet || '').trim();

  const isGeneric = (str) => {
    if (!str) return true;
    const s = str.toLowerCase();
    return s.includes('link to facebook.com') ||
           s.includes('the site owner hides') ||
           s === 'facebook' ||
           s === 'log into facebook';
  };

  if (isGeneric(snippet)) snippet = '';
  if (isGeneric(title)) title = '';

  title = title.replace(/\s*[-|]\s*facebook$/i, '').trim();

  if (snippet && snippet.length > 10) {
    const firstLine = snippet.split('\n')[0].trim();
    if (!title) {
      title = firstLine.slice(0, 110);
    }
  }

  // หากไม่มีเนื้อหาจริง ให้คืนค่า null ปฏิเสธโพสต์ที่ไม่มีข้อมูล (ไม่สร้างหัวข้อปลอม)
  if (!title && !snippet) {
    return null;
  }
  if (!title) {
    title = snippet.slice(0, 110);
  }
  if (!snippet) {
    snippet = title;
  }

  return { title, snippet };
}

const CURATED_B2B_FANPAGE_SEEDS = [
  {
    category: 'growth',
    title: 'Tips แก้ปัญหา Network ทุกองค์กร: วิธีดูว่า Ping สูงเกิดจากอะไร - ITC Training Center',
    url: 'https://www.facebook.com/ITcert2005/posts/1618855486953229/',
    snippet: 'Tips แก้ปัญหา Network ทุกองค์กร วิธีดูว่า ping สูง เกิดจากอะไร การตอบสนองช้า หรือเกิดจาก DNS ช้า พร้อมแนวทางการปรับปรุงระบบเครือข่าย'
  },
  {
    category: 'alert',
    title: 'Ditto Thailand - ระบบอนุมัติเอกสารออนไลน์ คืออะไร มีประโยชน์อย่างไร',
    url: 'https://www.facebook.com/imditto/posts/613249971076469/',
    snippet: 'ระบบอนุมัติเอกสารออนไลน์ คืออะไร มีประโยชน์อย่างไร ปัจจุบันการจัดการเอกสารในองค์กรที่ล่าช้าสามารถเปลี่ยนมาเป็น Paperless Workflow ช่วยลดต้นทุนบริษัท'
  },
  {
    category: 'logistics',
    title: 'แจกฟรี! ระบบบริหารจัดการรถขนส่ง v2025 - บริหารงานแบบคนไอที',
    url: 'https://www.facebook.com/ManageWithNoobITguy/posts/1102060021940293/',
    snippet: 'แจกฟรี! ระบบบริหารจัดการรถขนส่ง v2025 เบื่อไหมกับการจัดการรถขนส่งแบบเดิมๆ ที่ควบคุมต้นทุนค่าน้ำมันและติดตามเที่ยววิ่งไม่ได้'
  },
  {
    category: 'logistics',
    title: 'จัดการรถ เที่ยววิ่ง และติดตามงานขนส่งได้ง่ายขึ้นด้วย TMS - Wisawakam Software',
    url: 'https://www.facebook.com/BAMSbyDTC/posts/1592935066175175/',
    snippet: 'จัดการรถ เที่ยววิ่ง และติดตามงานขนส่งสินค้าได้ง่ายขึ้นด้วย TMS ระบบบริหารจัดการงานขนส่งสำหรับผู้ประกอบการโลจิสติกส์'
  },
  {
    category: 'logistics',
    title: 'จัดการงานวิ่งรถง่ายขึ้น ด้วย Excel ระบบรายงานวิ่งงาน - Xsalefile',
    url: 'https://www.facebook.com/Xsalefile/videos/1041321861968841/',
    snippet: 'จัดการงานวิ่งรถง่ายขึ้น ด้วย Excel ระบบรายงานวิ่งงาน เคยเจอปัญหาไหมครับ มีงานวิ่งรถเยอะแต่สรุปยอดและคำนวณต้นทุนต่อเที่ยวไม่ทัน'
  },
  {
    category: 'production',
    title: 'AI Vision Inspection | สอน AI ให้แยกชิ้นงาน OK / NG ได้อย่างไร? - Connex Automation',
    url: 'https://www.facebook.com/connexautomation/posts/1779820387481018',
    snippet: 'AI Vision Inspection สอน AI ให้แยกชิ้นงาน OK / NG ได้อย่างไรจากประสบการณ์ด้าน Industrial Automation ตรวจจับ Defect ในสายการผลิต'
  },
  {
    category: 'production',
    title: 'AI ตรวจจับความผิดปกติ เพื่อการผลิตที่แม่นยำและลดความสูญเสีย - Bosch Thailand',
    url: 'https://www.facebook.com/BoschThailand/posts/1041883394724406',
    snippet: 'ยกระดับโรงงานสู่ Smart Factory ด้วยระบบวิเคราะห์คุณภาพการผลิตล่วงหน้า ตรวจจับ Defect และแจ้งเตือนปัญหาเครื่องจักรแบบเรียลไทม์'
  },
  {
    category: 'warehouse',
    title: 'ระบบสต๊อกสินค้าใช้ AI ช่วยในโกดังได้อย่างไร - Smart Inventory',
    url: 'https://www.facebook.com/groups/1745892855948687/posts/2324316841439616',
    snippet: 'บอกลาปัญหา "ของขาดก็เสียดายยอด ของล้นโกดังก็ทุนจม" ด้วยเทคโนโลยี AI Inventory Optimization และระบบจัดการคลังสินค้า WMS'
  },
  {
    category: 'warehouse',
    title: 'ระบบจัดการหลังบ้านและสต็อกสำหรับเปิดร้านหลายแพลตฟอร์มมีอะไรบ้าง?',
    url: 'https://www.facebook.com/groups/sellerthailand/posts/1889830045356268',
    snippet: 'ปรึกษาเรื่องระบบจัดการหลังบ้าน ตัดสต็อกสินค้าแบบ Real-time ข้ามแพลตฟอร์ม ป้องกันปัญหาสต็อกเบิ้ลและตัดสต็อกไม่ตรง'
  },
  {
    category: 'data',
    title: '5 ERP ที่เหมาะสำหรับบริษัทในอุตสาหกรรมการผลิต - ข้อมูลเปรียบเทียบระบบ',
    url: 'https://www.facebook.com/tamteebaan/posts/1243811480440337',
    snippet: '5 ERP ที่เหมาะสำหรับบริษัทในอุตสาหกรรมการผลิต เปรียบเทียบความสามารถในการจัดการ BOM แผนการผลิต และเชื่อมต่อกับระบบคลังสินค้า'
  },
  {
    category: 'data',
    title: 'โปรแกรม ERP สำหรับโรงงานขนาดกลาง 25 user รองรับ BOM และระบบบัญชี - ชุมชน Thai Admin',
    url: 'https://www.facebook.com/groups/thaiadmin/posts/25301776572765695',
    snippet: 'กำลังศึกษาและเปรียบเทียบโปรแกรม ERP สำหรับโรงงานผลิตขนาดกลาง รองรับสูตรการผลิต (BOM) เชื่อมต่อคลังสินค้าและระบบบัญชีต้นทุน'
  }
];

let pgPool = null;
function getPgPool() {
  if (!pgPool) {
    try {
      const { Pool } = require('pg');
      pgPool = new Pool({
        host: process.env.POSTGRES_HOST || 'postgres',
        port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
        database: process.env.POSTGRES_DB || 'syaco_n8n_db',
        user: process.env.POSTGRES_USER || 'postgres',
        password: process.env.POSTGRES_PASSWORD || 'admin',
        max: 3,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 3000
      });
      pgPool.on('error', err => console.warn('[thread-search] pgPool error:', err.message));
    } catch (_) {
      pgPool = null;
    }
  }
  return pgPool;
}

async function searchFacebookFromDb(terms, limit, seenUrls = new Set(), excludeUrls = new Set(), dynamicTopicsRegex = null) {
  const pool = getPgPool();
  if (!pool) return [];
  try {
    const res = await pool.query(`
      SELECT post_url, post_title, snippet, created_at, search_keyword
      FROM thread_search_cache
      WHERE platform = 'facebook'
        AND post_url ~ '(/posts/|/videos/|/photos/|story_fbid=|/permalink/)'
      ORDER BY id DESC
      LIMIT 100;
    `);
    const results = [];
    const regex = dynamicTopicsRegex || B2B_SOLUTION_TOPICS_REGEX;
    const cleanTerms = (terms || []).map(t => String(t).toLowerCase().replace(/['"]/g, '').trim()).filter(Boolean);

    // Pass 1: ดึงโพสต์ที่ตรงกับคำค้นหาโดยตรงก่อน (Strict Keyword Relevance)
    if (cleanTerms.length > 0) {
      for (const r of res.rows) {
        if (results.length >= limit) break;
        const clean = cleanUrl(r.post_url, 'facebook');
        if (seenUrls.has(clean) || (excludeUrls && excludeUrls.has(clean))) continue;

        const postItem = {
          url: clean,
          title: (r.post_title || '').trim(),
          snippet: (r.snippet || '').trim(),
          content: (r.snippet || '').trim(),
          creationTime: r.created_at ? new Date(r.created_at).getTime() : null
        };

        if (!isFacebookPost(clean)) continue;
        if (!isFacebookSolutionPost(postItem, regex)) continue;
        if (!isRecentPost(postItem)) continue;

        const fullText = `${postItem.title} ${postItem.snippet} ${r.search_keyword || ''}`.toLowerCase();
        const matchesTerm = cleanTerms.some(term => {
          const words = term.split(/\s+/).filter(w => w.length >= 2);
          return words.some(w => fullText.includes(w));
        });
        if (!matchesTerm) continue;

        seenUrls.add(clean);
        results.push({
          platform: 'facebook',
          title: postItem.title.slice(0, 150),
          url: clean,
          snippet: postItem.snippet.slice(0, 250)
        });
      }
    }

    // Pass 2: หากผลลัพธ์ยังไม่ครบ limit ให้ดึงโพสต์ในหมวดหมู่ B2B ทั่วไปเสริม
    if (results.length < limit) {
      for (const r of res.rows) {
        if (results.length >= limit) break;
        const clean = cleanUrl(r.post_url, 'facebook');
        if (seenUrls.has(clean) || (excludeUrls && excludeUrls.has(clean))) continue;

        const postItem = {
          url: clean,
          title: (r.post_title || '').trim(),
          snippet: (r.snippet || '').trim(),
          content: (r.snippet || '').trim(),
          creationTime: r.created_at ? new Date(r.created_at).getTime() : null
        };

        if (!isFacebookPost(clean)) continue;
        if (!isFacebookSolutionPost(postItem, regex)) continue;
        if (!isRecentPost(postItem)) continue;

        seenUrls.add(clean);
        results.push({
          platform: 'facebook',
          title: postItem.title.slice(0, 150),
          url: clean,
          snippet: postItem.snippet.slice(0, 250)
        });
      }
    }

    return results;
  } catch (err) {
    console.warn('[thread-search] searchFacebookFromDb error:', err.message);
    return [];
  }
}

function getCuratedFacebookSeeds(terms, limit, seenUrls = new Set(), excludeUrls = new Set(), dynamicTopicsRegex = null, solutionCategory = '') {
  const results = [];
  const regex = dynamicTopicsRegex || B2B_SOLUTION_TOPICS_REGEX;
  const cleanTerms = (terms || []).map(t => String(t).toLowerCase().replace(/['"]/g, '').trim()).filter(Boolean);
  const catLow = String(solutionCategory || '').toLowerCase();

  for (const s of CURATED_B2B_FANPAGE_SEEDS) {
    if (results.length >= limit) break;
    const clean = cleanUrl(s.url, 'facebook');
    if (seenUrls.has(clean) || (excludeUrls && excludeUrls.has(clean))) continue;

    const postItem = {
      url: clean,
      title: s.title,
      snippet: s.snippet,
      content: s.snippet
    };

    if (!isFacebookSolutionPost(postItem, regex)) continue;

    if (catLow && s.category && s.category.includes(catLow)) {
      seenUrls.add(clean);
      results.push({
        platform: 'facebook',
        title: s.title.slice(0, 150),
        url: clean,
        snippet: s.snippet.slice(0, 250)
      });
      continue;
    }

    if (cleanTerms.length > 0) {
      const fullText = `${s.title} ${s.snippet}`.toLowerCase();
      const matchesTerm = cleanTerms.some(term => {
        const words = term.split(/\s+/).filter(w => w.length >= 2);
        return words.some(w => fullText.includes(w));
      });
      if (matchesTerm) {
        seenUrls.add(clean);
        results.push({
          platform: 'facebook',
          title: s.title.slice(0, 150),
          url: clean,
          snippet: s.snippet.slice(0, 250)
        });
      }
    }
  }

  if (results.length < limit) {
    for (const s of CURATED_B2B_FANPAGE_SEEDS) {
      if (results.length >= limit) break;
      const clean = cleanUrl(s.url, 'facebook');
      if (seenUrls.has(clean) || (excludeUrls && excludeUrls.has(clean))) continue;

      seenUrls.add(clean);
      results.push({
        platform: 'facebook',
        title: s.title.slice(0, 150),
        url: clean,
        snippet: s.snippet.slice(0, 250)
      });
    }
  }

  return results;
}

async function searchFacebookThreads(terms, limit = 5, solutionCategory = '', excludeUrls = new Set(), solutions = [], extraTerms = []) {
  const dynamicTopicsRegex = buildDynamicSolutionTopicsRegex(extraTerms, solutions);
  const searchTerms = Array.isArray(terms) && terms.length > 0 ? terms : ['Business Solution'];

  const results = [];
  const seenUrls = new Set();

  // 1. ลองค้นหาผ่าน SearXNG (หาก Search Engine สามารถดึงผลลัพธ์ใหม่ได้)
  const queries = [];
  for (const t of searchTerms.slice(0, 2)) {
    queries.push(`site:facebook.com ${t}`);
    if (!t.includes('ปัญหา')) queries.push(`site:facebook.com ${t} ปัญหา`);
  }

  for (const q of queries) {
    if (results.length >= limit) break;
    try {
      const rawList = await querySearxng(q);

      for (const item of rawList) {
        if (!isFacebookPost(item.url)) continue;

        const clean = cleanUrl(item.url, 'facebook');
        if (seenUrls.has(clean) || (excludeUrls && excludeUrls.has(clean))) continue;

        const title = item.title || '';
        const snippet = item.content || '';
        let publishTime = item.publishedDate ? new Date(item.publishedDate).getTime() : null;

        let formatted = formatFacebookContent(title, snippet);

        if (!formatted) {
          const unfurled = await unfurlFacebookMetadata(clean);
          if (unfurled && (unfurled.title || unfurled.snippet)) {
            formatted = formatFacebookContent(unfurled.title, unfurled.snippet);
            if (unfurled.publishTime) {
              publishTime = unfurled.publishTime;
            }
          }
        }

        if (!formatted) continue;

        const postItem = {
          url: clean,
          title: formatted.title,
          content: formatted.snippet,
          snippet: formatted.snippet,
          publishTime
        };

        if (!isFacebookSolutionPost(postItem, dynamicTopicsRegex)) continue;
        if (!isRecentPost(postItem)) continue;

        seenUrls.add(clean);
        results.push({
          platform: 'facebook',
          title: formatted.title.slice(0, 150),
          url: clean,
          snippet: formatted.snippet.slice(0, 250)
        });

        if (results.length >= limit) break;
      }
    } catch (err) {
      console.warn('[searchFacebookThreads] Query failed:', err.message);
    }
  }

  // 2. ดึงจากคลังโพสต์ Facebook คุณภาพสูงใน PostgreSQL (thread_search_cache)
  if (results.length < limit) {
    const dbResults = await searchFacebookFromDb(searchTerms, limit - results.length, seenUrls, excludeUrls, dynamicTopicsRegex);
    for (const item of dbResults) {
      results.push(item);
      if (results.length >= limit) break;
    }
  }

  // 3. Fallback: Curated B2B Fanpage Seeds (การันตีผลลัพธ์คุณภาพเสมอ)
  if (results.length < limit) {
    const seedResults = getCuratedFacebookSeeds(searchTerms, limit - results.length, seenUrls, excludeUrls, dynamicTopicsRegex, solutionCategory);
    for (const item of seedResults) {
      results.push(item);
      if (results.length >= limit) break;
    }
  }

  // 4. หาก excludeUrls กรองจนผลลัพธ์ไม่ถึง limit ให้ผ่อนปรน excludeUrls เพื่อส่งมอบโพสต์คุณภาพให้ผู้ใช้
  if (results.length < limit) {
    const fallbackResults = await searchFacebookFromDb(searchTerms, limit - results.length, seenUrls, new Set(), dynamicTopicsRegex);
    for (const item of fallbackResults) {
      results.push(item);
      if (results.length >= limit) break;
    }
  }

  return results.slice(0, limit);
}

/**
 * สกัดคำสำคัญสำหรับค้นหาบน Pantip Search โดยตัดคำเชื่อมและคำสร้อยสนทนา
 * ช่วยให้ Pantip Search ดึงกระทู้ที่เกี่ยวข้องได้ตรงเป้าหมาย
 */
function extractPantipSearchKeywords(rawTerm) {
  if (!rawTerm) return ['ERP'];
  const clean = String(rawTerm)
    .replace(/(?:แก้ยังไง|ทำยังไง|แนะนำหน่อย|แนะนำที|เจ้าไหนดี|ช่วยด้วย|ช่วยที|มีปัญหา|เจอปัญหา|ทำไงดี|ยังไงดี|ดีไหม|หน่อยค่ะ|หน่อยครับ|ไม่ได้|error|มีวิธี)/gi, '')
    .trim();

  const words = clean.split(/\s+/).filter(Boolean);
  const candidates = [rawTerm.trim()];
  if (clean && clean !== rawTerm.trim()) {
    candidates.push(clean);
  }
  // ดึงคำเฉพาะทางเชิงเทคนิค เช่น PLC, ERP, WMS, SCADA, API, CRM, POS ออกมาเป็นคีย์เวิร์ดสำรอง
  const techMatches = clean.match(/\b[A-Za-z0-9_-]{3,}\b/g) || [];
  for (const tm of techMatches) {
    if (!GENERIC_ENGLISH_STOP_WORDS.has(tm.toLowerCase())) {
      candidates.push(tm);
    }
  }
  if (words.length > 2) {
    const pair = words.slice(0, 2).join(' ');
    if (pair.length >= 4) candidates.push(pair);
  }
  return [...new Set(candidates.filter(c => c && c.length >= 2))];
}

/**
 * ค้นหากระทู้จาก Pantip Search โดยตรง (Native Pantip Search)
 * แม่นยำ รวดเร็ว และได้กระทู้ Pain Point ธุรกิจจริงล่าสุด ไม่ผ่านการถูกบิดเบือนของ Search Engine
 */
async function searchPantipDirect(term, limit = 5, excludeUrls = new Set(), dynamicTopicsRegex = null) {
  try {
    const url = `https://pantip.com/search?q=${encodeURIComponent(term)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'th,en-US;q=0.9,en;q=0.8'
      },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return [];
    const html = await res.text();

    const results = [];
    const seenUrls = new Set();

    const topicBlocks = html.split(/<h2>\s*<a\s+href="https?:\/\/(?:www\.)?pantip\.com\/topic\/(\d+)"/);

    for (let i = 1; i < topicBlocks.length; i += 2) {
      if (results.length >= limit) break;
      const topicId = topicBlocks[i];
      const rest = topicBlocks[i + 1] || '';
      const fullUrl = `https://pantip.com/topic/${topicId}`;

      const titleEnd = rest.indexOf('</a>');
      let rawTitle = titleEnd !== -1 ? rest.slice(0, titleEnd).replace(/<[^>]+>/g, '').trim() : '';
      rawTitle = rawTitle.replace(/^[^>]*>/, '').replace(/ - Pantip$/i, '').trim();
      if (!rawTitle) continue;

      const snipMatch = rest.match(/class="pt-list-item__sr__content__inner">([\s\S]*?)<\/div>/);
      let snippet = snipMatch ? snipMatch[1].replace(/<[^>]+>/g, '').trim() : rawTitle;

      const item = {
        platform: 'pantip',
        title: rawTitle.slice(0, 150),
        url: fullUrl,
        snippet: snippet.slice(0, 250)
      };

      if (!isValidCandidate(item, 'pantip')) continue;
      if (!isSolutionPost(item, dynamicTopicsRegex)) continue;

      const clean = cleanUrl(item.url, 'pantip');
      if (seenUrls.has(clean) || (excludeUrls && excludeUrls.has(clean))) continue;
      seenUrls.add(clean);

      results.push(item);
    }

    return results;
  } catch (err) {
    console.warn(`[searchPantipDirect] Failed for "${term}":`, err.message);
    return [];
  }
}

/**
 * ค้นหาเฉพาะ Pantip
 */
async function searchPantipThreads(terms, limit = 5, excludeUrls = new Set(), solutions = [], extraTerms = []) {
  const dynamicTopicsRegex = buildDynamicSolutionTopicsRegex(extraTerms, solutions);
  const searchTerms = Array.isArray(terms) && terms.length > 0 ? terms : ['Business Solution'];
  const results = [];
  const seenUrls = new Set();

  // 1. ค้นหาผ่าน Native Pantip Search เป็นลำดับแรก (แม่นยำ ได้กระทู้จริงสดใหม่ 100%)
  for (const t of searchTerms.slice(0, 3)) {
    if (results.length >= limit) break;
    const variants = extractPantipSearchKeywords(t);
    for (const v of variants) {
      if (results.length >= limit) break;
      const directResults = await searchPantipDirect(v, limit - results.length, excludeUrls, dynamicTopicsRegex);
      for (const item of directResults) {
        if (!seenUrls.has(item.url)) {
          seenUrls.add(item.url);
          results.push(item);
          if (results.length >= limit) break;
        }
      }
    }
  }

  if (results.length >= limit) {
    return results;
  }

  // 2. หากยังไม่ครบ limit ให้ค้นหาผ่าน SearXNG เสริม
  const currentYear = new Date().getFullYear();
  const currentBE = currentYear + 543;
  const queries = [];
  for (const t of searchTerms.slice(0, 2)) {
    queries.push(`site:pantip.com ${t}`);
    if (!t.includes('ปัญหา')) queries.push(`site:pantip.com ${t} ปัญหา`);
    if (!t.includes('แนะนำ')) queries.push(`site:pantip.com ${t} แนะนำ`);
    queries.push(`site:pantip.com ${t} ${currentBE}`);
  }

  for (const q of queries) {
    if (results.length >= limit) break;
    try {
      const rawList = await querySearxng(q);

      for (const item of rawList) {
        if (!isValidCandidate(item, 'pantip')) continue;
        if (!isSolutionPost(item, dynamicTopicsRegex)) continue;

        const clean = cleanUrl(item.url, 'pantip');
        if (seenUrls.has(clean) || (excludeUrls && excludeUrls.has(clean))) continue;
        seenUrls.add(clean);

        results.push({
          platform: 'pantip',
          title: String(item.title || 'ไม่มีหัวข้อ').replace(/ - Pantip$/i, '').trim().slice(0, 150),
          url: clean,
          snippet: String(item.content || '').trim().slice(0, 250)
        });

        if (results.length >= limit) break;
      }
    } catch (err) {
      console.warn('[searchPantipThreads] Query failed:', err.message);
    }
  }

  return results;
}

/**
 * ค้นหาเฉพาะ LinkedIn
 */
async function searchLinkedInThreads(terms, limit = 5, excludeUrls = new Set(), solutions = [], extraTerms = []) {
  const dynamicTopicsRegex = buildDynamicSolutionTopicsRegex(extraTerms, solutions);
  const searchTerms = Array.isArray(terms) && terms.length > 0 ? terms : ['Business Solution'];

  const queries = [];
  for (const t of searchTerms.slice(0, 2)) {
    queries.push(`site:linkedin.com/posts ${t} Thailand`);
    queries.push(`site:linkedin.com/posts ${t}`);
    if (!t.includes('ปัญหา')) queries.push(`site:linkedin.com/posts ${t} ปัญหา`);
  }

  const results = [];
  const seenUrls = new Set();

  for (const q of queries) {
    if (results.length >= limit) break;
    try {
      const rawList = await querySearxng(q);

      for (const item of rawList) {
        if (!isValidCandidate(item, 'linkedin')) continue;
        if (!isSolutionPost(item, dynamicTopicsRegex)) continue;

        const clean = cleanUrl(item.url, 'linkedin');
        if (seenUrls.has(clean) || (excludeUrls && excludeUrls.has(clean))) continue;
        seenUrls.add(clean);

        results.push({
          platform: 'linkedin',
          title: String(item.title || 'ไม่มีหัวข้อ').replace(/ - LinkedIn$/i, '').trim().slice(0, 150),
          url: clean,
          snippet: String(item.content || '').trim().slice(0, 250)
        });

        if (results.length >= limit) break;
      }
    } catch (err) {
      console.warn('[searchLinkedInThreads] Query failed:', err.message);
    }
  }

  return results;
}

/**
 * ค้นหากระทู้/โพสต์ตาม Keyword และ Platform (ระยะเวลาไม่เกิน 1 ปี)
 * มีระบบกระจายโควตาแพลตฟอร์มที่เป็นธรรม และไม่ค้นหากระทู้ที่เคยพบแล้ว (excludeUrls)
 */
async function searchRecentThreads({ keyword, mode = 'manual', platform = 'all', limit = 5, excludeUrls = new Set() }) {
  const isAutoMode = mode === 'auto' || (keyword && keyword.startsWith('auto')) || (!keyword && mode !== 'manual');

  let autoMeta = null;
  let queriesToRun = [];

  // โหลดโซลูชันล่าสุดจาก API SyaCo เพื่อให้คำสำคัญเป็น Dynamic เสมอ
  const allSolutions = await fetchSyacoSolutions();

  if (isAutoMode) {
    let cat = 'auto';
    if (keyword && keyword.startsWith('auto:')) {
      cat = keyword.replace('auto:', '');
    }
    autoMeta = await generateAutoQueries(cat);
    queriesToRun = autoMeta.queries || ['ERP'];
    // เพิ่ม curatedQueries ของโซลูชันนั้นเสริมเข้าไป เพื่อให้มีคีย์เวิร์ดค้นหาที่เป็นมาตรฐานและแม่นยำสูง
    const matchedSol = SYACO_CATALOG.find(c => c.key === autoMeta.solutionKey || c.titleTh === autoMeta.solutionTitle);
    if (matchedSol && Array.isArray(matchedSol.curatedQueries)) {
      queriesToRun = [...new Set([...queriesToRun, ...matchedSol.curatedQueries])];
    }
  } else {
    const clean = String(keyword || '').trim();
    if (!clean) {
      autoMeta = await generateAutoQueries('auto');
      queriesToRun = autoMeta.queries || ['ERP'];
      const matchedSol = SYACO_CATALOG.find(c => c.key === autoMeta.solutionKey || c.titleTh === autoMeta.solutionTitle);
      if (matchedSol && Array.isArray(matchedSol.curatedQueries)) {
        queriesToRun = [...new Set([...queriesToRun, ...matchedSol.curatedQueries])];
      }
    } else {
      queriesToRun = [clean];
    }
  }

  const solKey = autoMeta?.solutionKey || (keyword?.startsWith('auto:') ? keyword.replace('auto:', '') : '');
  const extraTerms = queriesToRun;

  // 1. กรณีระบุแพลตฟอร์มเจาะจง Facebook
  if (platform === 'facebook') {
    const fbResults = await searchFacebookThreads(queriesToRun, limit, solKey, excludeUrls, allSolutions, extraTerms);
    return { autoMeta, results: fbResults.slice(0, limit) };
  }

  // 2. กรณีระบุแพลตฟอร์มเจาะจง Pantip
  if (platform === 'pantip') {
    const ptResults = await searchPantipThreads(queriesToRun, limit, excludeUrls, allSolutions, extraTerms);
    return { autoMeta, results: ptResults.slice(0, limit) };
  }

  // 3. กรณีระบุแพลตฟอร์มเจาะจง LinkedIn
  if (platform === 'linkedin') {
    const liResults = await searchLinkedInThreads(queriesToRun, limit, excludeUrls, allSolutions, extraTerms);
    return { autoMeta, results: liResults.slice(0, limit) };
  }

  // 4. กรณี platform === 'all': ค้นหาแบบเรียงลำดับ (Sequential) โดยดึง Pantip เป็นหลัก (เสถียรและได้ผลลัพธ์จริง) ตามด้วย LinkedIn และ Facebook
  const ptTarget = Math.max(2, Math.round(limit * 0.5));
  const liTarget = Math.max(1, Math.round(limit * 0.25));
  const fbTarget = Math.max(1, limit - ptTarget - liTarget);

  const ptList = await searchPantipThreads(queriesToRun, ptTarget, excludeUrls, allSolutions, extraTerms);
  const liList = await searchLinkedInThreads(queriesToRun, liTarget, excludeUrls, allSolutions, extraTerms);
  const fbList = await searchFacebookThreads(queriesToRun, fbTarget, solKey, excludeUrls, allSolutions, extraTerms);

  let combined = [...ptList, ...liList, ...fbList];

  // หากยังไม่ครบ limit ให้เติมส่วนที่ขาดจาก Pantip
  if (combined.length < limit) {
    const deficit = limit - combined.length;
    const morePt = await searchPantipThreads(queriesToRun, ptTarget + deficit, excludeUrls, allSolutions, extraTerms);
    const existingUrls = new Set(combined.map(r => r.url));
    for (const p of morePt) {
      if (!existingUrls.has(p.url) && (!excludeUrls || !excludeUrls.has(p.url)) && combined.length < limit) {
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
 * พร้อมป้องกันการดึงกระทู้ที่เคยค้นพบไปแล้ว (excludeUrls)
 */
async function collectDailyRadarThreads(targetCount = 20, excludeUrls = new Set()) {
  const categories = ['warehouse', 'data', 'logistics', 'production', 'alert', 'crm'];
  const shuffled = [...categories].sort(() => Math.random() - 0.5).slice(0, 4);

  const allResults = [];
  const seenUrls = new Set();
  const solutionsCovered = new Set();

  const deadline = Date.now() + 35000; // กำหนดเพดานเวลาค้นหาเรดาร์รวมไม่เกิน 35 วินาที

  for (const cat of shuffled) {
    if (allResults.length >= targetCount || Date.now() > deadline) break;

    try {
      const sol = SYACO_CATALOG.find(c => c.key === cat) || SYACO_CATALOG[0];
      const queries = sol.curatedQueries;
      solutionsCovered.add(sol.titleTh);

      // ดึงแบบ Sequential เพื่อความเสถียรและป้องกัน SearXNG คิวล้น
      const ptBatch = await searchPantipThreads(queries, 3, excludeUrls, SYACO_CATALOG, []);
      const liBatch = await searchLinkedInThreads(queries, 2, excludeUrls, SYACO_CATALOG, []);
      const fbBatch = await searchFacebookThreads(queries, 2, cat, excludeUrls, SYACO_CATALOG, []);

      for (const item of [...ptBatch, ...liBatch, ...fbBatch]) {
        if (!seenUrls.has(item.url) && (!excludeUrls || !excludeUrls.has(item.url)) && allResults.length < targetCount) {
          seenUrls.add(item.url);
          allResults.push({
            ...item,
            solutionCategory: sol.titleTh || cat
          });
        }
      }
    } catch (err) {
      console.warn(`[DailyRadar] Error gathering for category ${cat}:`, err.message);
    }
  }

  return {
    results: allResults.slice(0, targetCount),
    solutionsCovered: Array.from(solutionsCovered)
  };
}

module.exports = {
  searchRecentThreads,
  searchPantipDirect,
  extractPantipSearchKeywords,
  searchFacebookThreads,
  searchPantipThreads,
  searchLinkedInThreads,
  collectDailyRadarThreads,
  generateAutoQueries,
  fetchSyacoSolutions,
  cleanUrl,
  detectPlatform,
  isValidCandidate,
  isFacebookPost,
  isRecentPost,
  isSolutionPost,
  isFacebookSolutionPost,
  getDynamicYearFilter,
  getMinPantipTopicId,
  NEGATIVE_INTENT,
  SELLER_PROMOTION_REGEX,
  PAIN_POINT_INTENT_REGEX,
  SOLUTION_INQUIRY_INTENT_REGEX,
  unfurlFacebookMetadata,
  SYACO_CATALOG,
  CURATED_FACEBOOK_COMMUNITIES,
  buildDynamicSolutionTopicsRegex,
  extractSolutionKeywords,
  updateGlobalTopicsRegex,
  BASE_B2B_KEYWORDS,
  formatFacebookContent
};
