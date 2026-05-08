const express = require('express');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const GROQ_BASE = 'https://api.groq.com/openai/v1';

// Model fallback chain — all with high separate TPD limits
const MODEL_CHAIN = [
  'llama-3.3-70b-versatile', // Smarter, handles negative constraints better
  'llama-3.1-8b-instant',
  'llama3-8b-8192',
  'mixtral-8x7b-32768',
  'gemma2-9b-it',
];

async function groqChat(messages, opts = {}) {
  const models = opts.models || MODEL_CHAIN;
  let lastError;

  for (const model of models) {
    try {
      const res = await fetch(`${GROQ_BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: opts.temperature ?? 0.3,
          max_tokens: opts.max_tokens ?? 1200
        })
      });

      const data = await res.json();

      // Skip to next model on ANY rate limit or server error
      if (res.status === 429 || res.status === 503 || res.status === 500) {
        console.warn(`⚠ ${model} returned ${res.status}, trying next...`);
        lastError = new Error(data.error?.message || `${model} unavailable`);
        continue;
      }

      // Skip on model-not-found or deactivated
      if (res.status === 401 || res.status === 403) {
        console.error(`❌ ${model} auth error (${res.status}): ${data.error?.message}`);
        throw new Error(`GROQ API key invalid or unauthorized. Check GROQ_API_KEY in .env`);
      }

      if (res.status === 404 || res.status === 400) {
        console.warn(`⚠ ${model} not available (${res.status}), trying next...`);
        lastError = new Error(`${model} not available`);
        continue;
      }

      if (!res.ok) {
        console.warn(`⚠ ${model} error ${res.status}, trying next...`);
        lastError = new Error(data.error?.message || 'API error');
        continue;
      }

      console.log(`✓ Used model: ${model}`);
      return data.choices[0].message.content;
    } catch (err) {
      console.warn(`⚠ ${model} threw: ${err.message}, trying next...`);
      lastError = err;
      continue;
    }
  }
  throw new Error('API rate limit reached across all models. Please wait 1-2 minutes and try again, or add a fresh GROQ_API_KEY in .env');
}

// ── ROBUST JSON PARSER ───────────────────────────────────────────────────────
// Strategy 1: Direct parse after extracting the outermost { } block
// Strategy 2: Fix unescaped control characters inside JSON strings
// Strategy 3: Remove trailing commas before } or ]
// Strategy 4: Truncate at last valid closing brace (handles cut-off responses)
// Strategy 5: Strip all non-ASCII / non-printable chars then retry
function parseJSON(text) {
  if (!text || typeof text !== 'string') throw new Error('Empty response from AI model');

  // Pull out the first {...} block, even if there is surrounding prose
  const blockMatch = text.match(/\{[\s\S]*\}/);
  const raw = blockMatch ? blockMatch[0] : text;

  const attempts = [
    // S1 – as-is
    () => raw,

    // S2 – fix control chars inside strings without touching structural whitespace
    () => {
      let depth = 0, inStr = false, escape = false, out = '';
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (escape) { out += ch; escape = false; continue; }
        if (ch === '\\') { escape = true; out += ch; continue; }
        if (ch === '"') inStr = !inStr;
        if (inStr && ch === '\n') { out += '\\n'; continue; }
        if (inStr && ch === '\r') { out += '\\r'; continue; }
        if (inStr && ch === '\t') { out += '\\t'; continue; }
        if (inStr && ch.charCodeAt(0) < 0x20) continue; // drop other control chars
        if (!inStr) { if (ch === '{' || ch === '[') depth++; if (ch === '}' || ch === ']') depth--; }
        out += ch;
      }
      return out;
    },

    // S3 – remove trailing commas before ] or }
    () => raw.replace(/,\s*([}\]])/g, '$1'),

    // S4 – combine S2 + S3
    () => {
      let depth = 0, inStr = false, escape = false, out = '';
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (escape) { out += ch; escape = false; continue; }
        if (ch === '\\') { escape = true; out += ch; continue; }
        if (ch === '"') inStr = !inStr;
        if (inStr && ch === '\n') { out += '\\n'; continue; }
        if (inStr && ch === '\r') { out += '\\r'; continue; }
        if (inStr && ch === '\t') { out += '\\t'; continue; }
        if (inStr && ch.charCodeAt(0) < 0x20) continue;
        if (!inStr) { if (ch === '{' || ch === '[') depth++; if (ch === '}' || ch === ']') depth--; }
        out += ch;
      }
      return out.replace(/,\s*([}\]])/g, '$1');
    },

    // S5 – truncate at last closing brace (handles cut-off max_tokens)
    () => {
      const last = raw.lastIndexOf('}');
      return last !== -1 ? raw.substring(0, last + 1) : raw;
    },

    // S6 – strip non-ASCII + control chars then retry
    () => raw
      .replace(/[^\x20-\x7E\n\r\t]/g, '')
      .replace(/,\s*([}\]])/g, '$1'),
  ];

  for (let i = 0; i < attempts.length; i++) {
    try {
      const candidate = attempts[i]();
      const parsed = JSON.parse(candidate);
      if (i > 0) console.warn(`⚠ JSON parsed with strategy S${i + 1}`);
      return parsed;
    } catch (_) { /* try next strategy */ }
  }

  console.error('❌ All JSON repair strategies failed. Raw response:\n', text.substring(0, 500));
  throw new Error('AI response was malformed. Please try again.');
}

// ── JSON-AWARE GROQ CALLER WITH AUTO-RETRY ────────────────────────────────────
// Calls groqChat, tries to parse JSON; if it fails, retries once with a stricter
// "return ONLY raw JSON, no prose, no markdown" reminder injected.
async function groqChatJSON(messages, opts = {}, requiredKeys = []) {
  const tryParse = async (msgs) => {
    const raw = await groqChat(msgs, opts);
    const parsed = parseJSON(raw);

    // Validate required top-level keys are present
    if (requiredKeys.length) {
      const missing = requiredKeys.filter(k => !(k in parsed));
      if (missing.length) throw new Error(`Response missing keys: ${missing.join(', ')}`);
    }
    return parsed;
  };

  try {
    return await tryParse(messages);
  } catch (firstErr) {
    console.warn(`⚠ First JSON parse failed (${firstErr.message}). Retrying with stricter prompt…`);

    // Inject a stern reminder while preserving full message context
    const reminderMessages = [
      ...messages.slice(0, -1),
      {
        role: 'user',
        content: messages[messages.length - 1].content +
          '\n\nCRITICAL: Your previous response failed JSON validation. ' +
          'Return ONLY a raw JSON object. No markdown fences, no prose, no explanation. ' +
          'Start your response with { and end with }.'
      }
    ];

    try {
      return await tryParse(reminderMessages);
    } catch (secondErr) {
      console.error(`❌ Retry also failed: ${secondErr.message}`);
      throw secondErr;
    }
  }
}

// ── REAL JOB FETCHING (Remotive API — free, no auth) ─────
async function fetchRemotiveJobs(roles, domain) {
  const query = (roles || [])[0] || domain || 'software engineer';
  try {
    const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=30`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.jobs || []).slice(0, 20);
  } catch (e) {
    console.warn('⚠ Remotive API unavailable:', e.message);
    return [];
  }
}

function hashColor(str) {
  let h = 0;
  for (const c of (str || '')) h = c.charCodeAt(0) + ((h << 5) - h);
  return `hsl(${Math.abs(h) % 360}, 55%, 38%)`;
}

// ── RESUME ANALYSIS ──────────────────────────────────────
app.post('/analyze', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const pdfData = await pdfParse(req.file.buffer);
    const resumeText = pdfData.text;

    if (!resumeText || resumeText.length < 100)
      return res.status(400).json({ error: 'Could not extract text from PDF.' });

    const analysis = await groqChatJSON([{
      role: 'user',
      content: `You are an expert technical recruiter and career coach. Analyze this resume carefully.

Return ONLY a raw JSON object — no markdown, no prose, no backticks. Start with { and end with }.

Required structure:
{"suggested_roles":[{"title":"Role Name","match_percent":85,"reason":"Specific reason based on resume"},{"title":"Role Name","match_percent":78,"reason":"Specific reason"},{"title":"Role Name","match_percent":65,"reason":"Specific reason"}],"strengths":["strength 1","strength 2","strength 3","strength 4"],"weaknesses":["gap 1","gap 2","gap 3"],"skill_breakdown":{"technical":["skill1","skill2","skill3","skill4"],"soft":["skill1","skill2","skill3"],"missing_for_top_role":["skill1","skill2","skill3"]},"summary":"2-sentence candidate summary","seniority":"Junior","domain":"Backend","years_experience":2,"education_level":"Bachelor's"}

Seniority must be one of: Junior, Mid, Senior, Staff, Principal
Domain must be one of: Backend, Frontend, Full-Stack, Data Science, ML/AI, DevOps, QA, Product, Embedded, Mobile

Resume:
${resumeText.substring(0, 3000)}`
    }], { temperature: 0.2, max_tokens: 900 }, ['suggested_roles', 'strengths', 'seniority']);
    res.json({ success: true, analysis, resumeText: resumeText.substring(0, 3000) });
  } catch (err) {
    console.error('Analyze error:', err.message);
    res.status(500).json({ error: 'Analysis failed: ' + err.message });
  }
});

// ── JOB RECOMMENDATIONS ───────────────────────────────────
app.post('/job-recommendations', async (req, res) => {
  try {
    const { roles, skills, seniority, domain, years_experience } = req.body;

    // Step 1: Fetch real live job postings from Remotive (free API)
    const realJobs = await fetchRemotiveJobs(roles, domain);
    console.log(`✓ Remotive returned ${realJobs.length} live jobs`);

    if (realJobs.length >= 3) {
      // Step 2: Have LLM rank & annotate real jobs against the candidate profile
      const jobsList = realJobs.slice(0, 15).map((j, i) =>
        `JOB_${i + 1}: "${j.title}" at ${j.company_name} | Tags: ${(j.tags || []).slice(0, 5).join(', ')}`
      ).join('\n');

      const ranked = await groqChatJSON([{
        role: 'user',
        content: `You are a career coach. Match this candidate to real job listings.\nCandidate: ${seniority || 'Mid'} ${domain || 'Backend'} | Roles: ${(roles || []).slice(0, 2).join(', ')} | Skills: ${(skills || []).slice(0, 7).join(', ')} | ${years_experience || 2} yrs exp\n\nListings:\n${jobsList}\n\nPick the 6 best-fitting jobs. For each: job_number (integer), match_score (60-95), why_it_fits (1 sentence), required_skills (3 items), missing_skills (1-2 items).\nReturn ONLY raw JSON — no markdown, no prose. Start with { end with }:\n{"selected":[{"job_number":1,"match_score":87,"why_it_fits":"...","required_skills":["s1","s2","s3"],"missing_skills":["s1"]}]}`
      }], { temperature: 0.3, max_tokens: 900 }, ['selected']);
      const jobs = (ranked.selected || []).map(s => {
        const r = realJobs[s.job_number - 1];
        if (!r) return null;
        const daysAgo = r.publication_date
          ? Math.max(1, Math.floor((Date.now() - new Date(r.publication_date).getTime()) / 86400000))
          : Math.floor(Math.random() * 14) + 1;
        return {
          id: s.job_number,
          title: r.title,
          company: r.company_name,
          company_logo_color: hashColor(r.company_name),
          location: r.candidate_required_location || 'Remote',
          salary_range: r.salary || 'Competitive',
          match_score: s.match_score,
          why_it_fits: s.why_it_fits,
          required_skills: s.required_skills || [],
          missing_skills: s.missing_skills || [],
          job_type: r.job_type || 'Full-time',
          experience_required: `${years_experience || 2}+ years`,
          posted_days_ago: daysAgo,
          apply_url: r.url,
          is_real: true
        };
      }).filter(Boolean).sort((a, b) => b.match_score - a.match_score);

      if (jobs.length >= 3) {
        return res.json({ success: true, jobs, source: 'live' });
      }
    }

    // Step 3: Fallback — AI-generated jobs if Remotive is unavailable
    console.log('⚠ Falling back to AI-generated job recommendations');
    const result = await groqChatJSON([{
      role: 'user',
      content: `Generate 6 realistic job recommendations as JSON for a ${seniority || 'Mid'} ${domain || 'Backend'} candidate.\nSkills: ${(skills || []).slice(0, 6).join(', ')}. Target roles: ${(roles || []).slice(0, 2).join(', ')}.\nReturn ONLY raw JSON — no markdown, no prose. Start with { end with }:\n{"jobs":[{"id":1,"title":"","company":"","company_logo_color":"#4f46e5","location":"Remote","salary_range":"$X-$Y","match_score":85,"why_it_fits":"1 sentence","required_skills":["s1","s2"],"missing_skills":["s1"],"job_type":"Full-time","experience_required":"2-4 years","posted_days_ago":3,"apply_url":"https://linkedin.com/jobs","is_real":false}]}\nRules: real companies, sort by match_score desc, scores 60-95.`
    }], { temperature: 0.5, max_tokens: 1200 }, ['jobs']);
    res.json({ success: true, jobs: result.jobs || [], source: 'ai' });
  } catch (err) {
    console.error('Job recommendations error:', err.message);
    res.status(500).json({ error: 'Job recommendations failed: ' + err.message });
  }
});

// ── QUESTION GENERATION ───────────────────────────────────
app.post('/generate-question', async (req, res) => {
  try {
    const { role, previousScore, pastQuestions, weaknesses, questionType, questionNum, totalQuestions, interviewPhase, consecutiveLowScores } = req.body;

    const phaseGuide = {
      'warmup': 'WARM-UP phase: ask a straightforward, confidence-building question. Keep difficulty low-to-medium.',
      'core': 'CORE phase: ask a moderately challenging question testing solid understanding of core concepts.',
      'deepdive': 'DEEP-DIVE phase: ask a hard question — system design, edge cases, architecture trade-offs, or advanced concepts.'
    }[interviewPhase || 'core'] || '';

    let difficultyGuide = phaseGuide;
    if ((consecutiveLowScores || 0) >= 2) {
      difficultyGuide = 'The candidate has struggled 2+ times in a row. Ask a much simpler foundational question to rebuild confidence before increasing difficulty again.';
    } else if (previousScore !== null && previousScore !== undefined) {
      if (previousScore < 4) difficultyGuide += ' Last answer was weak — lean toward an easier follow-up.';
      else if (previousScore >= 8) difficultyGuide += ' Excellent last answer — escalate difficulty.';
    }

    const typeGuide = {
      'technical': 'Focus on core technical concepts, implementation details, or debugging scenarios.',
      'behavioral': 'Ask a behavioral/situational question using STAR format. Start with "Tell me about a time..."',
      'system_design': 'Ask a system design question ("Design a system that...", "How would you architect...")',
      'coding': 'Ask about algorithmic thinking, data structures, or code reasoning (no actual code required, just approach).'
    }[questionType] || 'Ask a relevant technical question.';

    const content = await groqChat([{
      role: 'user',
      content: `You are a senior technical interviewer at a top tech company interviewing for: ${role}
This is question ${questionNum || 1} of ${totalQuestions || 5}.

${difficultyGuide}
${typeGuide}

Known candidate weaknesses to occasionally probe: ${(weaknesses || []).join(', ')}

Previously asked questions — DO NOT repeat any of these:
${(pastQuestions || []).map((q, i) => `${i + 1}. ${q}`).join('\n')}

Respond ONLY with the interview question. No prefixes, quotes, or formatting. The question should be specific, clear, interview-appropriate, and answerable within 500 words.`
    }], { temperature: 0.75, max_tokens: 350 });

    res.json({ success: true, question: content.trim() });
  } catch (err) {
    console.error('Question error:', err.message);
    res.status(500).json({ error: 'Question generation failed: ' + err.message });
  }
});

// ── ANSWER EVALUATION ─────────────────────────────────────
app.post('/evaluate-answer', async (req, res) => {
  try {
    const { question, answer, role, questionType } = req.body;

    // ── PRE-FLIGHT NONSENSE FILTER ──
    const fillerWords = ['um', 'uh', 'like', 'you know', 'basically', 'literally', 'sort of', 'kind of', 'i mean', 'actually', 'right', 'okay so', 'well', 'i think'];
    
    let processedAns = (answer || "")
      .toLowerCase()
      .trim()
      .replace(/[.,!?;]/g, '');
    
    // Strip fillers for the pre-flight check
    fillerWords.forEach(w => {
      const reg = new RegExp(`\\b${w}\\b`, 'gi');
      processedAns = processedAns.replace(reg, '');
    });
    
    const lowerAns = processedAns.replace(/\s+/g, ' ').trim();

    const fluffRegex =
      /^(abc|123|xyz|qwer|asdf|hi|hello|hey|test|testing|no idea|dont know|i dont know|idk|interesting|cool|wow|ok|okay|nice)$/i;

    const irrelevantPhrases = [
      'what is your name',
      'how are you',
      'good morning',
      'good evening',
      'who are you',
      'nice to meet you',
      'thank you',
      'bye',
      'interesting question',
      'great question',
      'good question',
      'let me think',
      'i am not sure'
    ];

    const meaninglessPattern =
      /^[0-9\s]+$|^[a-z]{1,4}$|^(.)\1+$/i;

    const isIrrelevantPhrase =
      irrelevantPhrases.some(p => lowerAns.includes(p));

    const wordCount =
      lowerAns.split(/\s+/).filter(Boolean).length;

    if (
      lowerAns.length < 3 ||
      wordCount < 1 ||
      fluffRegex.test(lowerAns) ||
      meaninglessPattern.test(lowerAns) ||
      isIrrelevantPhrase
    ) {
      console.log(`🚫 Pre-flight Filter: Blocking nonsense answer ('${answer}')`);
      return res.json({
        success: true,
        evaluation: {
          score: 1,
          feedback: "The response provided contains no technical substance or is irrelevant to the technical question asked. In a professional interview, this would be graded as a failure to answer.",
          ideal_answer: "A complete answer should have addressed the core requirements: " + question,
          keywords_hit: [],
          keywords_missed: ["(Candidate provided no technical content)"],
          depth_level: "None",
          confidence_from_answer: "Low"
        }
      });
    }

    // Enforce 500-word limit on the answer before sending to LLM
    const answerWords = (answer || '').trim().split(/\s+/).filter(Boolean);
    const trimmedAnswer = answerWords.length > 500 ? answerWords.slice(0, 500).join(' ') + ' [truncated to 500 words]' : answer;

    const evaluation = await groqChatJSON([{
      role: 'user',
      content: `You are a BRUTALLY HONEST and ELITE Senior Technical Interviewer. 
Your goal is to ensure only candidates with actual technical depth pass.

QUESTION: ${question}
CANDIDATE ANSWER: "${trimmedAnswer}"
QUESTION TYPE: ${questionType || 'technical'}

SCORING PHILOSOPHY:
1. CONTEXTUAL RELEVANCE IS EVERYTHING: If the candidate gives a generic "good question" or "i'll think about it" or talks about a different topic, the score MUST be 1/10.
2. NO HALLUCINATIONS: Do not assume the candidate knows more than they wrote. If they don't explain HOW or WHY, they don't get points.
3. IDEAL COMPARISON: Mentally construct the perfect technical answer. If the candidate's answer is less than 20% of the ideal answer's technical density, score 1-2/10.
4. GREETINGS/FLUFF: If the answer contains greetings or fluff and NO technical content, score 1/10.

SCORING RUBRIC:
- 1: Irrelevant, fluff, greetings, "idk", or totally off-topic.
- 2-3: Extremely shallow. Mentions 1-2 keywords but shows zero understanding of implementation.
- 4-5: Mediocre. Mentions correct concepts but lacks clarity or depth.
- 6-7: Good. Correct technical explanation with minor omissions.
- 8-10: Expert. Deep, nuanced, architecture-aware, and handles edge cases.

Return ONLY raw JSON — no markdown, no prose. Start with { end with }:
{"score":1,"feedback":"Strict technical assessment","ideal_answer":"What a perfect answer looks like","keywords_hit":["keyword1"],"keywords_missed":["concept1"],"depth_level":"None","confidence_from_answer":"Low"}

depth_level must be one of: None, Surface, Moderate, Deep, Expert
confidence_from_answer must be one of: Low, Medium, High`
    }], { temperature: 0, max_tokens: 1500 }, ['score', 'feedback', 'ideal_answer']);
    res.json({ success: true, evaluation });
  } catch (err) {
    console.error('Evaluate error:', err.message);
    res.status(500).json({ error: 'Evaluation failed: ' + err.message });
  }
});

// ── COMMUNICATION ANALYSIS ────────────────────────────────
app.post('/analyze-communication', async (req, res) => {
  try {
    const { transcript, answer_text, duration_seconds, filler_count, word_count, pitch_variation, hesitation_count } = req.body;

    const rawText = transcript || answer_text || '';
    const textWords = rawText.trim().split(/\s+/).filter(Boolean);
    const text = textWords.length > 500 ? textWords.slice(0, 500).join(' ') : rawText;

    if (!text || text.trim().length < 10) {
      return res.json({
        success: true,
        analysis: {
          confidence_score: 5,
          clarity_score: 5,
          communication_feedback: 'No audio transcript available. Score based on text answer.',
          strengths: [],
          improvements: ['Enable microphone for audio analysis'],
          overall_communication: 'N/A'
        }
      });
    }

    const wpm = duration_seconds > 0 ? Math.round((word_count / duration_seconds) * 60) : 0;
    const paceLabel = wpm === 0 ? 'Unknown' : wpm < 100 ? 'Too slow' : wpm > 175 ? 'Too fast' : 'Good pace';
    const pitchNote = pitch_variation != null ? `Pitch variation(Hz std dev): ${ pitch_variation.toFixed(1) } — ${ pitch_variation > 40 ? 'expressive' : pitch_variation > 15 ? 'moderate' : 'monotone' } ` : '';
    const hesNote = hesitation_count != null ? `Hesitation pauses detected: ${ hesitation_count } ` : '';

    const llmResult = await groqChatJSON([{
      role: 'user',
      content: `Analyze this interview answer transcript for communication quality, clarity, and confidence.

Transcript: "${text}"
Filler words detected: ${filler_count || 0}
Speaking pace: ${wpm > 0 ? wpm + ' WPM (' + paceLabel + ')' : 'unknown'}
Answer length: ${word_count || 0} words
${pitchNote}
${hesNote}

Return ONLY raw JSON — no markdown, no prose. Start with { end with }:
{"confidence_score":7,"clarity_score":6,"communication_feedback":"2-3 specific actionable observations","strengths":["strength 1","strength 2"],"improvements":["improvement 1","improvement 2"],"overall_communication":"Good"}

overall_communication must be one of: Poor, Fair, Good, Excellent`
    }], { temperature: 0.3, max_tokens: 600 }, ['confidence_score', 'clarity_score']);
    res.json({
      success: true,
      analysis: {
        ...llmResult,
        filler_count: filler_count || 0,
        words_per_minute: wpm,
        pace: paceLabel,
        word_count: word_count || 0
      }
    });
  } catch (err) {
    console.error('Communication analysis error:', err.message);
    res.status(500).json({ error: 'Communication analysis failed: ' + err.message });
  }
});

// ── FINAL REPORT ─────────────────────────────────────────
app.post('/generate-report', async (req, res) => {
  try {
    const { role, questionHistory, avgTechnical, avgCommunication, avgVisual, weaknesses, seniority } = req.body;

    const overallAvg = [avgTechnical, avgCommunication, avgVisual]
      .filter(s => s !== null && s !== undefined)
      .reduce((a, b, _, arr) => a + b / arr.length, 0);

    const report = await groqChatJSON([{
      role: 'user',
      content: `Generate a comprehensive post-interview coaching report for a ${seniority || 'Mid'} ${role} candidate.

Performance Summary:
- Technical Score: ${avgTechnical?.toFixed(1) || 'N/A'}/10
- Communication Score: ${avgCommunication?.toFixed(1) || 'N/A'}/10
- Confidence / Visual Score: ${avgVisual?.toFixed(1) || 'N/A'}/10
- Overall: ${overallAvg.toFixed(1)}/10

Questions & Scores:
${(questionHistory || []).map((q, i) => `Q${i + 1} [${q.score}/10]: ${q.question.substring(0, 80)}`).join('\n')}

Resume Gaps: ${(weaknesses || []).join(', ')}

Return ONLY raw JSON — no markdown, no prose. Start with { end with }:
{"hire_recommendation":"Yes","executive_summary":"3-4 sentence honest assessment","technical_assessment":"2-3 sentences about technical knowledge","communication_assessment":"2-3 sentences about communication","top_strengths":["strength 1","strength 2","strength 3"],"critical_gaps":["gap 1","gap 2"],"30_day_action_plan":["action 1","action 2","action 3","action 4"],"resources":[{"topic":"Topic","resource":"Book/course name"}]}

hire_recommendation must be one of: Strong Yes, Yes, Maybe, No`
    }], { temperature: 0.4, max_tokens: 2000 }, ['hire_recommendation', 'executive_summary', 'top_strengths']);
    res.json({ success: true, report });
  } catch (err) {
    console.error('Report error:', err.message);
    res.status(500).json({ error: 'Report generation failed: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ InterviuX running on http://localhost:${PORT}`));
