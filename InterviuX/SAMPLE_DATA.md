# InterviuX Sample Inputs & Outputs

This document provides examples of how the InterviuX system processes data at various stages of the interview lifecycle.

## 1. Resume Analysis (POST /analyze)

### Input (PDF Extraction)
> "Experience: 3 years as a Backend Engineer at TechCorp. Skills: Node.js, PostgreSQL, Docker, AWS. Projects: Built a high-concurrency microservices architecture..."

### Output (LLM Analysis JSON)
```json
{
  "suggested_roles": [
    { "title": "Senior Backend Engineer", "match_percent": 88, "reason": "Strong microservices background" },
    { "title": "System Architect", "match_percent": 75, "reason": "Experience with high-concurrency systems" }
  ],
  "strengths": ["Cloud Infrastructure", "System Design", "Node.js Mastery"],
  "weaknesses": ["No Frontend Frameworks", "Limited ML Experience"],
  "seniority": "Mid-Senior",
  "domain": "Backend"
}
```

## 2. Real-time Job Matching (POST /job-recommendations)

### Input (Profile Data)
- Seniority: Mid-Senior
- Domain: Backend
- Skills: Node.js, AWS, PostgreSQL

### Output (Ranked Live Jobs)
```json
{
  "success": true,
  "jobs": [
    {
      "title": "Senior Backend Engineer",
      "company": "Stripe",
      "location": "Remote",
      "match_score": 92,
      "why_it_fits": "Requires expertise in Node.js and distributed systems which aligns with your TechCorp project.",
      "apply_url": "https://remotive.com/remote-jobs/software-dev/senior-backend-engineer-12345",
      "is_real": true
    }
  ]
}
```

## 3. Answer Evaluation (POST /evaluate-answer)

### Input (Candidate Answer)
> "Microservices are better because they allow independent scaling. We used Docker and Kubernetes to manage them. Each service had its own database to ensure isolation."

### Output (Technical Evaluation)
```json
{
  "score": 8,
  "feedback": "Good mention of containerization and database isolation. You could have expanded on communication protocols like gRPC or Message Queues.",
  "keywords_hit": ["Scaling", "Docker", "Isolation"],
  "depth_level": "Deep",
  "confidence_from_answer": "High"
}
```

## 4. Communication Intelligence (POST /analyze-communication)

### Input (Signal Data)
- WPM: 145
- Fillers: 2 (um, uh)
- Pitch Variation: 45.2 Hz (Expressive)
- Hesitations: 1

### Output (LLM Feedback)
```json
{
  "confidence_score": 9,
  "clarity_score": 8,
  "communication_feedback": "Very confident delivery. Your vocal expressiveness (pitch variation) kept the answer engaging. Minimal hesitations.",
  "overall_communication": "Excellent"
}
```
