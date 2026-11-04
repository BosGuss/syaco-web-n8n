const assert = require('assert');

function assemblePayload(item) {
  function buildContent(isTh) {
    const titles = isTh ? {
      results: 'ผลลัพธ์',
      problems: 'เราช่วยแก้ปัญหาอะไร',
      target: 'ระบบนี้เหมาะกับใคร',
      examples: 'ตัวอย่างระบบที่พัฒนา'
    } : {
      results: 'Expected Results',
      problems: 'What problems we solve',
      target: 'Who this system is for',
      examples: 'Examples of Developed Systems'
    };

    const contentAi = typeof item.content_ai === 'string' ? JSON.parse(item.content_ai) : (item.content_ai || {});
    const langData = contentAi[isTh ? 'th' : 'en'] || {};

    return {
      hero: {
        titleLine1: isTh ? item.title_th : item.title_en,
        description: isTh ? item.description_th : item.description_en,
        backgroundImage: '/asset/image/bg/ai-hero-bg.webp'
      },
      solutions: {
        results: {
          title: titles.results,
          items: langData.results || []
        },
        problems: {
          title: titles.problems,
          items: langData.problems || []
        },
        targetAudience: {
          title: titles.target,
          items: (langData.targetAudience || []).map((t, idx) => ({
            icon: `/asset/icons/target-${(idx % 4) + 1}.svg`,
            text: typeof t === 'string' ? t : (t.text || '')
          }))
        }
      },
      examplesDeveloped: {
        title: titles.examples,
        items: []
      }
    };
  }

  const rawFeatures = typeof item.features === 'string' ? JSON.parse(item.features) : (item.features || []);

  return {
    titleEn: item.title_en,
    titleTh: item.title_th,
    descEn: item.description_en,
    descTh: item.description_th,
    link: '',
    icon: 'Layers',
    alt: item.title_en,
    order: 99,
    isPublished: false,
    metaTitleTh: item.title_th,
    metaTitleEn: item.title_en,
    metaDescriptionTh: item.description_th,
    metaDescriptionEn: item.description_en,
    features: (Array.isArray(rawFeatures) ? rawFeatures : []).map((f, i) => ({
      labelTh: f.labelTh || f.titleTh || f,
      labelEn: f.labelEn || f.titleEn || f,
      order: i + 1
    })),
    content: {
      th: buildContent(true),
      en: buildContent(false)
    }
  };
}

const mockItem = {
  title_th: 'ระบบเชื่อมโยงข้อมูล PLC เข้ากับ SAP',
  title_en: 'Automated PLC to SAP Gateway',
  description_th: 'เชื่อมต่อข้อมูลเครื่องจักรเข้าสู่ SAP อัตโนมัติ',
  description_en: 'Automated data pipeline from shop-floor PLC to SAP ERP',
  features: [{ labelTh: 'Real-time Sync', labelEn: 'Real-time Sync' }],
  content_ai: {
    th: {
      results: ['ลดเวลาบันทึกข้อมูล'],
      problems: ['ระบบแยกส่วน'],
      targetAudience: ['โรงงานอุตสาหกรรม']
    },
    en: {
      results: ['Reduced sync delay'],
      problems: ['Data silos'],
      targetAudience: ['Manufacturing plants']
    }
  }
};

const payload = assemblePayload(mockItem);
assert.strictEqual(payload.isPublished, false, 'isPublished must be false');
assert.strictEqual(payload.link, '', 'link must be empty string for backend slugify');
assert.strictEqual(payload.content.th.solutions.targetAudience.items[0].icon, '/asset/icons/target-1.svg');
assert.deepStrictEqual(payload.content.th.examplesDeveloped.items, []);
console.log('✅ Flow 1 payload assembler logic passed all checks.');
