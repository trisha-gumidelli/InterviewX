# InterviuX — Agentic AI Mock Interview Platform

> Intelligent agentic mock interview platform that processes resumes to infer target roles and simulates adaptive, multimodal interview sessions with real-world job matching.

## 🚀 Advanced Features (Hackathon Requirements)

| Module | Description |
|---|---|
| **Resume Analysis** | Upload PDF → AI extracts skills, experience, seniority, and infers best-fit roles. |
| **Real Job Aggregation** | **NEW:** Integrates with **Remotive API** to fetch real, live job postings matched to your profile with direct apply links. |
| **Adaptive Agent** | **NEW:** Multi-phase orchestration (**Warm-up → Core → Deep-dive**). Agent dynamically pivots difficulty based on consecutive performance. |
| **Deep Audio Intel** | **NEW:** Uses Web Audio API for **Pitch Variation** (expressiveness) and **Hesitation/Pause detection** (>1.2s silence). |
| **Visual Intelligence** | **NEW:** Includes **Posture Detection** (Slouching/Off-center detection) alongside eye-contact and expression analysis via `face-api.js`. |
| **Encouragement Flow** | **NEW:** AI detects low confidence/scores and provides real-time encouragement banners to improve candidate morale. |
| **Multimodal Scoring** | Technical (Strict LLM Evaluation + Pre-flight Filter) + Communication (Audio/Speech) + Confidence (Visual/Posture). |
| **AI Coaching Report** | Hire recommendation, executive summary, technical/comm assessments, strengths/gaps analysis, action plan, and curated resources. |

## 🛠 Setup

### Prerequisites
- Node.js 18+
- Groq API key → [console.groq.com](https://console.groq.com)

### Install & Run

```bash
git clone https://github.com/Manaswithareddysingam/Interviux.git
cd Interviux/InterviuX
npm install
cp .env.example .env
# Paste your Groq API key into .env
npm start
```

Open **http://localhost:3000**

## 🏗 Architecture

InterviuX uses an **Agentic Orchestration** model:
1. **The Profiler:** Analyzes resume and queries live job markets.
2. **The Interviewer:** A phased state-machine (Warmup, Core, Deep-dive) that adapts difficulty in real-time.
3. **The Multimodal Analyzer:** Simultaneously processes Video (Face/Posture), Audio (Pitch/Hesitation), and Text (Keywords/Logic).
4. **The Coach:** Aggregates all signals into a comprehensive feedback report.

## 📊 Evaluation Rubric

- **Technical (1–10):** Semantic scoring, keyword hits, and conceptual depth (LLM-based).
- **Communication (1–10):** WPM pace, filler count, pitch variation, and hesitation metrics.
- **Visual/Posture (1–10):** Eye-contact, stress-levels, and posture alignment.

## 📄 Documentation
- [Architecture Details](ARCHITECTURE.md)
- [Sample Inputs/Outputs](SAMPLE_DATA.md)

