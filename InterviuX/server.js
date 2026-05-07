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
  'llama-3.1-8b-instant',    // 500K TPD
  'llama3-8b-8192',          // 500K TPD
  'gemma2-9b-it',            // 250K TPD
  'mixtral-8x7b-32768',      // 500K TPD
  'gemma-7b-it',             // 250K TPD
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
          'Authorization': `Bearer ${process.env.GROK_API_KEY}`
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
  throw new Error('API rate limit reached across all models. Please wait 1-2 minutes and try again, or add a fresh GROK_API_KEY in .env');
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in response');
  return JSON.parse(match[0]);
}

// ── RESUME ANALYSIS ──────────────────────────────────────
app.post('/analyze', upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const pdfData = await pdfParse(req.file.buffer);
    const resumeText = pdfData.text;

    if (!resumeText || resumeText.length < 100)
      return res.status(400).json({ error: 'Could not extract text from PDF.' });

    const content = await groqChat([{
      role: 'user',
      content: `You are an expert technical recruiter and career coach. Analyze this resume carefully.

Respond ONLY in valid JSON with this EXACT structure:
{
  "suggested_roles": [
    { "title": "Role Name", "match_percent": 85, "reason": "Specific reason based on resume" },
    { "title": "Role Name", "match_percent": 78, "reason": "Specific reason" },
    { "title": "Role Name", "match_percent": 65, "reason": "Specific reason" }
  ],
  "strengths": ["strength 1", "strength 2", "strength 3", "strength 4"],
  "weaknesses": ["gap 1", "gap 2", "gap 3"],
  "skill_breakdown": {
    "technical": ["skill1", "skill2", "skill3", "skill4"],
    "soft": ["skill1", "skill2", "skill3"],
    "missing_for_top_role": ["skill1", "skill2", "skill3"]
  },
  "summary": "2-sentence candidate summary highlighting unique value and readiness",
  "seniority": "Junior",
  "domain": "Backend",
  "years_experience": 2,
  "education_level": "Bachelor's"
}

Seniority must be one of: Junior, Mid, Senior, Staff, Principal
Domain must be one of: Backend, Frontend, Full-Stack, Data Science, ML/AI, DevOps, QA, Product, Embedded, Mobile

Resume:
${resumeText.substring(0, 3000)}`
    }], { temperature: 0.2, max_tokens: 900 });

    const analysis = parseJSON(content);
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

    const content = await groqChat([{
      role: 'user',
      content: `Generate 6 realistic job recommendations as JSON for a ${seniority || 'Mid'} ${domain || 'Backend'} candidate.
Skills: ${(skills || []).slice(0, 6).join(', ')}. Target roles: ${(roles || []).slice(0, 2).join(', ')}.

Respond ONLY in this JSON format:
{"jobs":[{"id":1,"title":"","company":"","company_logo_color":"#hex","location":"City (Remote/Hybrid)","salary_range":"$X-$Y","match_score":85,"why_it_fits":"1 sentence","required_skills":["s1","s2"],"missing_skills":["s1"],"job_type":"Full-time","experience_required":"X-Y years","posted_days_ago":3}]}

Rules: real companies (Google/Stripe/Meta/Uber/Figma/Notion/Vercel/Shopify/etc), sort by match_score desc, scores 60-95.`
    }], { temperature: 0.5, max_tokens: 1200 });

    const result = parseJSON(content);
    res.json({ success: true, jobs: result.jobs || [] });
  } catch (err) {
    console.error('Job recommendations error:', err.message);
    res.status(500).json({ error: 'Job recommendations failed: ' + err.message });
  }
});

// ── QUESTION GENERATION ───────────────────────────────────
app.post('/generate-question', async (req, res) => {
  try {
    const { role, previousScore, pastQuestions, weaknesses, questionType, questionNum, totalQuestions } = req.body;

    let difficultyGuide = 'Ask a moderately challenging technical question appropriate for this role.';
    if (previousScore !== null && previousScore !== undefined) {
      if (previousScore < 4) {
        difficultyGuide = 'The candidate struggled significantly. Ask a simpler, foundational question. Be gentle and encouraging in tone.';
      } else if (previousScore < 6) {
        difficultyGuide = 'The candidate showed partial understanding. Ask a clarifying follow-up or related fundamental.';
      } else if (previousScore >= 8) {
        difficultyGuide = 'Excellent response. Escalate to a harder system design, architecture, or edge-case question.';
      }
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

Respond ONLY with the interview question. No prefixes, quotes, or formatting. The question should be specific, clear, and interview-appropriate.`
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

    const content = await groqChat([{
      role: 'user',
      content: `You are a strict technical interviewer evaluating a candidate for ${role || 'a software engineering role'}.

Question: ${question}
Candidate Answer: ${answer}
Question Type: ${questionType || 'technical'}

SCORING RULES:
- Completely wrong, gibberish, or too short (< 10 words): score 1-2
- Partial understanding with major gaps: score 3-4
- Decent answer with minor gaps: score 5-6
- Good answer with clear understanding: score 7-8
- Expert-level, comprehensive answer: score 9-10

Respond ONLY in valid JSON:
{
  "score": 7,
  "feedback": "2-3 sentence specific, constructive feedback referencing what they said",
  "ideal_answer": "Complete, expert-level answer covering all key concepts, edge cases, and nuances expected for this role",
  "keywords_hit": ["concept1", "concept2"],
  "keywords_missed": ["concept1", "concept2"],
  "depth_level": "Surface|Moderate|Deep|Expert",
  "confidence_from_answer": "how confident the answer sounds: Low|Medium|High"
}`
    }], { temperature: 0.25, max_tokens: 1500 });

    const evaluation = parseJSON(content);
    res.json({ success: true, evaluation });
  } catch (err) {
    console.error('Evaluate error:', err.message);
    res.status(500).json({ error: 'Evaluation failed: ' + err.message });
  }
});

// ── COMMUNICATION ANALYSIS ────────────────────────────────
app.post('/analyze-communication', async (req, res) => {
  try {
    const { transcript, answer_text, duration_seconds, filler_count, word_count } = req.body;

    const text = transcript || answer_text || '';

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

    const content = await groqChat([{
      role: 'user',
      content: `Analyze this interview answer transcript for communication and confidence quality.

Transcript: "${text}"
Filler words detected: ${filler_count || 0}
Speaking pace: ${wpm > 0 ? wpm + ' WPM (' + paceLabel + ')' : 'unknown'}
Answer length: ${word_count || 0} words

Evaluate communication quality and respond ONLY in valid JSON:
{
  "confidence_score": 7,
  "clarity_score": 6,
  "communication_feedback": "2-3 specific, actionable observations about how they communicated",
  "strengths": ["comm strength 1", "comm strength 2"],
  "improvements": ["specific improvement 1", "specific improvement 2"],
  "overall_communication": "Poor|Fair|Good|Excellent"
}`
    }], { temperature: 0.3, max_tokens: 600 });

    const llmResult = parseJSON(content);
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

    const content = await groqChat([{
      role: 'user',
      content: `Generate a comprehensive post-interview coaching report for a ${seniority || 'Mid'} ${role} candidate.

Performance Summary:
- Technical Score: ${avgTechnical?.toFixed(1) || 'N/A'}/10
- Communication Score: ${avgCommunication?.toFixed(1) || 'N/A'}/10
- Confidence/Visual Score: ${avgVisual?.toFixed(1) || 'N/A'}/10
- Overall: ${overallAvg.toFixed(1)}/10

Questions & Scores:
${(questionHistory || []).map((q, i) => `Q${i + 1} [${q.score}/10]: ${q.question.substring(0, 80)}`).join('\n')}

Resume Gaps: ${(weaknesses || []).join(', ')}

Respond ONLY in valid JSON:
{
  "hire_recommendation": "Strong Yes|Yes|Maybe|No",
  "executive_summary": "3-4 sentence honest assessment of interview performance",
  "technical_assessment": "2-3 sentences specifically about technical knowledge demonstrated",
  "communication_assessment": "2-3 sentences about communication style, clarity, and confidence",
  "top_strengths": ["specific strength 1", "specific strength 2", "specific strength 3"],
  "critical_gaps": ["specific gap 1", "specific gap 2"],
  "30_day_action_plan": [
    "Specific action item 1 (e.g., 'Complete System Design course on Educative.io')",
    "Specific action item 2",
    "Specific action item 3",
    "Specific action item 4"
  ],
  "resources": [
    { "topic": "Topic name", "resource": "Specific book/course/platform name" }
  ]
}`
    }], { temperature: 0.4, max_tokens: 2000 });

    const report = parseJSON(content);
    res.json({ success: true, report });
  } catch (err) {
    console.error('Report error:', err.message);
    res.status(500).json({ error: 'Report generation failed: ' + err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ InterviuX running on http://localhost:${PORT}`));
