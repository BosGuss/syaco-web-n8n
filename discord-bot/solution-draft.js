/**
 * SyaCo Solution Draft Publisher Module
 * Handles atomic locking in PostgreSQL, SyaCo payload generation, and publishing as draft.
 */

function buildContent(item, isTh) {
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

  return {
    hero: {
      titleLine1: isTh ? item.title_th : item.title_en,
      description: isTh ? item.description_th : item.description_en,
      backgroundImage: '/asset/image/bg/ai-hero-bg.webp'
    },
    solutions: {
      results: {
        title: titles.results,
        items: Array.isArray(langData.results) ? langData.results : []
      },
      problems: {
        title: titles.problems,
        items: Array.isArray(langData.problems) ? langData.problems : []
      },
      targetAudience: {
        title: titles.target,
        items: (Array.isArray(langData.targetAudience) ? langData.targetAudience : []).map((t, idx) => ({
          icon: `/asset/icons/target-${(idx % 4) + 1}.svg`,
          text: typeof t === 'string' ? t : (t?.text || '')
        }))
      }
    },
    examplesDeveloped: {
      title: titles.examples,
      items: []
    }
  };
}

function buildSyacoPayload(item) {
  let rawFeatures = item.features;
  if (typeof rawFeatures === 'string') {
    try {
      rawFeatures = JSON.parse(rawFeatures);
    } catch {
      rawFeatures = [];
    }
  }
  const featuresList = Array.isArray(rawFeatures) ? rawFeatures : [];
  const features = featuresList.map((f, i) => ({
    labelTh: f?.labelTh || f?.titleTh || (typeof f === 'string' ? f : ''),
    labelEn: f?.labelEn || f?.titleEn || (typeof f === 'string' ? f : ''),
    order: i + 1
  }));

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
    features: features,
    content: {
      th: buildContent(item, true),
      en: buildContent(item, false)
    }
  };
}

async function approveAndCreateDraft({
  id,
  pool,
  fetchFn = globalThis.fetch,
  apiUrl = process.env.SYACO_API_URL || 'https://www.syaco.co.th/api/solutions',
  token = process.env.SYACO_API_TOKEN || 'sya_perm_79279d93e026ed7638b9065af33c5b78bff1c5fdfd62e3ecbf12a707bcd97b71'
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
       SET status = 'publishing', reviewed_at = NOW(), error_message = NULL
       WHERE id = $1 AND status IN ('pending_review', 'failed')
       RETURNING *;`,
      [suggestionId]
    );
  } catch (dbErr) {
    return { success: false, code: 'DB_ERROR', message: `Database error: ${dbErr.message}` };
  }

  if (!lockRes.rows || lockRes.rows.length === 0) {
    // Check why it wasn't locked
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

  // 2. Build SyaCo draft payload
  const payload = buildSyacoPayload(item);

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
      const errMsg = (resData && (resData.message || resData.error))
        || `API HTTP error ${response.status}: ${response.statusText || 'Unknown error'}`;

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
       SET status = 'published_as_draft', published_solution_id = $1, published_at = NOW(), error_message = NULL
       WHERE id = $2;`,
      [String(resData.id), item.id]
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
  buildContent,
  buildSyacoPayload,
  approveAndCreateDraft
};
