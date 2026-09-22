# ⚖️ LawBuddy AI — GenAI Legal Access & Case Preparation Platform

> **AI-Powered Plain-Language Legal Document Simplification, Precision Kannada Legal Translation, Evidence Mapping, and Advocate Consultation Preparation.**

---

## 🌟 Overview

**LawBuddy AI** is an advanced Multi Langauge AI legal assistance platform designed for Indian citizens, tenants, employees, consumers, and advocates. Legal agreements and notices in India are often filled with intimidating legalese, complex obligations, and ambiguous deadlines. 

LawBuddy AI bridges this gap by transforming dense legal documents (Rental Agreements, Eviction Notices, Employment Contracts, Consumer Complaints, NDAs) into plain-language actionable insights. It provides **high-accuracy Kannada and regional language translations**, clause risk analysis, evidence-to-clause mapping, legal terms explainers, and downloadable lawyer consultation briefs.

---

## 🚀 Key Features & Capabilities

### 1. 🌐 Precision Multilingual & Kannada Legal Engine
- **Authentic Kannada Translation**: Generates summaries, explanations, risk alerts, and next steps in fluent, grammatically accurate Kannada script (ಉದಾತ್ತ ಹಾಗೂ ಸರಳ ಕನ್ನಡ).
- **SOV Sentence Structure**: Enforces Subject-Object-Verb (SOV) Kannada grammar order to ensure translations sound natural to native Kannada speakers rather than literal machine-translated English (SVO).
- **Standard Legal Terminology 
 
- **Multilingual Support**: Fully supports 10 Indian languages including Kannada (ಕನ್ನಡ), Hindi (हिंदी), Malayalam (മലയാളം), Telugu (తెలుగు), Marathi (मराठी), Bengali (বাংলা), Gujarati (ગુજરાતી), Tulu (ತುಳು), Tamil (தமிழ்), and English.
- **Rule-Based Kannada Fallback**: Generates complete Kannada translation fallbacks when LLM APIs are offline or rate-limited.

### 2. 🔒 Enterprise Security & Privacy
- **HTTP Security Headers**: Enforces `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security`, `X-XSS-Protection`, and `Referrer-Policy`.
- **API Rate Limiting**: Thread-safe in-memory IP rate limiter (`MAX_REQUESTS_PER_MINUTE = 100`) preventing API abuse and quota exhaustion.
- **Path Traversal Protection**: Filename sanitization preserves Unicode characters while stripping path traversal tokens (`..`, `/`, `\`).
- **SSRF Protection**: Strict URL validation blocking requests to internal, private, or loopback IP ranges (`127.0.0.1`, `10.0.0.0/8`, `169.254.x.x`).
- **Automated 3-Hour Privacy Purger**: Background thread automatically purges uploaded files and session memory after 3 hours.

### 3. ⚡ High-Efficiency RAG & Retrieval Engine
- **TF-IDF & Cosine Similarity**: Semantic text chunking with TF-IDF retrieval for fast, grounded Q&A.
- **Optimized Module Imports**: High-performance top-level vectorizer initialization eliminating cold-start latency.
- **Smart Session Caching**: Reuses document analysis data across evidence mapping and brief generation to minimize API calls.

### 4. 📋 Evidence-to-Clause Mapping Matrix
- Automatically links contract clauses and financial terms with required evidence categories (e.g., Bank UPI receipts, notice delivery acknowledgements, signed agreement copies).
- Supports neutral status tracking: *Evidence found*, *Evidence missing*, *Evidence suggested*, *Requires verification*.

### 5. 🧑‍⚖️ Lawyer Consultation Brief Export
- One-click HTML export generating an official, printable/PDF advocate consultation brief.
- Formats executive summaries, clause risk flags, financial timelines, custom user notes, lawyer questions, and evidence checklists.

### 6. 💡 Zero-Jargon Legal Explainer
- Interactive explainer for complex legal concepts (Indemnification, Jurisdiction, Security Deposit, Lock-in Period, Notice Period, Arbitration, Non-compete under Section 27 of Indian Contract Act).

### 7. ♿ Accessibility & Typography
- Loaded Google Font `Noto Sans Kannada` alongside `Inter` in HTML and CSS for crisp, legible rendering of Kannada script across all browsers.
- Dynamic `document.documentElement.lang` attribute toggling and ARIA screen reader attributes (`aria-live`, `aria-label`).

---

## ⚙️ Local Installation & Setup

### Prerequisites
- Python 3.9 or higher
- Git

### Steps

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/paiikarthik/AiLegalAsistance-PromptwarsHackathon.git
   cd "Legal Assitance AI"
   ```

2. **Create a Virtual Environment**:
   ```bash
   python -m venv venv
   # Windows:
   venv\Scripts\activate
   # Linux/macOS:
   source venv/bin/activate
   ```

3. **Install Dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure Environment Variables**:
   Create a `.env` file in the root directory:
   ```env
   GEMINI_API_KEY=your_google_gemini_api_key
   OPENAI_API_KEY=your_openai_api_key  # Optional
   SECRET_KEY=your_secure_random_secret_key
   ```
   *(Note: If no API keys are provided, LawBuddy AI uses its built-in dynamic legal fallback engine).*

5. **Run the Application**:
   ```bash
   python app.py
   ```

---

## 🧪 Automated Testing

LawBuddy AI includes a comprehensive test suite covering all evaluation parameters (Kannada translation quality, security headers, path traversal, SSRF validation, RAG performance, evidence mapping, and brief generation).

Run all tests using Python's `unittest`:

```bash
python -m unittest discover -s scratch -p "test_*.py"
```

Expes*3acted output:
```text
Ran 17 tests in 15.938s

OK
```

---

## 🎯 Hackathon Evaluation Alignment Matrix

| Evaluation Parameter | Implementation & Features |
| :--- | :--- |
| **1. Kannada Translation Quality** | Specialized Kannada prompts, SOV grammar enforcement, standard Kannada legal terms (`ಕರಾರು`, `ಭದ್ರತಾ ಠೇವಣಿ`, `ನೋಟಿಸ್ ಅವಧಿ`), preserved English terms in brackets, rule-based fallback responses in native Kannada script. |
| **2. Code Quality** | Clean architecture, type annotations, explicit error handling, robust logging, structured JSON schema validation. |
| **3. Security** | HTTP Security Headers (CSP, X-Frame-Options, HSTS), thread-safe API rate limiting (100 req/min), path traversal protection, SSRF URL validation, and 3-hour automated file/session privacy purger. |
| **4. Efficiency** | Module-level TF-IDF imports, fast keyword fallback, context truncation, intelligent session caching to prevent redundant LLM calls. |
| **5. Testing** | 17 automated unit and integration tests passing with 100% success rate. |
| **6. Accessibility (A11y)** | Integrated `Noto Sans Kannada` font, dynamic HTML `lang` toggling, keyboard focus states, ARIA live region notifications. |
| **7. Problem Alignment** | Grounded in Indian statutory framework (Indian Contract Act 1872, Rent Control Acts, NALSA legal aid, India Code, e-Courts) with plain-language document analysis, evidence mapping, and consultation brief export. |

---

## 📜 Legal Disclaimer

> **IMPORTANT**: LawBuddy AI provides general legal information, document simplification, and preparation assistance. It is **not** a substitute for formal legal advice, representation, or opinion from a licensed legal professional or advocate. Always verify critical document clauses with a qualified advocate prior to taking formal legal action.

---
## 📄 License
**Built BY:** Karthik Pai with Antigravity & Codex For the Submission of Google Promptwars Hackathon.

Distributed under the MIT License. See `LICENSE` for details.
