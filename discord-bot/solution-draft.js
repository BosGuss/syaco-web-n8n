/**
 * SyaCo Solution Draft Publisher Module
 * Handles atomic locking in PostgreSQL, SyaCo payload generation, and publishing as draft.
 * Strictly compliant with Api.DTOs.SolutionCreateRequest DataAnnotations.
 */

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

function normalizeIcon(icon) {
  const raw = String(icon || '').trim();
  if (!raw) return 'lucide:layers';
  if (raw.includes(':')) return raw.slice(0, 300);
  const clean = raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return `lucide:${clean || 'layers'}`.slice(0, 300);
}

function buildContent(item, isTh, featuresList) {
  const lang = isTh ? 'th' : 'en';
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

  let contentAi = item.content_ai;
  if (typeof contentAi === 'string') {
    try {
      contentAi = JSON.parse(contentAi);
    } catch {
      contentAi = {};
    }
  }
  contentAi = contentAi || {};
  const langData = contentAi[lang] || {};

  // Build examples developed: if empty, generate 2-3 items from features
  let examplesItems = Array.isArray(langData.examplesDeveloped?.items)
    ? langData.examplesDeveloped.items
    : [];

  if (examplesItems.length === 0 && featuresList && featuresList.length > 0) {
    examplesItems = featuresList.slice(0, 3).map((f, idx) => ({
      title: String(isTh ? (f.labelTh || f.titleTh || f) : (f.labelEn || f.titleEn || f)).trim().slice(0, 160),
      desc: String(isTh ? item.description_th : item.description_en).trim().slice(0, 300),
      icon: `/asset/icons/home-services-${(idx % 4) + 1}.svg`
    }));
  }

  return {
    hero: {
      titleLine1: (isTh ? item.title_th : item.title_en || '').trim().slice(0, 160),
      description: (isTh ? item.description_th : item.description_en || '').trim().slice(0, 500),
      backgroundImage: '/asset/image/bg/ai-hero-bg.webp'
    },
    solutions: {
      results: {
        title: titles.results,
        items: (Array.isArray(langData.results) ? langData.results : []).map(r => String(r).trim().slice(0, 300))
      },
      problems: {
        title: titles.problems,
        items: (Array.isArray(langData.problems) ? langData.problems : []).map(p => String(p).trim().slice(0, 300))
      },
      targetAudience: {
        title: titles.target,
        items: (Array.isArray(langData.targetAudience) ? langData.targetAudience : []).map((t, idx) => ({
          icon: `/asset/icons/target-${(idx % 4) + 1}.svg`,
          text: String(typeof t === 'string' ? t : (t?.text || '')).trim().slice(0, 300)
        }))
      }
    },
    examplesDeveloped: {
      title: titles.examples,
      items: examplesItems
    }
  };
}

function buildSyacoPayload(item, orderNumber) {
  // 1. Sanitize Titles (MaxLength 160)
  const titleEn = String(item.title_en || '').trim().slice(0, 160);
  const titleTh = String(item.title_th || titleEn).trim().slice(0, 160);

  // 2. Sanitize Descriptions (MaxLength 500)
  const descEn = String(item.description_en || '').trim().slice(0, 500);
  const descTh = String(item.description_th || descEn).trim().slice(0, 500);

  // 3. Compute Slug & Link (MaxLength 300)
  const slug = slugify(titleEn);
  const link = (slug ? `/solutions/${slug}` : '/solutions').slice(0, 300);

  // 4. Sanitize Icon & Alt (MaxLength 300)
  const icon = normalizeIcon(item.icon || 'lucide:layers');
  const alt = `${titleEn} Icon`.slice(0, 300);

  // 5. Parse & Sanitize Features (SolutionFeatureInput: LabelEn/LabelTh MaxLength 160)
  let rawFeatures = item.features;
  if (typeof rawFeatures === 'string') {
    try {
      rawFeatures = JSON.parse(rawFeatures);
    } catch {
      rawFeatures = [];
    }
  }
  const featuresList = Array.isArray(rawFeatures) ? rawFeatures : [];
  const features = featuresList.map((f, i) => {
    const labelEn = String(f?.labelEn || f?.titleEn || (typeof f === 'string' ? f : '')).trim().slice(0, 160);
    const labelTh = String(f?.labelTh || f?.titleTh || labelEn).trim().slice(0, 160);
    return {
      labelEn: labelEn || 'Enterprise Feature',
      labelTh: labelTh || 'Enterprise Feature',
      order: i + 1
    };
  }).filter(f => f.labelEn && f.labelTh);

  // 6. Metadata (MetaTitle MaxLength 200, MetaDescription MaxLength 500)
  const metaTitleEn = `${titleEn} | SyaCo`.slice(0, 200);
  const metaTitleTh = `${titleTh} | SyaCo`.slice(0, 200);
  const metaDescriptionEn = descEn.slice(0, 500);
  const metaDescriptionTh = descTh.slice(0, 500);

  let finalOrder = orderNumber;
  if (!Number.isInteger(finalOrder) || finalOrder <= 0) {
    const parsed = parseInt(item.order, 10);
    finalOrder = !isNaN(parsed) && parsed > 0 ? parsed : 99;
  }

  return {
    titleEn,
    titleTh,
    descEn,
    descTh,
    icon,
    alt,
    link,
    order: finalOrder,
    isPublished: false,
    content: {
      th: buildContent(item, true, features),
      en: buildContent(item, false, features)
    },
    features,
    caseStudyIds: [],
    metaTitleTh,
    metaTitleEn,
    metaDescriptionTh,
    metaDescriptionEn,
    metaImage: ''
  };
}

async function getNextSequentialOrder({
  fetchFn = globalThis.fetch,
  apiUrl = process.env.SYACO_API_URL || 'https://www.syaco.co.th/api/solutions'
} = {}) {
  try {
    const res = await fetchFn(apiUrl, {
      method: 'GET',
      signal: AbortSignal.timeout(8000)
    });
    if (res && res.ok) {
      const list = await res.json();
      if (Array.isArray(list) && list.length > 0) {
        const validOrders = list
          .map(s => parseInt(s.order, 10))
          .filter(o => !isNaN(o) && o > 0 && o < 90);
        return validOrders.length > 0 ? Math.max(...validOrders) + 1 : list.length + 1;
      }
      return 1;
    }
  } catch (err) {
    console.warn('[SolutionDraft] Failed to fetch current solutions for order calculation:', err.message);
  }
  return null;
}

async function approveAndCreateDraft({
  id,
  pool,
  fetchFn = globalThis.fetch,
  apiUrl = process.env.SYACO_API_URL || 'https://www.syaco.co.th/api/solutions',
  token = process.env.SYACO_API_TOKEN,
  reviewedBy = null
}) {
  const suggestionId = parseInt(id, 10);
  if (isNaN(suggestionId)) {
    return { success: false, code: 'INVALID_ID', message: 'ID ไม่ถูกต้อง' };
  }

  // 1. Atomic lock: update status to 'publishing' only if pending_review or failed
  let lockRes;
  try {
    lockRes = await pool.query(
      `UPDATE solution_suggestions
       SET status = 'publishing', reviewed_at = NOW(), reviewed_by = COALESCE($2, reviewed_by), error_message = NULL
       WHERE id = $1 AND status IN ('pending_review', 'failed')
       RETURNING *;`,
      [suggestionId, reviewedBy]
    );
  } catch (dbErr) {
    return { success: false, code: 'DB_ERROR', message: `Database error: ${dbErr.message}` };
  }

  if (!lockRes.rows || lockRes.rows.length === 0) {
    const checkRes = await pool.query(
      'SELECT id, status, published_solution_id FROM solution_suggestions WHERE id = $1;',
      [suggestionId]
    ).catch(() => ({ rows: [] }));

    if (checkRes.rows.length === 0) {
      return { success: false, code: 'NOT_FOUND', message: `ไม่พบข้อมูลไอเดียโซลูชัน ID: #${suggestionId}` };
    }
    const current = checkRes.rows[0];
    return {
      success: false,
      code: 'ALREADY_PROCESSED',
      message: `ไอเดียนี้มีสถานะเป็น '${current.status}' แล้ว (Solution ID: ${current.published_solution_id || '-'})`
    };
  }

  const item = lockRes.rows[0];

  // 2. Determine next sequential order from existing solutions
  const nextOrder = await getNextSequentialOrder({ fetchFn, apiUrl, token });

  // 3. Build SyaCo draft payload
  const payload = buildSyacoPayload(item, nextOrder);

  // 3. Call SyaCo Solutions API
  try {
    const response = await fetchFn(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000)
    });

    let resData = null;
    try {
      resData = await response.json();
    } catch {
      resData = null;
    }

    if (!response.ok || !resData || !resData.id) {
      let errMsg = '';
      if (resData?.errors && typeof resData.errors === 'object') {
        errMsg = Object.entries(resData.errors)
          .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
          .join('; ');
      } else {
        errMsg = (resData && (resData.message || resData.error))
          || `API HTTP error ${response.status}: ${response.statusText || 'Unknown error'}`;
      }

      await pool.query(
        "UPDATE solution_suggestions SET status = 'failed', error_message = $1 WHERE id = $2",
        [errMsg, item.id]
      ).catch(() => {});

      return {
        success: false,
        code: 'API_ERROR',
        error: errMsg,
        message: errMsg
      };
    }

    // 4. Update Postgres status to 'published_as_draft'
    await pool.query(
      `UPDATE solution_suggestions
       SET status = 'published_as_draft', published_solution_id = $1, published_at = NOW(), reviewed_by = COALESCE($3, reviewed_by), error_message = NULL
       WHERE id = $2;`,
      [String(resData.id), item.id, reviewedBy]
    );

    return {
      success: true,
      solutionId: resData.id,
      suggestionId: item.id,
      titleEn: item.title_en,
      titleTh: item.title_th
    };
  } catch (err) {
    const errMsg = err.message || 'Connection failed';
    await pool.query(
      "UPDATE solution_suggestions SET status = 'failed', error_message = $1 WHERE id = $2",
      [errMsg, item.id]
    ).catch(() => {});

    return {
      success: false,
      code: 'NETWORK_ERROR',
      error: errMsg,
      message: errMsg
    };
  }
}

module.exports = {
  slugify,
  normalizeIcon,
  buildContent,
  buildSyacoPayload,
  getNextSequentialOrder,
  approveAndCreateDraft
};
