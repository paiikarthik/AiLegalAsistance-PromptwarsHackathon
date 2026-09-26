# ⚖️ LawBuddy AI: Problem Statement & Alignment Blueprint

## 🎯 The Core Problem
Legal agreements, rental contracts, employment terms, and legal notices in India are filled with intimidating legalese, complex obligations, ambiguous deadlines, and high risk clauses. Citizens, tenants, employees, and small business owners often sign documents without fully understanding their legal rights, financial liabilities, or statutory remedies.

---

## 🚀 The LawBuddy AI Solution & Alignment Matrix

LawBuddy AI solves this problem by serving as a Multi-Lingual GenAI Legal Document Simplification & Case Assistance Platform.

| Hackathon Objective | Solution Feature in LawBuddy AI | Codebase Module |
| :--- | :--- | :--- |
| **Plain-Language Document Simplification** | Converts complex legal text into plain-language summaries with risk levels (High, Medium, Low). | `services/gemini_service.py` |
| **Multi-Lingual Legal Translation** | Full translation across 9 Indian languages (Kannada, Hindi, Telugu, Tamil, Malayalam, Marathi, Bengali, Gujarati, English). Enforces Kannada SOV grammar rules. | `services/gemini_service.py` |
| **Interactive Legal Clarity & Action Map** | Structured 4-step action matrix: **Understand**, **Identify**, **Prepare**, **Navigate**. | `static/js/app.js`, `app.py` |
| **Statutory Law & Penalty Mapping** | Maps document clauses to Indian Contract Act 1872 (Sec 10), Rent Control Acts, BNS/IPC, and Consumer Protection Act with direct links to [India Code](https://www.indiacode.nic.in) & [NALSA](https://nalsa.gov.in). | `services/gemini_service.py` |
| **Grounded Case AI Assistant ChatBot** | Dynamic RAG chatbot answering document queries using Gemini 2.0 Flash & ChatGPT with source grounding. | `app.py`, `services/gemini_service.py` |
| **Document Comparison Engine** | Side-by-side clause addition, deletion, and risk diff comparison for Doc A vs Doc B. | `services/comparison_service.py` |
| **Advocate Consultation Brief Export** | One-click export of printable legal consultation briefs for advocates. | `services/consultation_service.py` |

---

## 🧪 Automated Testing & Verification
All features are covered by automated unit and integration tests under `tests/` (`python -m pytest tests/` or `python test.py`).
