/**
 * SyaCo Apply Shared Prompts Script
 * Applies the unified anti-spam, zero-AI-footprint, and humanizer rules
 * from skills/shared_persona_rules.js into workflows/flow2 and workflows/flow3.
 */

const fs = require('fs');
const path = require('path');

const FLOW2_PATH = path.join(__dirname, '../workflows/flow2-content-publisher.json');
const FLOW3_PATH = path.join(__dirname, '../workflows/flow3-community-lead-assistant.json');

const flow2JsCode = `const sol = $('Split In Batches').first().json;

// 1. Shared Anti-Spam, Humanizer & Zero AI Footprint Rules
const sharedRules = [
  '## Core Writing, Humanizer & Anti-Spam Rules (Zero AI Footprint):',
  '- ZERO AI FOOTPRINT: Never start with AI clichés (e.g. "Certainly!", "Great question!", "In today\\'s rapidly evolving digital era...", "It is worth noting that...", "สวัสดีครับชาว...", "ยินดีที่ได้ตอบคำถาม", "ในยุคดิจิทัลปัจจุบัน...").',
  '- DO NOT REPEAT / ECHO CONTEXT: Do not summarize or repeat the prompt or OP question back. Start sentence #1 immediately with the technical answer, core architecture concept, or practical hook.',
  '- REMOVE ROBOTIC BUZZWORDS & HYPE: Strictly ban marketing fluff and robotic transitions ("furthermore", "moreover", "by leveraging the power of", "in conclusion", "comprehensive and robust", "revolutionary", "game-changer", "seamless", "ultimate", "guaranteed"). Use direct, concrete engineering terms.',
  '- WRITE LIKE A REAL ENGINEER: Sound like an experienced senior engineer / technical practitioner sharing real-world insights. Use natural, conversational phrasing. Avoid overly rigid bulleted lists where every item has identical bold headings.',
  '- PRESERVE TECHNICAL ACCURACY & NO FABRICATION: Keep protocol names (PLC, Modbus, MQTT, OPC UA, REST, gRPC), API terminology, and architecture patterns accurate. Never fabricate quantitative metrics, fake statistics, imaginary client names, or fake customer testimonials.',
  '- VALUE-FIRST: The response/article must provide 100% standalone technical value and actionable insight even if all links are stripped.',
  '- STRICT BACKLINK & DISCLOSURE RULES:',
  '  * Value-First: Introduce the solution organically where it directly solves the engineering challenge.',
  '  * Maximum 1 link.',
  '  * Mandatory Disclosure: State affiliation or authorship transparently and naturally without sounding promotional.'
].join('\\n');

// 2. Platform Voice Guidelines for Flow 2
const voiceBluesky = 'Tone: Quick tech commentary / hook in Thai. Punchy, concise, strictly under 300 characters. Focus on one main idea with engaging hook for enterprise IT managers and developers.';
const voiceDevto = 'Tone: High-quality technical guide / architectural overview in Markdown for developers. Practical problem-solving, clean code/tech depth, no marketing fluff. 3 to 4 tags strictly alphanumeric [a-z0-9].';
const voiceManual = 'Tone: Professional enterprise long-form article in Thai for tech blogs and corporate knowledge bases. Clear business problem, technical solution, architectural benefits, engineering trade-offs, and next steps. 3 to 5 tags.';

// Prompt A: Bluesky (Micro <= 300 chars TH) + Dev.to (Technical Markdown for developers)
const promptA = [
  'You are a senior tech writer and engineer for SyaCo (enterprise software engineering firm).',
  'Create 2 content formats for the new enterprise solution described below.',
  '',
  'Solution Context:',
  \`Title: \${sol.titleTh} (\${sol.titleEn})\`,
  \`Description: \${sol.descTh}\`,
  \`URL: \${sol.url}\`,
  '',
  'Format 1: Bluesky Post (blueskyPost)',
  \`- Voice & Guidelines: \${voiceBluesky}\`,
  \`- MUST include the exact URL: \${sol.url}\`,
  '',
  'Format 2: Dev.to Article (devtoArticle)',
  \`- Voice & Guidelines: \${voiceDevto}\`,
  '- Title in Thai or bilingual.',
  \`- Include practical problem solving and introduce the SyaCo solution with natural backlink: \${sol.url}\`,
  '- Tags: 3 to 4 tags strictly alphanumeric [a-z0-9] (e.g. devops, automation, architecture, webdev).',
  '',
  sharedRules,
  '',
  'Return valid JSON only matching the schema.'
].join('\\n');

const geminiBodyA = {
  contents: [{ parts: [{ text: promptA }] }],
  generationConfig: {
    temperature: 0.7,
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        blueskyPost: { type: 'STRING' },
        devtoArticle: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            bodyMarkdown: { type: 'STRING' },
            tags: { type: 'ARRAY', items: { type: 'STRING' } }
          },
          required: ['title', 'bodyMarkdown', 'tags']
        }
      },
      required: ['blueskyPost', 'devtoArticle']
    }
  }
};

// Prompt B: Manual Enterprise Long-form Article
const promptB = [
  'You are a senior tech evangelist and enterprise architect for SyaCo.',
  'Create a comprehensive long-form technical and business article in Thai for this new enterprise solution:',
  '',
  'Solution Context:',
  \`Title: \${sol.titleTh} (\${sol.titleEn})\`,
  \`Description: \${sol.descTh}\`,
  \`URL: \${sol.url}\`,
  '',
  'Format: Manual Long-form Article (manualArticle)',
  \`- Voice & Guidelines: \${voiceManual}\`,
  \`- Includes link: \${sol.url}\`,
  '- Tags: 3 to 5 tags in Thai or English.',
  '',
  sharedRules,
  '',
  'Return valid JSON only matching the schema.'
].join('\\n');

const geminiBodyB = {
  contents: [{ parts: [{ text: promptB }] }],
  generationConfig: {
    temperature: 0.7,
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        manualArticle: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            bodyMarkdown: { type: 'STRING' },
            tags: { type: 'ARRAY', items: { type: 'STRING' } }
          },
          required: ['title', 'bodyMarkdown', 'tags']
        }
      },
      required: ['manualArticle']
    }
  }
};

return [{\\n  json: {\\n    solution: sol,\\n    geminiBodyA,\\n    geminiBodyB\\n  }\\n}];`;

const flow3JsCode = `const req = $('Platform-Aware Normalize Post URL').first().json;

// 1. Fetch all published solutions from SyaCo catalog
const solItems = $('Get Published Solutions').all();
const rawSolutions = solItems.flatMap(item => {
  const data = item.json;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  return data ? [data] : [];
});

const solutions = rawSolutions.map(s => ({
  id: String(s.id),
  titleEn: s.titleEn || '',
  titleTh: s.titleTh || '',
  descEn: s.content?.en?.hero?.description || s.descEn || '',
  descTh: s.content?.th?.hero?.description || s.descTh || '',
  url: s.url || \`https://www.syaco.co.th\${s.link || \`/solutions/\${s.id}\`}\`
})).filter(s => s.id && (s.titleEn || s.titleTh));

// 2. Shared Platform Voice Guidelines
const voiceGuidelines = {
  pantip: 'Tone: Polite, friendly Thai senior engineer peer. Start directly with a practical solution or architecture concept. No sales pitch. 2-3 short conversational paragraphs.',
  linkedin: 'Tone: Professional, B2B thought-leadership, insightful enterprise engineering perspective. Clear problem-solving, addressing business value, scalability, and technical reliability.',
  facebook: 'Tone: Direct troubleshooting, practical advice, conversational and helpful peer-to-peer.',
  facebook_group: 'Tone: Direct troubleshooting, practical advice, conversational and helpful peer-to-peer.'
};

// 3. Shared Anti-Spam, Humanizer & Zero AI Footprint Rules
const sharedRules = [
  '## Core Writing, Humanizer & Anti-Spam Rules (Zero AI Footprint):',
  '- ZERO AI FOOTPRINT: Never start with AI clichés (e.g. "Certainly!", "Great question!", "In today\\'s rapidly evolving digital era...", "It is worth noting that...", "สวัสดีครับชาว...", "ยินดีที่ได้ตอบคำถาม", "ในยุคดิจิทัลปัจจุบัน...").',
  '- DO NOT REPEAT / ECHO CONTEXT: Do not summarize or repeat the prompt or OP question back. Start sentence #1 immediately with the technical answer, core architecture concept, or practical hook.',
  '- REMOVE ROBOTIC BUZZWORDS & HYPE: Strictly ban marketing fluff and robotic transitions ("furthermore", "moreover", "by leveraging the power of", "in conclusion", "comprehensive and robust", "revolutionary", "game-changer", "seamless", "ultimate", "guaranteed"). Use direct, concrete engineering terms.',
  '- WRITE LIKE A REAL ENGINEER: Sound like an experienced senior engineer / technical practitioner sharing real-world insights. Use natural, conversational phrasing. Avoid overly rigid bulleted lists where every item has identical bold headings.',
  '- PRESERVE TECHNICAL ACCURACY & NO FABRICATION: Keep protocol names (PLC, Modbus, MQTT, OPC UA, REST, gRPC), API terminology, and architecture patterns accurate. Never fabricate quantitative metrics, fake statistics, imaginary client names, or fake customer testimonials.',
  '- VALUE-FIRST: The response/article must provide 100% standalone technical value and actionable insight even if all links are stripped.',
  '- STRICT BACKLINK & DISCLOSURE RULES:',
  '  * Include a SyaCo solution URL ONLY if leadFit is HIGH/MEDIUM and the solution directly helps solve their problem. Otherwise set linkIncluded = false and suggestedAnchor = "".',
  '  * Maximum 1 link.',
  '  * Mandatory Disclosure: If a link is included, include a transparent, polite disclosure in Thai (e.g. "Disclosure: ผมมาจากทีม SyaCo ผู้พัฒนาระบบนี้โดยตรงครับ").'
].join('\\n');

// 4. Prompt Construction
const prompt = [
  'You are an Enterprise Lead Qualification and Technical Advisory AI for SyaCo (https://www.syaco.co.th).',
  '',
  '## Task:',
  '1. Evaluate whether the user question represents a genuine Enterprise/B2B need (leadFit: HIGH / MEDIUM / LOW).',
  '   - HIGH: Enterprise/B2B/Factory/Industrial systems (e.g. PLC, SAP, ERP, SCADA, Cloud Migration, API Gateway, Data Pipeline).',
  '   - MEDIUM: SMB or General Technical Problem.',
  '   - LOW: Student homework, gaming, hobbyist, or non-commercial inquiry.',
  '2. Determine whether SyaCo has relevant expertise to answer this question concretely (canAnswer: boolean).',
  '3. Identify the best matching SyaCo solution from the catalog (matchedSolutionId), if one genuinely fits.',
  '4. Draft a high-value, practical technical response tailored to the platform in natural Thai.',
  '',
  \`## Platform: \${req.platform}\`,
  \`Voice Guidelines: \${voiceGuidelines[req.platform] || voiceGuidelines.pantip}\`,
  '',
  '## Target Thread Content:',
  \`URL: \${req.post_url}\`,
  \`Question: \${req.question_text}\`,
  '',
  '## SyaCo Published Solutions Catalog:',
  JSON.stringify(solutions, null, 2),
  '',
  sharedRules,
  '',
  'Return valid JSON only matching the schema.'
].join('\\n');

const geminiBody = {
  contents: [{ parts: [{ text: prompt }] }],
  generationConfig: {
    temperature: 0.6,
    responseMimeType: 'application/json',
    responseSchema: {
      type: 'OBJECT',
      properties: {
        leadFit: { type: 'STRING', enum: ['HIGH', 'MEDIUM', 'LOW'] },
        canAnswer: { type: 'BOOLEAN' },
        matchedSolutionId: { type: 'STRING' },
        matchScore: { type: 'NUMBER' },
        relevanceReason: { type: 'STRING' },
        matchedProblem: { type: 'STRING' },
        answer: { type: 'STRING' },
        linkIncluded: { type: 'BOOLEAN' },
        linkReason: { type: 'STRING' },
        suggestedAnchor: { type: 'STRING' }
      },
      required: ['leadFit', 'canAnswer', 'matchScore', 'relevanceReason', 'matchedProblem', 'answer', 'linkIncluded', 'suggestedAnchor']
    }
  }
};

return [{\\n  json: {\\n    req,\\n    solutions,\\n    geminiBody\\n  }\\n}];`;

function applyFlow2() {
  const data = JSON.parse(fs.readFileSync(FLOW2_PATH, 'utf8'));
  const node = data.nodes.find(n => n.name === 'Build AI Prompts for Call A & B');
  if (!node) throw new Error('Flow 2 prompt node not found');
  node.parameters.jsCode = flow2JsCode;
  fs.writeFileSync(FLOW2_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('✓ Successfully updated Flow 2 prompt node.');
}

function applyFlow3() {
  const data = JSON.parse(fs.readFileSync(FLOW3_PATH, 'utf8'));
  const node = data.nodes.find(n => n.name === 'Build Lead Qualification & Draft Prompt');
  if (!node) throw new Error('Flow 3 prompt node not found');
  node.parameters.jsCode = flow3JsCode;
  fs.writeFileSync(FLOW3_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('✓ Successfully updated Flow 3 prompt node.');
}

applyFlow2();
applyFlow3();
