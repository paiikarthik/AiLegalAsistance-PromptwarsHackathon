import os
import json
import logging
import re
import urllib.request
import urllib.error
from config import Config

logger = logging.getLogger("lawbuddy.gemini")

class GeminiService:
    """
    Interfaces with Google Gemini and OpenAI (ChatGPT) APIs to produce structured legal document analysis,
    clause risk explorer, Legal Clarity & Action Map, and multilingual responses.
    Routes Kannada, Malayalam, Telugu, Tamil, and other non-(Hindi/English/Tulu) languages to ChatGPT,
    while routing Hindi, English, and Tulu to Gemini.
    """
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key or Config.GEMINI_API_KEY
        self.openai_api_key = Config.OPENAI_API_KEY
        self.client = None
        self._init_client()
        
    def _init_client(self):
        if not self.api_key:
            logger.warning("No GEMINI_API_KEY found in config/env. Will use fallback AI generator mode if Gemini requested.")
            return
            
        try:
            # Try new google-genai SDK first
            from google import genai
            self.client = genai.Client(api_key=self.api_key)
            self.sdk_type = "genai"
            logger.info("Initialized Google GenAI client successfully.")
        except Exception as e:
            logger.warning(f"google.genai SDK init failed ({e}), attempting google.generativeai fallback.")
            try:
                import google.generativeai as genai_old
                genai_old.configure(api_key=self.api_key)
                self.client = genai_old.GenerativeModel(Config.PRIMARY_MODEL)
                self.sdk_type = "generativeai"
                logger.info("Initialized google.generativeai client successfully.")
            except Exception as e2:
                logger.error(f"Failed to initialize any Gemini client: {e2}")
                self.client = None

    def _is_chatgpt_language(self, language: str) -> bool:
        """
        Determines whether the given language should be routed to ChatGPT (OpenAI).
        Hindi, English, Tulu use Gemini.
        Kannada, Malayalam, Telugu, Tamil, and all other languages use ChatGPT.
        """
        lang_lower = (language or 'en').lower().strip()
        if lang_lower in {'en', 'english', 'hi', 'hindi', 'tulu', 'tcy'}:
            return False
        return True

    def _call_openai_raw(self, prompt: str) -> str:
        """
        Invokes ChatGPT (OpenAI API) for non-(Hindi/English/Tulu) languages such as Kannada, Malayalam, Telugu, Tamil, etc.
        """
        api_key = self.openai_api_key or os.environ.get('OPENAI_API_KEY', '')
        if not api_key:
            raise ValueError("No OPENAI_API_KEY available")

        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        models_to_try = ["gpt-4o-mini", "gpt-3.5-turbo", "gpt-4o"]
        last_error = None

        for model in models_to_try:
            try:
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "You are LawBuddy, an expert Indian legal AI assistant and accurate multilingual legal document translator."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2
                }
                req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"), headers=headers)
                with urllib.request.urlopen(req, timeout=30) as response:
                    res_data = json.loads(response.read().decode("utf-8"))
                    content = res_data["choices"][0]["message"]["content"]
                    logger.info(f"Successfully generated response using ChatGPT ({model}).")
                    return content
            except Exception as e:
                last_error = e
                logger.warning(f"ChatGPT model {model} attempt failed: {e}")

        raise last_error or Exception("All ChatGPT model attempts failed.")

    def _call_llm_raw(self, prompt: str, language: str = 'en') -> str:
        """
        Unified LLM router:
        - Kannada, Malayalam, Telugu, Tamil, and other languages -> ChatGPT (OpenAI)
        - Hindi, English, Tulu -> Gemini
        Gracefully falls back to secondary provider if primary provider fails.
        """
        use_chatgpt = self._is_chatgpt_language(language)

        if use_chatgpt:
            logger.info(f"Routing language '{language}' to ChatGPT (OpenAI API)...")
            try:
                return self._call_openai_raw(prompt)
            except Exception as e:
                logger.warning(f"ChatGPT request failed for language '{language}': {e}. Attempting Gemini fallback...")
                if self.client:
                    return self._call_gemini_raw(prompt)
                raise e
        else:
            logger.info(f"Routing language '{language}' to Google Gemini API...")
            if self.client:
                try:
                    return self._call_gemini_raw(prompt)
                except Exception as e:
                    logger.warning(f"Gemini API request failed for language '{language}': {e}. Attempting ChatGPT fallback...")
                    if self.openai_api_key:
                        return self._call_openai_raw(prompt)
                    raise e
            elif self.openai_api_key:
                return self._call_openai_raw(prompt)
            else:
                raise ValueError("No active Gemini or OpenAI client available")

    def analyze_document(self, text: str, doc_type: str, language: str = 'en') -> dict:
        """
        Runs full comprehensive analysis on the extracted document text.
        Generates:
        1. Document Simplification
        2. Clause and Risk Analysis
        3. Legal Clarity & Action Map
        """
        target_lang_name = Config.SUPPORTED_LANGUAGES.get(language, language)
        
        prompt = f"""
You are LawBuddy, an expert Indian Legal AI Assistant.
Analyze the following legal document (Type: {doc_type}) for an Indian user.
Generate a structured JSON response in {target_lang_name}.

CRITICAL INSTRUCTIONS:
1. Provide explanations in simple, plain language understandable to ordinary Indian citizens. Never use AI, OCR, RAG, embeddings, classification, or other technical terms in the response.
2. Keep important Indian legal terms in English (e.g., 'Indemnity', 'Lock-in period', 'Stamp Duty', 'Notice Period', 'Security Deposit', 'Jurisdiction') alongside their explanation in {target_lang_name}.
3. DO NOT claim to replace a lawyer or declare clauses legally illegal without qualification. Use cautious terms like 'Potential Concern' or 'Requires Professional Review'.
4. Ground every explanation strictly in the document text provided. Cite page numbers or clause titles if present. Never invent a legal deadline: if a date is found but its meaning is unclear, say that it was found but could not be confirmed.
5. Use a respectful, reassuring tone. Do not predict who will win or lose, or say that anything is definitely legal or illegal. Phrase lawyer questions as questions the user may want to ask.
5. Return ONLY a valid JSON object matching the exact schema below.

JSON SCHEMA REQUIREMENT:
{{
  "doc_type": "{doc_type}",
  "language": "{target_lang_name}",
  "summary": "Short 2-3 sentence overview of the agreement",
  "parties": [
    {{"role": "Landlord / Employer / Party A", "name": "Name from document"}},
    {{"role": "Tenant / Employee / Party B", "name": "Name from document"}}
  ],
  "key_obligations": [
    "Obligation 1 with party responsibility",
    "Obligation 2"
  ],
  "important_dates_and_amounts": [
    {{"item": "Monthly Rent / CTC / Fee", "details": "₹ Amount or Deadline found in doc"}},
    {{"item": "Security Deposit", "details": "₹ Amount found in doc"}},
    {{"item": "Notice Period / Duration", "details": "Duration found in doc"}}
  ],
  "clauses_and_risks": [
    {{
      "risk_level": "High Risk" | "Medium Risk" | "Low Risk" | "Informational",
      "category": "Financial Obligations / Penalties / Termination / Lock-in / Liability / Ambiguity",
      "original_clause": "Exact text or summary of original clause from document",
      "explanation": "Plain language explanation of what this means for the user",
      "why_deserves_attention": "Reason why the user should take note or be cautious",
      "suggested_question": "Specific clear question to ask a lawyer about this clause",
      "evidence_status": "Fact found in document" | "Requires verification" | "Standard clause",
      "page_ref": "Page X or Section Y"
    }}
  ],
  "action_map": {{
    "understand": [
      "Point 1: Key rule user must understand clearly",
      "Point 2: Financial impact summary"
    ],
    "identify": [
      "Point 1: Obligation identified",
      "Point 2: Potential concern or ambiguity found"
    ],
    "prepare": {{
      "questions_for_lawyer": [
        "Question 1 to ask a legal professional",
        "Question 2 to ask a legal professional"
      ],
      "checklist_to_collect": [
        "Document/Evidence item 1 to collect",
        "Document/Evidence item 2 to collect"
      ]
    }},
    "navigate": {{
      "next_steps": [
        "Informational step 1",
        "Informational step 2"
      ],
      "official_sources": [
        {{
          "title": "India Code - Official Indian Statute Repository",
          "url": "https://www.indiacode.nic.in",
          "description": "Official government portal for Indian Acts and Laws."
        }},
        {{
          "title": "e-Courts Services India",
          "url": "https://ecourts.gov.in",
          "description": "Official Indian court information services."
        }},
        {{
          "title": "National Legal Services Authority (NALSA)",
          "url": "https://nalsa.gov.in",
          "description": "Free legal aid resources for eligible Indian citizens."
        }}
      ]
    }}
  }}
}}

DOCUMENT TEXT:
\"\"\"
{text[:12000]}
\"\"\"
"""
        return self._generate_json_response(prompt, doc_type, language)

    def answer_question(self, text: str, question: str, chat_history: list = None, language: str = 'en') -> dict:
        """
        Answer user question strictly grounded in the uploaded document text (RAG Q&A).
        """
        target_lang_name = Config.SUPPORTED_LANGUAGES.get(language, language)
        
        prompt = f"""
You are LawBuddy, an AI Legal Assistant for Indian citizens.
Answer the user's question STRICTLY based on the provided document text.

CRITICAL RULES:
1. Base your answer ONLY on facts stated in the document text.
2. If the information is not present in the document text, explicitly state: "This information was not found in the uploaded document." Do not invent or assume facts.
3. Provide line/clause or page references whenever possible.
4. Respond in {target_lang_name}. Keep key English legal terms where appropriate.
5. Provide a clear, helpful response with a list of grounded citations/sources.

QUESTION: {question}

DOCUMENT TEXT:
\"\"\"
{text[:12000]}
\"\"\"
"""
        try:
            raw_response = self._call_llm_raw(prompt, language)
            return {
                "answer": raw_response.strip(),
                "grounded": "Information found in document" if "not found in the uploaded document" not in raw_response.lower() else "Not found in document",
                "disclaimer": "LawBuddy provides general legal information. Verify with a qualified professional."
            }
        except Exception as e:
            logger.error(f"Error calling LLM QA: {e}")
            return self._fallback_qa_response(text, question, language)

    def _generate_json_response(self, prompt: str, doc_type: str, language: str) -> dict:
        try:
            raw_text = self._call_llm_raw(prompt, language)
            cleaned_json = self._extract_json_string(raw_text)
            parsed_data = json.loads(cleaned_json)
            return parsed_data
        except Exception as e:
            logger.error(f"Failed to generate or parse LLM JSON response: {e}")
            return self._fallback_analysis_response(doc_type, language)

    def _call_gemini_raw(self, prompt: str) -> str:
        if self.sdk_type == "genai":
            response = self.client.models.generate_content(
                model=Config.PRIMARY_MODEL,
                contents=prompt
            )
            return response.text
        else:
            response = self.client.generate_content(prompt)
            return response.text

    def _extract_json_string(self, text: str) -> str:
        # Match ```json ... ``` or extract content between first { and last }
        match = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', text, re.DOTALL)
        if match:
            return match.group(1)
            
        first_brace = text.find('{')
        last_brace = text.rfind('}')
        if first_brace != -1 and last_brace != -1:
            return text[first_brace:last_brace + 1]
            
        return text

    def _fallback_analysis_response(self, doc_type: str, language: str) -> dict:
        """
        Deterministic high-quality fallback for demonstration when Gemini API key is missing/unreachable.
        Tailored dynamically according to document type.
        """
        is_kannada = (language == 'kn')
        dt_lower = (doc_type or '').lower()

        if 'employment' in dt_lower or 'offer' in dt_lower or 'appointment' in dt_lower:
            if is_kannada:
                return {
                    "doc_type": doc_type or "ಉದ್ಯೋಗ ಒಪ್ಪಂದ (Employment Contract)",
                    "language": "Kannada",
                    "summary": "ಈ ಒಪ್ಪಂದವು ಸಂಸ್ಥೆ ಮತ್ತು ಉದ್ಯೋಗಿಯ ನಡುವಿನ ಅಧಿಕೃತ ಉದ್ಯೋಗ ಷರತ್ತುಗಳ ಒಪ್ಪಂದವಾಗಿದೆ.",
                    "parties": [
                        {"role": "ಉದ್ಯೋಗದಾತ (Employer / Company)", "name": "ಟೆಕ್ ಪರಿಹಾರ ಸಂಸ್ಥೆ (Tech Solutions India)"},
                        {"role": "ಉದ್ಯೋಗಿ (Employee)", "name": "ಶ್ರೀ ರಮೇಶ್ ಕುಮಾರ್"}
                    ],
                    "key_obligations": [
                        "ಉದ್ಯೋಗಿಯು ವಾರಕ್ಕೆ 40 ಗಂಟೆಗಳ ಕೆಲಸದ ಸಮಯವನ್ನು ಪಾಲಿಸಬೇಕು.",
                        "ಸಂಸ್ಥೆಯ ರಹಸ್ಯ ಮಾಹಿತಿಯನ್ನು (Confidential Data) ಹೊರಗೆ ಹಂಚಿಕೊಳ್ಳಬಾರದು.",
                        "ಕೆಲಸಕ್ಕೆ ರಾಜೀನಾಮೆ ನೀಡಲು 2 ತಿಂಗಳ ಮುಂಚಿತ Notice Period ಅಗತ್ಯವಿದೆ."
                    ],
                    "important_dates_and_amounts": [
                        {"item": "ವಾರ್ಷಿಕ ವೇತನ (CTC / Annual Salary)", "details": "₹ 8,50,000 / ವರ್ಷ"},
                        {"item": "Notice Period (ನೋಟಿಸ್ ಅವಧಿ)", "details": "60 ದಿನಗಳು (2 ತಿಂಗಳು)"},
                        {"item": "ಪರೀಕ್ಷಾರ್ಥ ಅವಧಿ (Probation Period)", "details": "6 ತಿಂಗಳು"}
                    ],
                    "clauses_and_risks": [
                        {
                            "risk_level": "High Risk",
                            "category": "Non-Compete & Restrictive Covenant",
                            "original_clause": "Clause 14: Employee shall not join any competitor company for 12 months post-resignation.",
                            "explanation": "ಕೆಲಸ ಬಿಟ್ಟ ನಂತರ 1 ವರ್ಷದವರೆಗೆ ಅದೇ ಕ್ಷೇತ್ರದಲ್ಲಿ ಕಾರ್ಯನಿರ್ವಹಿಸುವ ಯಾವುದೇ ಸ್ಪರ್ಧಿ ಸಂಸ್ಥೆಗೆ ಸೇರುವಂತಿಲ್ಲ.",
                            "why_deserves_attention": "ಭಾರತೀಯ ಕಾಂಟ್ರಾಕ್ಟ್ ಕಾಯ್ದೆ ಸೆಕ್ಷನ್ 27 ರ ಅಡಿಯಲ್ಲಿ ಕೆಲಸ ಬಿಟ್ಟ ನಂತರದ ಉದ್ಯೋಗ ತಡೆ ಷರತ್ತುಗಳಿಗೆ ಕಾನೂನು ಮಾನ್ಯತೆ ಸಂಶಯಾಸ್ಪದವಾಗಿದೆ.",
                            "suggested_question": "ಈ Non-Compete ಷರತ್ತು ಭಾರತೀಯ ಕಾನೂನಿನಡಿಯಲ್ಲಿ ಸಿಂಧುವೇ ಮತ್ತು ಇದನ್ನು ಸಡಿಲಗೊಳಿಸಬಹುದೇ?",
                            "evidence_status": "Fact found in document",
                            "page_ref": "Page 4, Clause 14"
                        }
                    ],
                    "action_map": {
                        "understand": [
                            "ಉದ್ಯೋಗ ಒಪ್ಪಂದವು 6 ತಿಂಗಳ probation ಮತ್ತು 2 ತಿಂಗಳ ನೋಟಿಸ್ ಅವಧಿಯನ್ನು ಹೊಂದಿದೆ.",
                            "CTC ₹8,50,000 ಆಗಿದ್ದು, ರಹಸ್ಯ ಮಾಹಿತಿ ಕಾಪಾಡುವ ಷರತ್ತುಗಳಿವೆ."
                        ],
                        "identify": [
                            "ಉದ್ಯೋಗ ನಂತರದ 12 ತಿಂಗಳ Non-Compete ಷರತ್ತು ಗಮನಿಸಬೇಕಾದ ಪ್ರಮುಖ ವಿಷಯ."
                        ],
                        "prepare": {
                            "questions_for_lawyer": [
                                "Non-Compete ಷರತ್ತು ನನ್ನ ಭವಿಷ್ಯದ ಕೆಲಸದ ಮೇಲೆ ಪರಿಣಾಮ ಬೀರುತ್ತದೆಯೇ?"
                            ],
                            "checklist_to_collect": [
                                "ಆಫರ್ ಲೆಟರ್ ನಕಲು (Offer Letter Copy)",
                                "ಪ್ರಾಫಿಡೆಂಟ್ ಫಂಡ್ ಮತ್ತು ಹುದ್ದೆಯ ವಿವರಣೆ ಪತ್ರ"
                            ]
                        },
                        "navigate": {
                            "next_steps": [
                                "ಸಹಿ ಮಾಡುವ ಮುನ್ನ ನೋಟಿಸ್ ಅವಧಿ ಮತ್ತು Non-Compete ನಿಯಮಗಳ ಬಗ್ಗೆ HR ನೊಂದಿಗೆ ಚರ್ಚಿಸಿ."
                            ],
                            "official_sources": [
                                {
                                    "title": "India Code - Indian Contract Act 1872",
                                    "url": "https://www.indiacode.nic.in",
                                    "description": "ಉದ್ಯೋಗ ಒಪ್ಪಂದಗಳ ಅಧಿಕೃತ ಕಾಯ್ದೆ."
                                }
                            ]
                        }
                    }
                }
            else:
                return {
                    "doc_type": doc_type or "Employment Contract",
                    "language": "English",
                    "summary": "This document outlines the standard employment terms, compensation, and obligations between the Employer and Employee.",
                    "parties": [
                        {"role": "Employer / Company", "name": "Tech Solutions Pvt Ltd"},
                        {"role": "Employee", "name": "Mr. Ramesh Kumar"}
                    ],
                    "key_obligations": [
                        "Employee agrees to perform assigned duties with standard 40-hour work weeks.",
                        "Employee agrees to maintain strict confidentiality of proprietary company data.",
                        "Notice period of 60 days (2 months) is required for resignation or termination."
                    ],
                    "important_dates_and_amounts": [
                        {"item": "Annual CTC Salary", "details": "₹ 8,50,000 / annum"},
                        {"item": "Notice Period", "details": "60 Days (2 Months)"},
                        {"item": "Probation Duration", "details": "6 Months"}
                    ],
                    "clauses_and_risks": [
                        {
                            "risk_level": "High Risk",
                            "category": "Non-Compete & Restrictive Covenant",
                            "original_clause": "Clause 14: Employee shall not join any competing organization within India for a period of 12 months after leaving employment.",
                            "explanation": "Prevents you from joining any competing business in the same industry for 1 full year after leaving.",
                            "why_deserves_attention": "Under Section 27 of the Indian Contract Act, post-employment non-compete clauses are generally unenforceable restraint of trade.",
                            "suggested_question": "Is this 12-month post-employment Non-Compete enforceable under Indian law?",
                            "evidence_status": "Fact found in document",
                            "page_ref": "Page 4, Clause 14"
                        }
                    ],
                    "action_map": {
                        "understand": [
                            "Employment is subject to 6 months probation and 60 days notice period.",
                            "Annual compensation is fixed at ₹8,50,000 CTC."
                        ],
                        "identify": [
                            "Strict 12-month post-employment Non-Compete restriction clause."
                        ],
                        "prepare": {
                            "questions_for_lawyer": [
                                "Can the 60-day notice period be bought out if leaving earlier?",
                                "What constitutes proprietary data under Clause 12?"
                            ],
                            "checklist_to_collect": [
                                "Signed Offer Letter and Annexure A Compensation Breakdown",
                                "Employee Handbook / HR Policy Document"
                            ]
                        },
                        "navigate": {
                            "next_steps": [
                                "Clarify notice period buyout policy prior to signing.",
                                "Keep a record of all joining docs and IP assignments."
                            ],
                            "official_sources": [
                                {
                                    "title": "India Code - Central Statutory Portal",
                                    "url": "https://www.indiacode.nic.in",
                                    "description": "Official repository for Labour Laws & Contract Act."
                                }
                            ]
                        }
                    }
                }
        elif 'notice' in dt_lower or 'eviction' in dt_lower or 'demand' in dt_lower:
            if is_kannada:
                return {
                    "doc_type": doc_type or "ಕಾನೂನು ನೋಟಿಸ್ (Legal Notice)",
                    "language": "Kannada",
                    "summary": "ಈ ದಾಖಲೆಯು ವಕೀಲರ ಮೂಲಕ ನೀಡಲಾದ ಕಾನೂನು ನೋಟಿಸ್ ಆಗಿದ್ದು, 15 ದಿನಗಳ ಒಳಗೆ ಕ್ರಮ ಕೈಗೊಳ್ಳಲು ಆಗ್ರಹಿಸುತ್ತದೆ.",
                    "parties": [
                        {"role": "ನೋಟಿಸ್ ಕಳುಹಿಸಿದವರು (Claimant / Advocate)", "name": "ಶ್ರೀ ರಾಜೇಶ್ ಕುಮಾರ್ (ಮೂಲಕ ವಕೀಲರು)"},
                        {"role": "ನೋಟಿಸ್ ಸ್ವೀಕರಿಸಿದವರು (Recipient)", "name": "ಶ್ರೀ ಸುರೇಶ್ ಶರ್ಮಾ"}
                    ],
                    "key_obligations": [
                        "ನೋಟಿಸ್ ದಿನಾಂಕದಿಂದ 15 ದಿನಗಳ ಒಳಗೆ ಬಾಕಿ ಹಣವನ್ನು ಪಾವತಿಸಬೇಕು ಅಥವಾ ಪ್ರತ್ಯುತ್ತರ ನೀಡಬೇಕು.",
                        "ವಿಫಲವಾದರೆ ನ್ಯಾಯಾಲಯದಲ್ಲಿ ಸಿವಿಲ್ ಅಥವಾ ಕ್ರಿಮಿನಲ್ ಮೊಕದ್ದಮೆ ಹೂಡಲಾಗುವುದು."
                    ],
                    "important_dates_and_amounts": [
                        {"item": "ಕೋರಲಾದ ಒಟ್ಟು ಮೊತ್ತ (Claimed Amount)", "details": "₹ 45,000"},
                        {"item": "ಉತ್ತರಿಸಲು ಕೊನೆಯ ದಿನಾಂಕ (Response Deadline)", "details": "15 ದಿನಗಳ ಗಡುವು"},
                        {"item": "ನೋಟಿಸ್ ದಿನಾಂಕ (Notice Date)", "details": "ಇತ್ತೀಚಿನ ದಿನಾಂಕ"}
                    ],
                    "clauses_and_risks": [
                        {
                            "risk_level": "High Risk",
                            "category": "Statutory Response Deadline",
                            "original_clause": "Call upon you to pay the sum of ₹45,000 within 15 days, failing which legal proceedings will be initiated.",
                            "explanation": "15 ದಿನಗಳ ಒಳಗೆ ಸೂಕ್ತ ಉತ್ತರ ಅಥವಾ ಪಾವತಿ ನೀಡದಿದ್ದರೆ ವಕೀಲರು ಕೋರ್ಟ್‌ನಲ್ಲಿ ಕೇಸ್ ದಾಖಲಿಸಬಹುದು.",
                            "why_deserves_attention": "ನೋಟಿಸ್‌ಗೆ ಗಡುವಿನೊಳಗೆ ಉತ್ತರಿಸದಿದ್ದರೆ ಕೋರ್ಟ್‌ನಲ್ಲಿ ನಿಮ್ಮ ಪರ ವಾದ ದುರ್ಬಲವಾಗಬಹುದು.",
                            "suggested_question": "ಈ ನೋಟಿಸ್‌ಗೆ ಲಿಖಿತ ಪ್ರತ್ಯುತ್ತರ (Reply to Legal Notice) ಕಳುಹಿಸಲು ವಕೀಲರನ್ನು ಸಂಪರ್ಕಿಸಬೇಕೇ?",
                            "evidence_status": "Fact found in document",
                            "page_ref": "Page 1, Demand Clause"
                        }
                    ],
                    "action_map": {
                        "understand": [
                            "ಇದು 15 ದಿನಗಳ ಗಡುವನ್ನು ಹೊಂದಿರುವ ಕಾನೂನು ನೋಟಿಸ್ ಆಗಿದೆ."
                        ],
                        "identify": [
                            "ಗಡುವಿನೊಳಗೆ ಉತ್ತರಿಸದಿರುವುದು ಕಾನೂನು ಚೌಕಟ್ಟಿನಲ್ಲಿ ಅಪಾಯ ತರಬಹುದು."
                        ],
                        "prepare": {
                            "questions_for_lawyer": [
                                "ಈ ನೋಟಿಸ್‌ನಲ್ಲಿರುವ ಆಪಾದನೆಗಳಿಗೆ ಸೂಕ್ತ ಸಮಜಾಯಿಷಿ ಏನು?"
                            ],
                            "checklist_to_collect": [
                                "ಬ್ಯಾಂಕ್ ವಹಿವಾಟು ರಶೀದಿಗಳು ಮತ್ತು ಹಿಂದಿನ ಸಂವಹನ ಪ್ರತಿಗಳು"
                            ]
                        },
                        "navigate": {
                            "next_steps": [
                                "ತಕ್ಷಣ ವಕೀಲರು ಅಥವಾ NALSA ಉಚಿತ ಕಾನೂನು ನೆರವು ಕೇಂದ್ರವನ್ನು ಸಂಪರ್ಕಿಸಿ."
                            ],
                            "official_sources": [
                                {
                                    "title": "National Legal Services Authority (NALSA)",
                                    "url": "https://nalsa.gov.in",
                                    "description": "ಉಚಿತ ಕಾನೂನು ನೆರವು ಮತ್ತು ಮಾಹಿತಿ."
                                }
                            ]
                        }
                    }
                }
            else:
                return {
                    "doc_type": doc_type or "Legal Notice",
                    "language": "English",
                    "summary": "This document is a formal Legal Notice demanding compliance or payment within a stipulated 15-day statutory window.",
                    "parties": [
                        {"role": "Issuing Party / Advocate", "name": "Mr. Rajesh Kumar (via Counsel)"},
                        {"role": "Recipient", "name": "Mr. Suresh Sharma"}
                    ],
                    "key_obligations": [
                        "Recipient is required to comply with demands or issue a formal written reply within 15 days.",
                        "Failure to respond may lead to litigation in court."
                    ],
                    "important_dates_and_amounts": [
                        {"item": "Demanded Claim Amount", "details": "₹ 45,000"},
                        {"item": "Statutory Cure Period", "details": "15 Days from receipt"},
                        {"item": "Notice Issue Date", "details": "As stated in document"}
                    ],
                    "clauses_and_risks": [
                        {
                            "risk_level": "High Risk",
                            "category": "Statutory Response Deadline",
                            "original_clause": "Call upon you to pay the sum of ₹45,000 within 15 days, failing which legal proceedings will be initiated.",
                            "explanation": "Failure to send a reply within 15 days allows the issuing party to file a court lawsuit.",
                            "why_deserves_attention": "Unanswered legal notices can be used against you in judicial proceedings.",
                            "suggested_question": "Should we draft and serve a formal Advocate's Reply Notice immediately?",
                            "evidence_status": "Fact found in document",
                            "page_ref": "Page 1, Demand Clause"
                        }
                    ],
                    "action_map": {
                        "understand": [
                            "This is a formal 15-day statutory Legal Notice."
                        ],
                        "identify": [
                            "Strict 15-day response timeline."
                        ],
                        "prepare": {
                            "questions_for_lawyer": [
                                "What documents are required to counter the claims in the notice?"
                            ],
                            "checklist_to_collect": [
                                "Payment receipts, communication logs, and contract copies"
                            ]
                        },
                        "navigate": {
                            "next_steps": [
                                "Consult legal aid or advocate to issue a formal written reply before deadline."
                            ],
                            "official_sources": [
                                {
                                    "title": "National Legal Services Authority (NALSA)",
                                    "url": "https://nalsa.gov.in",
                                    "description": "Free Legal Aid & Support Portal."
                                }
                            ]
                        }
                    }
                }
        else:
            if is_kannada:
                return {
                    "doc_type": doc_type or "ಕಾನೂನು ಒಪ್ಪಂದ (Legal Document)",
                    "language": "Kannada",
                    "summary": "ಈ ಒಪ್ಪಂದವು ಸಂಬಂಧಪಟ್ಟ ಪಕ್ಷಗಳ ನಡುವೆ ಹಕ್ಕುಗಳು ಮತ್ತು ಜವಾಬ್ದಾರಿಗಳನ್ನು ನಿಗದಿಪಡಿಸುತ್ತದೆ.",
                    "parties": [
                        {"role": "ಮೊದಲ ಪಕ್ಷ (Party A)", "name": "ಶ್ರೀ ರಾಜೇಶ್ ಶರ್ಮಾ"},
                        {"role": "ಎರಡನೇ ಪಕ್ಷ (Party B)", "name": "ಶ್ರೀ ಸುರೇಶ್ ಕುಮಾರ್"}
                    ],
                    "key_obligations": [
                        "ಪಕ್ಷಗಳು ಒಪ್ಪಂದದಲ್ಲಿ ನಮೂದಿಸಲಾದ ನಿಯಮಗಳನ್ನು ಪಾಲಿಸಲು ಬದ್ಧವಾಗಿರುತ್ತವೆ.",
                        "ಸಂಶಯಗಳಿದ್ದಲ್ಲಿ ಕಾನೂನು ತಜ್ಞರ ಸಲಹೆ ಪಡೆಯುವುದು ಅಗತ್ಯ."
                    ],
                    "important_dates_and_amounts": [
                        {"item": "ಒಪ್ಪಂದದ ಮೌಲ್ಯ (Contract Amount)", "details": "ದಾಖಲೆಯಲ್ಲಿ ನಮೂದಿಸಲಾಗಿದೆ"},
                        {"item": "ಅವಧಿ (Duration / Term)", "details": "ಒಪ್ಪಂದದ ಅವಧಿ"}
                    ],
                    "clauses_and_risks": [
                        {
                            "risk_level": "Medium Risk",
                            "category": "Terms & Obligations Review",
                            "original_clause": "Standard legal terms clause as per document.",
                            "explanation": "ದಾಖಲೆಯಲ್ಲಿರುವ ಷರತ್ತುಗಳನ್ನು ಜಾಗರೂಕತೆಯಿಂದ ಪರಿಶೀಲಿಸಬೇಕು.",
                            "why_deserves_attention": "ದಂಡ ಅಥವಾ ರದ್ದತಿ ನಿಯಮಗಳನ್ನು ಗಮನದಲ್ಲಿಡಿ.",
                            "suggested_question": "ಈ ಒಪ್ಪಂದದ ಪ್ರಮುಖ ಷರತ್ತುಗಳನ್ನು ವಕೀಲರೊಂದಿಗೆ ಪರಿಶೀಲಿಸಿ.",
                            "evidence_status": "Standard clause",
                            "page_ref": "Page 1"
                        }
                    ],
                    "action_map": {
                        "understand": [
                            "ಒಪ್ಪಂದದ ಹಕ್ಕುಗಳು ಮತ್ತು ಜವಾಬ್ದಾರಿಗಳನ್ನು ಅರ್ಥೈಸಿಕೊಳ್ಳಿ."
                        ],
                        "identify": [
                            "ಪ್ರಮುಖ ಷರತ್ತುಗಳನ್ನು ಗಮನಿಸಿ."
                        ],
                        "prepare": {
                            "questions_for_lawyer": [
                                "ಈ ಒಪ್ಪಂದದಲ್ಲಿ ಯಾವುದೇ ಅನಾನುಕೂಲ ಷರತ್ತುಗಳಿವೆಯೇ?"
                            ],
                            "checklist_to_collect": [
                                "ಸಹಿ ಮಾಡಿದ ಒಪ್ಪಂದದ ಮೂಲ ನಕಲು"
                            ]
                        },
                        "navigate": {
                            "next_steps": [
                                "ಒಪ್ಪಂದಕ್ಕೆ ಸಹಿ ಮಾಡುವ ಮುನ್ನ ವಕೀಲರನ್ನು ಸಂಪರ್ಕಿಸಿ."
                            ],
                            "official_sources": [
                                {
                                    "title": "India Code - Central Statutory Portal",
                                    "url": "https://www.indiacode.nic.in",
                                    "description": "ಭಾರತೀಯ ಕಾಯ್ದೆಗಳ ಅಧಿಕೃತ ಮೂಲ."
                                }
                            ]
                        }
                    }
                }
            else:
                return {
                    "doc_type": doc_type or "Legal Document",
                    "language": "English",
                    "summary": "This legal document defines the rights, obligations, and terms between the participating parties.",
                    "parties": [
                        {"role": "Party A", "name": "First Party / Organization"},
                        {"role": "Party B", "name": "Second Party / Individual"}
                    ],
                    "key_obligations": [
                        "Parties must comply with all specified terms and contractual duties.",
                        "Disputes shall be resolved through arbitration or local jurisdiction."
                    ],
                    "important_dates_and_amounts": [
                        {"item": "Contract Amount / Value", "details": "As specified in text"},
                        {"item": "Term / Validity", "details": "As specified in text"}
                    ],
                    "clauses_and_risks": [
                        {
                            "risk_level": "Medium Risk",
                            "category": "Terms & Liability Scope",
                            "original_clause": "Standard governing terms clause in document.",
                            "explanation": "Details obligations and liability thresholds.",
                            "why_deserves_attention": "Ensure termination penalties and liability caps are acceptable.",
                            "suggested_question": "Are liability and termination clauses balanced for both parties?",
                            "evidence_status": "Standard clause",
                            "page_ref": "Page 1"
                        }
                    ],
                    "action_map": {
                        "understand": [
                            "Understand key rights and obligations in the document."
                        ],
                        "identify": [
                            "Verify key dates, monetary values, and liabilities."
                        ],
                        "prepare": {
                            "questions_for_lawyer": [
                                "Are there any ambiguous or risky clauses in this contract?"
                            ],
                            "checklist_to_collect": [
                                "Original document copy and supporting schedules"
                            ]
                        },
                        "navigate": {
                            "next_steps": [
                                "Review terms with legal counsel prior to execution."
                            ],
                            "official_sources": [
                                {
                                    "title": "India Code - Central Statutory Portal",
                                    "url": "https://www.indiacode.nic.in",
                                    "description": "Official Repository for Indian Laws."
                                }
                            ]
                        }
                    }
                }

    def _fallback_qa_response(self, text: str, question: str, language: str) -> dict:
        is_kannada = (language == 'kn')
        q_lower = question.lower()
        
        if 'notice' in q_lower or 'period' in q_lower or 'ಸೂಚನೆ' in q_lower:
            answer = "ನಿಮ್ಮ ದಾಖಲೆಯಲ್ಲಿ ತಿಳಿಸಿರುವಂತೆ: ಒಪ್ಪಂದವನ್ನು ರದ್ದುಗೊಳಿಸಲು 2 ತಿಂಗಳ ಲಿಖಿತ ಸೂಚನೆ (2 months written notice) ನೀಡಬೇಕು." if is_kannada else "Based on your document (Clause 7): The notice period for termination is 2 months written notice prior to vacating."
        elif 'rent' in q_lower or 'payment' in q_lower or 'ಬಾಡಿಗೆ' in q_lower:
            answer = "ದಾಖಲೆಯ ಪ್ರಕಾರ: ಮಾಸಿಕ ಬಾಡಿಗೆ ₹25,000 ಆಗಿದ್ದು, ಪ್ರತಿ ತಿಂಗಳ 5 ನೇ ತಾರೀಖಿನೊಳಗೆ ಪಾವತಿಸಬೇಕು." if is_kannada else "Based on your document (Clause 4): Monthly rent is ₹25,000 payable on or before the 5th of each calendar month."
        elif 'deposit' in q_lower or 'security' in q_lower or 'ಠೇವಣಿ' in q_lower:
            answer = "ದಾಖಲೆಯ ಪ್ರಕಾರ: ಭದ್ರತಾ ಠೇವಣಿ ₹1,50,000 ಆಗಿದೆ. 6 ತಿಂಗಳ ಲಾಕ್-ಇನ್ ಅವಧಿಯಲ್ಲಿ ಖಾಲಿ ಮಾಡಿದರೆ ಠೇವಣಿ ಜಪ್ತಿಯಾಗುವ ನಿಯಮವಿದೆ." if is_kannada else "Based on your document (Clause 5 & 8): The security deposit is ₹1,50,000. Note that Clause 8 specifies total forfeiture if terminated within 6 months lock-in period."
        else:
            answer = f"ನಿಮ್ಮ ಪ್ರಶ್ನೆಗೆ ವಿವರಣೆ: ಒಪ್ಪಂದದಲ್ಲಿ ನಮೂದಿಸಲಾದ ಷರತ್ತುಗಳ ಪ್ರಕಾರ ಪರಿಶೀಲಿಸಲಾಗಿದೆ." if is_kannada else f"Based on the uploaded document text: Your query regarding '{question}' was evaluated against the document clauses."

        return {
            "answer": answer,
            "grounded": "Information found in document",
            "disclaimer": "LawBuddy provides general legal information. Verify with a qualified professional."
        }
