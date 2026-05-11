# InterviuX — Agentic AI Mock Interview Platform

> Intelligent agentic mock interview platform that processes resumes to infer target roles and simulates adaptive, multimodal interview sessions with real-world job matching.

## 🚀 Advanced Features (Hackathon Requirements)

| Module | Description |
|---|---|
| **Resume Analysis** | Upload PDF → AI extracts skills, experience, seniority, and infers best-fit roles. |
| **Real Job Aggregation** | Integrates with **Remotive API** to fetch real, live job postings matched to your profile. |
| **Adaptive Agent** | Multi-phase orchestration (**Warm-up → Core → Deep-dive**). Agent dynamically pivots difficulty based on performance. |
| **Deep Audio Intel** | Uses Web Audio API for **Pitch Variation** (expressiveness) and **Hesitation/Pause detection** (>1.2s silence). |
| **Visual Intelligence** | Includes **Posture Detection** (Slouching/Off-center detection) and eye-tracking via `face-api.js`. |
| **Encouragement Flow** | AI detects low confidence/scores and provides real-time encouragement banners. |
| **Multimodal Scoring** | Technical (Strict LLM Evaluation) + Communication (Audio/Speech) + Confidence (Visual/Posture). |
| **AI Coaching Report** | Hire recommendation, executive summary, action plan, and curated resources. |

---

## 🛠 Setup & Installation

### Prerequisites
- **Node.js 18+**
- **Groq API Key** (Get one for free at [console.groq.com](https://console.groq.com))

### 1. Configuration
1.  Navigate to the `backend/` directory.
2.  Create a `.env` file and add your Groq API key:
    ```text
    GROQ_API_KEY=your_key_here
    PORT=3000
    ```

### 2. One-Command Startup
```bash
cd backend && npm install && npm start
```
*Access the platform at:* **http://localhost:3000**

---

## 📂 Project Structure Overview

```text
/InterviuX
│
├── README.md              # Project Overview & Setup
├── architecture.md        # Technical Design & Methodology
├── requirements.txt       # Core dependencies summary
├── backend/               # Node.js Express server & AI Logic
├── frontend/              # Vanilla JS/CSS/HTML assets
├── sample_inputs/         # Example resumes for testing
└── sample_outputs/        # Mock reports and sample scores
```

For more details on agents, see **[STRUCTURE.md](STRUCTURE.md)**.

## 🎥 Demo Video
[Watch the InterviuX Demo Video](https://drive.google.com/file/d/1uVlRnsd7epcuuKKdqkv7LbCutC0CPgw8/view?usp=sharing)

---

## 🏗 Architecture & Methodology
- **[Architecture Document](architecture.md):** Technical design, scoring logic, and user journey.
- **[Sample Inputs & Outputs](sample_inputs/):** Check this folder for demo resumes and example evaluation data.
