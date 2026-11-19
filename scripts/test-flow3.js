const assert = require('assert');

// 1. Platform-Aware URL Normalization
function normalizeUrl(rawUrl, platform) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  try {
    if (typeof URL !== 'undefined') {
      const u = new URL(trimmed);
      if (platform === 'pantip' || u.hostname.includes('pantip.com')) {
        const m = u.pathname.match(/\/topic\/(\d+)/);
        return m ? 'https://pantip.com/topic/' + m[1] : u.origin + u.pathname;
      }
      if (platform === 'facebook' || platform === 'facebook_group' || u.hostname.includes('facebook.com')) {
        const keepParams = ['story_fbid', 'id', 'post_id'];
        const newParams = new URLSearchParams();
        keepParams.forEach(p => { if (u.searchParams.has(p)) newParams.set(p, u.searchParams.get(p)); });
        const qs = newParams.toString();
        return u.origin + u.pathname + (qs ? '?' + qs : '');
      }
      if (platform === 'linkedin' || u.hostname.includes('linkedin.com')) {
        return u.origin + u.pathname;
      }
      return u.origin + u.pathname;
    }
  } catch (_) {}

  if (platform === 'pantip' || trimmed.includes('pantip.com')) {
    const m = trimmed.match(/pantip\.com\/topic\/(\d+)/i);
    return m ? 'https://pantip.com/topic/' + m[1] : trimmed.split('?')[0];
  }
  if (platform === 'linkedin' || trimmed.includes('linkedin.com')) {
    return trimmed.split('?')[0].split('#')[0];
  }
  if (platform === 'facebook' || platform === 'facebook_group' || trimmed.includes('facebook.com')) {
    const base = trimmed.split('?')[0];
    const qs = trimmed.includes('?') ? trimmed.split('?')[1].split('#')[0] : '';
    const keep = ['story_fbid', 'id', 'post_id'];
    const kept = qs.split('&').filter(pair => keep.some(k => pair.startsWith(k + '=')));
    return base + (kept.length ? '?' + kept.join('&') : '');
  }
  return trimmed.split('?')[0].split('#')[0];
}

// Pantip URL normalizer
const p1 = normalizeUrl('https://pantip.com/topic/43012345?utm_source=facebook&utm_medium=share', 'pantip');
assert.strictEqual(p1, 'https://pantip.com/topic/43012345');

// Facebook Group URL normalizer (Must retain story_fbid/id)
const fb1 = normalizeUrl('https://www.facebook.com/groups/itprothailand/permalink/?story_fbid=987654321&id=123456789&ref=notif', 'facebook_group');
assert(fb1.includes('story_fbid=987654321'));
assert(fb1.includes('id=123456789'));
assert(!fb1.includes('ref=notif'));

// LinkedIn URL normalizer (Removes tracking query params, keeps canonical path)
const li1 = normalizeUrl('https://www.linkedin.com/posts/syaco-tech_cloud-data-pipeline-activity-7123456789012345678-abcd?utm_source=share&utm_medium=member_desktop', 'linkedin');
assert.strictEqual(li1, 'https://www.linkedin.com/posts/syaco-tech_cloud-data-pipeline-activity-7123456789012345678-abcd');

// 2. Solutions extraction test (flatMap across multiple n8n items)
const mockSolItems = [
  { json: { id: 7, titleTh: 'Solution A', titleEn: 'Sol A' } },
  { json: { id: 8, titleTh: 'Solution B', titleEn: 'Sol B' } },
  { json: { id: 9, titleTh: 'Solution C', titleEn: 'Sol C' } }
];
const rawSolutions = mockSolItems.flatMap(item => {
  const data = item.json;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return data ? [data] : [];
});
const solutions = rawSolutions.map(s => ({
  id: String(s.id),
  titleEn: s.titleEn || '',
  titleTh: s.titleTh || '',
  url: `https://www.syaco.co.th/solutions/${s.id}`
})).filter(s => s.id && (s.titleEn || s.titleTh));
assert.strictEqual(solutions.length, 3, 'Should extract all 3 solutions, not just first');

// 3. Gemini Response Sanitization & Parsing (Code Fences)
const rawGeminiWithFences = '```json\n{\n  "leadFit": "HIGH",\n  "canAnswer": true,\n  "matchScore": 0.85,\n  "matchedSolutionId": "8",\n  "answer": "Test answer",\n  "linkIncluded": true\n}\n```';
const cleaned = rawGeminiWithFences.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
const parsed = JSON.parse(cleaned);
assert.strictEqual(parsed.leadFit, 'HIGH');
assert.strictEqual(parsed.matchScore, 0.85);

// 4. Decision Filter Qualification Logic (Threshold 0.75)
function checkQualified(data) {
  let score = Number(data.matchScore || 0);
  if (score > 1) score = score / 100;
  return data.leadFit !== 'LOW' && data.canAnswer === true && score >= 0.75;
}

assert.strictEqual(checkQualified({ leadFit: 'HIGH', canAnswer: true, matchScore: 0.8 }), true);
assert.strictEqual(checkQualified({ leadFit: 'HIGH', canAnswer: true, matchScore: 0.75 }), true);
assert.strictEqual(checkQualified({ leadFit: 'HIGH', canAnswer: true, matchScore: 0.74 }), false);
assert.strictEqual(checkQualified({ leadFit: 'LOW', canAnswer: true, matchScore: 0.99 }), false);
assert.strictEqual(checkQualified({ leadFit: 'HIGH', canAnswer: false, matchScore: 0.99 }), false);

// 5. Quota Evaluation Logic (Unlimited by default: 999999, configurable via env)
function isQuotaExceeded(weeklyCount, envQuota) {
  const quotaLimit = envQuota ? parseInt(envQuota) : 999999;
  return parseInt(weeklyCount || 0) >= quotaLimit;
}

// Default (Unlimited)
assert.strictEqual(isQuotaExceeded(0), false);
assert.strictEqual(isQuotaExceeded(5), false);
assert.strictEqual(isQuotaExceeded(100), false);
// When quota is explicitly configured
assert.strictEqual(isQuotaExceeded(4, '5'), false);
assert.strictEqual(isQuotaExceeded(5, '5'), true);
assert.strictEqual(isQuotaExceeded(10, '5'), true);

// 6. Test Unified Shared Persona & Anti-Spam Rules in Flow 3
const { buildFlow3Prompt, SHARED_WRITING_AND_ANTI_SPAM_RULES } = require('../skills/shared_persona_rules');
const fs = require('fs');
const path = require('path');

const mockReq = {
  platform: 'pantip',
  post_url: 'https://pantip.com/topic/43012345',
  question_text: 'ต้องการเชื่อมต่อ PLC ในโรงงานเข้ากับระบบ SAP อัตโนมัติ ควรวาง Architecture อย่างไรดีครับ?'
};

const f3Prompt = buildFlow3Prompt(mockReq, [{ id: '31', titleEn: 'Secure AI Gateway', titleTh: 'ระบบ AI Gateway' }]);

assert(f3Prompt.includes('ZERO AI FOOTPRINT'), 'Flow 3 prompt must include ZERO AI FOOTPRINT rule');
assert(f3Prompt.includes('DO NOT REPEAT / ECHO CONTEXT'), 'Flow 3 prompt must instruct not to repeat context');
assert(f3Prompt.includes('REMOVE ROBOTIC BUZZWORDS & HYPE'), 'Flow 3 prompt must ban robotic buzzwords');
assert(f3Prompt.includes('WRITE LIKE A REAL ENGINEER'), 'Flow 3 prompt must instruct to write like real engineer');
assert(f3Prompt.includes('VALUE-FIRST'), 'Flow 3 prompt must include VALUE-FIRST rule');
assert(f3Prompt.includes('STRICT BACKLINK & DISCLOSURE RULES'), 'Flow 3 prompt must include backlink & disclosure rules');

// Verify workflow JSON node actually contains the shared rules
const wf3Path = path.join(__dirname, '../workflows/flow3-community-lead-assistant.json');
const wf3 = JSON.parse(fs.readFileSync(wf3Path, 'utf8'));
const f3PromptNode = wf3.nodes.find(n => n.name === 'Build Lead Qualification & Draft Prompt');
assert(f3PromptNode, 'Flow 3 must have Build Lead Qualification & Draft Prompt node');
assert(f3PromptNode.parameters.jsCode.includes('ZERO AI FOOTPRINT'), 'Flow 3 prompt node jsCode must include ZERO AI FOOTPRINT');
assert(f3PromptNode.parameters.jsCode.includes('REMOVE ROBOTIC BUZZWORDS & HYPE'), 'Flow 3 prompt node jsCode must include REMOVE ROBOTIC BUZZWORDS');
assert(f3PromptNode.parameters.jsCode.includes('WRITE LIKE A REAL ENGINEER'), 'Flow 3 prompt node jsCode must include WRITE LIKE A REAL ENGINEER');

console.log('✅ Flow 3 unified anti-spam & humanizer prompt tests passed successfully!');
console.log('✅ All Flow 3 test checks passed successfully!');
