# InterviuX — AI-Powered Mock Interview Platform

> Intelligent agentic mock interview platform that uses your resume to infer target roles and simulates adaptive, multimodal interview sessions.

## Features

| Module | Description |
|---|---|
| **Resume Analysis** | Upload PDF → AI extracts skills, experience, seniority, infers best-fit roles |
| **Job Recommendations** | AI-curated job listings matched to your resume with salary ranges and skill gap analysis |
| **Adaptive Interview Agent** | Dynamically generates questions (Technical / Behavioral / System Design / Coding) and adjusts difficulty based on performance |
| **Audio Intelligence** | Real-time speech transcription, filler word detection, pace analysis, LLM communication scoring |
| **Visual Intelligence** | face-api.js webcam analysis — eye contact, facial expressions, engagement and stress indicators |
| **Multimodal Scoring** | Technical + Communication + Confidence scores per answer and in final report |
| **AI Coaching Report** | Hire recommendation, executive summary, 30-day action plan |
| **Performance History** | LocalStorage session tracking to monitor improvement over time |

## Setup

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

### Environment Variables

```
GROK_API_KEY=your_groq_api_key_here
PORT=3000
```

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/analyze` | Parse resume PDF, infer roles and skills |
| POST | `/job-recommendations` | Generate matched job listings |
| POST | `/generate-question` | Adaptive interview question generation |
| POST | `/evaluate-answer` | Technical answer scoring with ideal answer |
| POST | `/analyze-communication` | Audio transcript communication analysis |
| POST | `/generate-report` | Final AI coaching report |

## Tech Stack

- **Backend:** Node.js, Express.js, Groq API (LLaMA 3.3 70B)
- **Frontend:** Vanilla JS, face-api.js, Web Speech API
- **PDF Parsing:** pdf-parse

## Scoring Approach

Each answer is evaluated across three modalities:

- **Technical (1–10):** LLM semantic scoring + keyword/intent matching
- **Communication (1–10):** Filler word count, pace (WPM), clarity via LLM
- **Confidence (1–10):** Face engagement and expression analysis via face-api.js
