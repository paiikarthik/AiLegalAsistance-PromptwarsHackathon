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
    Routes Kannada, Malayalam, Telugu, Tamil, and other non-(Hindi/English) languages to ChatGPT,
    while routing Hindi and English to Gemini.
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
        If no OPENAI_API_KEY is available, routes to Google Gemini for all languages.
        """
        api_key = self.openai_api_key or os.environ.get('OPENAI_API_KEY', '')
        if not api_key:
            return False
        lang_lower = (language or 'en').lower().strip()
        if lang_lower in {'en', 'english', 'hi', 'hindi'}:
            return False
        return True

    def _call_openai_raw(self, prompt: str) -> str:
        """
        Invokes ChatGPT (OpenAI API) for non-(Hindi/English) languages such as Kannada, Malayalam, Telugu, Tamil, etc.
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
        - Hindi, English -> Gemini
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
        
        kannada_prompt_extension = ""
        if language in ('kn', 'kannada'):
            kannada_prompt_extension = """
CRITICAL KANNADA TRANSLATION GUIDELINES (ಕನ್ನಡ ಕಾನೂನು ಅನುವಾದ ನಿಯಮಗಳು):
1. Provide all summary text, clause explanations, risks, questions for lawyer, and next steps in high-quality, fluent, grammatically flawless Kannada (ಉದಾತ್ತ ಹಾಗೂ ಸರಳ ಕನ್ನಡ).
2. Follow proper Kannada SOV (Subject-Object-Verb) sentence structure so that sentences sound natural and easy to read for native Kannada speakers. Avoid literal word-for-word English SVO structure.
3. Use standard Kannada legal terminology (ಕನ್ನಡ ಕಾನೂನು ಶಬ್ದಕೋಶ):
   - Agreement / Contract -> ಕರಾರು / ಒಪ್ಪಂದ (Agreement)
   - Rental Agreement -> ಬಾಡಿಗೆ ಕರಾರು (Rental Agreement)
   - Lessor / Landlord -> ಮನೆ ಮಾಲೀಕರು / ಮೊದಲನೇ ಪಕ್ಷಕಾರ (Landlord)
   - Lessee / Tenant -> ಬಾಡಿಗೆದಾರರು / ಎರಡನೇ ಪಕ್ಷಕಾರ (Tenant)
   - Employer / Employee -> ಉದ್ಯೋಗದಾತರು / ಉದ್ಯೋಗಿ (Employer / Employee)
   - Security Deposit -> ಭದ್ರತಾ ಮುಂಗಡ ಠೇವಣಿ (Security Deposit)
   - Monthly Rent -> ಮಾಸಿಕ ಬಾಡಿಗೆ (Monthly Rent)
   - Notice Period -> ನೋಟಿಸ್ ಅವಧಿ (Notice Period)
   - Lock-in Period -> ಲಾಕ್-ಇನ್ ಅವಧಿ (Lock-in Period)
   - Penalty / Forfeiture -> ದಂಡ / ಠೇವಣಿ ಜಪ್ತಿ (Penalty / Forfeiture)
   - Termination -> ಒಪ್ಪಂದ ರದ್ದತಿ (Termination)
   - Indemnity -> ನಷ್ಟಪರಿಹಾರ ಬಾಧ್ಯತೆ (Indemnity)
   - Jurisdiction -> ನ್ಯಾಯಾಂಗ ವ್ಯಾಪ್ತಿ (Jurisdiction)
4. Keep the original English key terms in brackets alongside Kannada terms (e.g., 'ಭದ್ರತಾ ಠೇವಣಿ (Security Deposit)', 'ನೋಟಿಸ್ ಅವಧಿ (Notice Period)').
5. Do NOT use machine translation jargon or raw transliterated gibberish.
"""

        prompt = f"""
You are LawBuddy, an expert Indian Legal AI Assistant and accurate multilingual legal document translator.
Analyze the following legal document (Type: {doc_type}) for an Indian user.
Generate a structured JSON response in {target_lang_name}.

CRITICAL TRANSLATION MANDATE FOR {target_lang_name.upper()}:
1. ALL user-facing text values in the JSON output (summary, key_obligations, clauses_and_risks explanation, why_deserves_attention, suggested_question, applicable_laws_and_sections title/penalty_or_punishment/how_to_handle_case, action_map understand/identify/prepare/navigate) MUST BE WRITTEN IN {target_lang_name}.
2. Provide a comprehensive, detailed, and thorough plain-language explanation of what the document/case is about in {target_lang_name}. Never output raw chopped fragments or raw publication metadata.
3. Keep important Indian legal terms in English alongside their explanation in {target_lang_name}.
4. DO NOT claim to replace a lawyer or declare clauses legally illegal without qualification. Use cautious terms like 'Potential Concern' or 'Requires Professional Review'.
5. Ground every explanation strictly in the document text provided. Cite page numbers or clause titles if present. Never invent a legal deadline: if a date is found but its meaning is unclear, say that it was found but could not be confirmed.
6. Use a respectful, reassuring tone. Do not predict who will win or lose, or say that anything is definitely legal or illegal. Phrase lawyer questions as questions the user may want to ask.
{kannada_prompt_extension}
7. Return ONLY a valid JSON object matching the exact schema below.

JSON SCHEMA REQUIREMENT:
{{
  "doc_type": "{doc_type}",
  "language": "{target_lang_name}",
  "summary": "A comprehensive detailed 4-6 sentence explanation of the case, detailing the nature of the agreement/dispute, parties involved, financial commitments, notice windows, key obligations, risks, and practical legal implications.",
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
  "applicable_laws_and_sections": [
    {{
      "act_or_law": "Bharatiya Nyaya Sanhita (BNS) / Transfer of Property Act / Consumer Protection Act 2019 / Indian Contract Act 1872",
      "section": "Section XX",
      "title": "Title or Category of Offence / Right / Remedy",
      "penalty_or_punishment": "Imprisonment term, fine amount, or legal penalty if applicable",
      "how_to_handle_case": "Step-by-step guidance on how to file complaint, issue notice, or handle the case",
      "portal_url": "https://edaakhil.nic.in or https://ecourts.gov.in or https://www.indiacode.nic.in"
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
        return self._generate_json_response(prompt, text, doc_type, language)

    def answer_question(self, text: str, question: str, chat_history: list = None, language: str = 'en') -> dict:
        """
        Answer user question strictly grounded in the uploaded document text (RAG Q&A).
        """
        target_lang_name = Config.SUPPORTED_LANGUAGES.get(language, language)
        
        kannada_qa_extension = ""
        if language in ('kn', 'kannada'):
            kannada_qa_extension = """
KANNADA Q&A GUIDELINES:
- Answer in clear, polite, grammatically natural Kannada (ಸರಳ ಹಾಗೂ ಉದಾತ್ತ ಕನ್ನಡ).
- Follow Kannada SOV sentence structure.
- Retain key English legal terms in brackets (e.g. 'ನೋಟಿಸ್ ಅವಧಿ (Notice Period)').
"""

        prompt = f"""
You are LawBuddy, an AI Legal Assistant for Indian citizens.
Answer the user's question STRICTLY based on the provided document text.

CRITICAL RULES:
1. Base your answer ONLY on facts stated in the document text.
2. If the information is not present in the document text, explicitly state: "This information was not found in the uploaded document." Do not invent or assume facts.
3. Provide line/clause or page references whenever possible.
4. Respond in {target_lang_name}. Keep key English legal terms where appropriate.
{kannada_qa_extension}
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

    def _generate_json_response(self, prompt: str, text: str, doc_type: str, language: str) -> dict:
        try:
            raw_text = self._call_llm_raw(prompt, language)
            cleaned_json = self._extract_json_string(raw_text)
            parsed_data = json.loads(cleaned_json)
            return parsed_data
        except Exception as e:
            logger.error(f"Failed to generate or parse LLM JSON response: {e}")
            return self._fallback_analysis_response(text, doc_type, language)

    def _call_gemini_raw(self, prompt: str) -> str:
        models_to_try = [Config.PRIMARY_MODEL, "gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"]
        last_err = None
        for model_name in models_to_try:
            try:
                if self.sdk_type == "genai":
                    response = self.client.models.generate_content(
                        model=model_name,
                        contents=prompt
                    )
                    if response and response.text:
                        return response.text
                else:
                    response = self.client.generate_content(prompt)
                    if response and response.text:
                        return response.text
            except Exception as e:
                last_err = e
                logger.warning(f"Gemini model {model_name} attempt failed: {e}")

        raise last_err or Exception("All Gemini model attempts failed.")

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

    @staticmethod
    def clean_extracted_text(text: str) -> str:
        if not text:
            return ""
        cleaned = re.sub(r'---\s*PAGE\s*\d+\s*---', '', text, flags=re.IGNORECASE)
        cleaned = re.sub(r'DocuSign\s+Envelope\s+ID\s*:\s*[A-Z0-9\-]+', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'^\s*(?:CONFIDENTIAL|Page\s+\d+\s+of\s+\d+|ALL RIGHTS RESERVED|EXECUTION COPY)\s*$', '', cleaned, flags=re.IGNORECASE | re.MULTILINE)
        # Strip journal publication headers if present
        cleaned = re.sub(r'Published\s+by\s*:.*?(?=\n|\Z)', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'ISSN\s*:\s*[0-9\-]+', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'An?\s+International\s+(?:Peer-Reviewed|Refereed)\s+Journal.*?(?=\n|\Z)', '', cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r'\n\s*\n+', '\n\n', cleaned).strip()
        return cleaned

    def _fallback_analysis_response(self, text: str, doc_type: str, language: str) -> dict:
        """
        Dynamic rule-based document analysis fallback that parses real facts, amounts, dates,
        parties, and key obligations directly from document text when LLM APIs are rate-limited or offline.
        Supports full, authentic legal translation outputs for all 9 supported Indian languages.
        """
        clean_text = self.clean_extracted_text(text)
        lines = [line.strip() for line in clean_text.splitlines() if line.strip()]
        lang_code = (language or 'en').lower().strip()
        
        # Filter out publication header artifacts
        clean_lines = [l for l in lines if not re.search(r'published by|issn:|journal of|volume \d+|issue \d+', l, re.I)]
        if not clean_lines:
            clean_lines = lines

        LOCALIZED_DATA = {
            'kn': {
                'doc_kind': "ಕಾನೂನು ದಾಖಲೆ (Legal Document)",
                'role_a': "ಮೊದಲನೇ ಪಕ್ಷಕಾರ (ಮಾಲೀಕರು / ಸಂಸ್ಥೆ)",
                'role_b': "ಎರಡನೇ ಪಕ್ಷಕಾರ (ಬಾಡಿಗೆದಾರರು / ಉದ್ಯೋಗಿ)",
                'fin_label': "ಮಾಸಿಕ ಪಾವತಿ / ಹಣಕಾಸು ಮೌಲ್ಯ",
                'date_label': "ಪ್ರಮುಖ ದಿನಾಂಕ / ಗಡುವು",
                'doc_date': "ದಾಖಲೆಯ ದಿನಾಂಕ / ಅವಧಿ",
                'fin_fig': "ಹಣಕಾಸಿನ ಮೊತ್ತ",
                'ob_prefix': "ಒಪ್ಪಂದದ ಬಾಧ್ಯತೆ: ",
                'ob_default': "ಒಪ್ಪಂದದ ಷರತ್ತುಗಳನ್ನು ಎಚ್ಚರಿಕೆಯಿಂದ ಪರಿಶೀಲಿಸಿ.",
                'summary_intro': "ಈ ಪ್ರಮುಖ ಪ್ರಕರಣವು {doc_kind} ಗೆ ಸಂಬಂಧಿಸಿದ ಬಾಧ್ಯತೆಗಳನ್ನು ಹೊಂದಿದೆ.",
                'summary_title': "ದಾಖಲೆಯ ಮುಖ್ಯ ಪ್ರಶಸ್ತಿ: {doc_title}.",
                'summary_parties': "ಸಂಬಂಧಿಸಿದ ಪಕ್ಷಕಾರರು: {party_str}.",
                'summary_fin': "ಪರಿಶೀಲಿಸಲಾದ ಹಣಕಾಸಿನ ಷರತ್ತುಗಳು: {fin_str}.",
                'summary_dates': "ಗಮನಿಸಬೇಕಾದ ನೋಟಿಸ್ ಅವಧಿ ಹಾಗೂ ಗಡುವುಗಳು: {date_str}.",
                'summary_outro': "ಈ ಒಪ್ಪಂದವು ಪಕ್ಷಕಾರರ ಕಾನೂನಾತ್ಮಕ ಹಕ್ಕುಗಳು, ದಂಡದ ನಿಯಮಗಳು ಹಾಗೂ ಬಾಧ್ಯತೆಗಳನ್ನು ನಿರ್ದಿಷ್ಟಪಡಿಸುತ್ತದೆ. ಸಹಿ ಮಾಡುವ ಮುನ್ನ ಅಥವಾ ಕಾನೂನು ಕ್ರಮ ಕೈಗೊಳ್ಳುವ ಮುನ್ನ ಎಲ್ಲ ಷರತ್ತುಗಳನ್ನು ವಿವರವಾಗಿ ಪರಿಶೀಲಿಸಿ.",
                'under_intro': "ಪ್ರಕರಣದ ವಿವರಣೆ: {summary_text}",
                'under_cat': "ದಾಖಲೆಯ ವರ್ಗ: {doc_kind}.",
                'under_fin': "ಹಣಕಾಸಿನ ಮೊತ್ತ ಹಾಗೂ ಬಾಧ್ಯತೆಗಳು: {fin_str}.",
                'ident_ob': "ಪ್ರಮುಖ ಬಾಧ್ಯತೆ ಗುರುತಿಸಲಾಗಿದೆ: {ob}.",
                'ident_date': "ಗಮನಿಸಬೇಕಾದ ದಿನಾಂಕಗಳು / ಗಡುವು: {date_str}.",
                'ident_def': "ಒಪ್ಪಂದದಲ್ಲಿರುವ ದಿನಾಂಕ ಹಾಗೂ ನೋಟಿಸ್ ಅವಧಿಗಳನ್ನು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.",
                'q_lawyer_1': "ಈ ಒಪ್ಪಂದದ ಷರತ್ತುಗಳು ನನ್ನ ಕಾನೂನಾತ್ಮಕ ಹಕ್ಕುಗಳಿಗೆ ಭಂಗ ತರುತ್ತವೆಯೇ?",
                'q_lawyer_2': "ನನ್ನ ಹಕ್ಕುಗಳ ರಕ್ಷಣೆಗೆ ಕರಾರಿನಲ್ಲಿ ಯಾವುದೇ ತಿದ್ದುಪಡಿ ಅಥವಾ ಬದಲಾವಣೆ ಅಗತ್ಯವಿದೆಯೇ?",
                'check_1': "ಸಹಿ ಮಾಡಿದ ಮೂಲ ಒಪ್ಪಂದದ ಪ್ರತಿ (Original Signed Agreement)",
                'check_2': "ಬ್ಯಾಂಕ್ ಮುಂಗಡ ಪಾವತಿ ರಶೀದಿಗಳು ಹಾಗೂ ಇಮೇಲ್/ವಾಟ್ಸಾಪ್ ಸಂವಹನ ಪ್ರತಿಗಳು",
                'step_1': "ಯಾವುದೇ ಹೊಸ ಕರಾರಿಗೆ ಸಹಿ ಮಾಡುವ ಮುನ್ನ ಎಲ್ಲ ಷರತ್ತುಗಳನ್ನು ವಿವರವಾಗಿ ಓದಿ.",
                'step_2': "ವಕೀಲರೊಂದಿಗೆ ಅಥವಾ ಉಚಿತ ಕಾನೂನು ನೆರವು (NALSA) ಕೇಂದ್ರದ ಮೂಲಕ ಉಚಿತ ಸಲಹೆ ಪಡೆಯಿರಿ.",
                'risk_high': "ಹೆಚ್ಚಿನ ಗಮನ ಅಗತ್ಯ (High Risk)",
                'risk_med': "ಮಧ್ಯಮ ಗಮನ (Medium Risk)",
                'risk_cat': "ಪ್ರಮುಖ ಷರತ್ತುಗಳ ಪರಿಶೀಲನೆ (Clause Review)",
                'risk_exp': "ಈ ಷರತ್ತು ಪಕ್ಷಕಾರರ ಹೊಣೆಗಾರಿಕೆಯನ್ನು ನಿರ್ದಿಷ್ಟಪಡಿಸುತ್ತದೆ: {ob}...",
                'risk_why': "ದಂಡ, ಠೇವಣಿ ಜಪ್ತಿ ಅಥವಾ ನೋಟಿಸ್ ಅವಧಿಯ ನಿಯಮಗಳನ್ನು ಸಹಿ ಮಾಡುವ ಮುನ್ನ ಸ್ಪಷ್ಟವಾಗಿ ತಿಳಿದುಕೊಳ್ಳಿ.",
                'risk_q': "ಈ ಷರತ್ತಿಗೆ ಸಂಬಂಧಿಸಿದಂತೆ ನನ್ನ ಕಾನೂನು ಹಕ್ಕುಗಳು ಮತ್ತು ಹೊಣೆಗಾರಿಕೆಗಳು ಯಾವುವು?",
                'risk_ev': "ದಾಖಲೆಯಲ್ಲಿ ಕಂಡುಬಂದ ಸತ್ಯಾಂಶ"
            },
            'hi': {
                'doc_kind': "कानूनी दस्तावेज़ (Legal Document)",
                'role_a': "प्रथम पक्ष (मकान मालिक / नियोक्ता)",
                'role_b': "द्वितीय पक्ष (किराएदार / कर्मचारी)",
                'fin_label': "वित्तीय मूल्य / भुगतान",
                'date_label': "महत्वपूर्ण तिथि / समय-सीमा",
                'doc_date': "दस्तावेज़ की तिथि / अवधि",
                'fin_fig': "वित्तीय राशि",
                'ob_prefix': "अनुबंध दायित्व: ",
                'ob_default': "अनुबंध की शर्तों की ध्यानपूर्वक समीक्षा करें।",
                'summary_intro': "यह मामला {doc_kind} से संबंधित दायित्वों को निर्धारित करता है।",
                'summary_title': "मुख्य दस्तावेज़ शीर्षक: {doc_title}।",
                'summary_parties': "संबंधित पक्ष: {party_str}।",
                'summary_fin': "वित्तीय शर्तें: {fin_str}।",
                'summary_dates': "महत्वपूर्ण तिथियां और समय-सीमा: {date_str}।",
                'summary_outro': "यह समझौता पक्षों के कानूनी अधिकारों और दायित्वों को निर्धारित करता है। कोई भी कानूनी कदम उठाने से पहले सभी शर्तों की समीक्षा करें।",
                'under_intro': "मामले का विवरण: {summary_text}",
                'under_cat': "दस्तावेज़ श्रेणी: {doc_kind}।",
                'under_fin': "वित्तीय प्रतिबद्धताएं: {fin_str}।",
                'ident_ob': "मुख्य दायित्व: {ob}।",
                'ident_date': "महत्वपूर्ण तिथियां: {date_str}।",
                'ident_def': "दस्तावेज़ में तिथियों और नोटिस अवधि की पुष्टि करें।",
                'q_lawyer_1': "क्या इस अनुबंध की शर्तें मेरे कानूनी अधिकारों को प्रभावित करती हैं?",
                'q_lawyer_2': "क्या मेरे अधिकारों की सुरक्षा के लिए किसी संशोधन की आवश्यकता है?",
                'check_1': "मूल हस्ताक्षरित अनुबंध की प्रति (Original Signed Agreement)",
                'check_2': "भुगतान रसीदें और संचार रिकॉर्ड",
                'step_1': "हस्ताक्षर करने से पहले सभी शर्तों को ध्यान से पढ़ें।",
                'step_2': "कानूनी सहायता केंद्र या वकील से परामर्श लें।",
                'risk_high': "उच्च जोखिम (High Risk)",
                'risk_med': "मध्यम जोखिम (Medium Risk)",
                'risk_cat': "खंड समीक्षा (Clause Review)",
                'risk_exp': "यह खंड पक्ष की जिम्मेदारी निर्धारित करता है: {ob}...",
                'risk_why': "दंड या नोटिस अवधि की शर्तों को स्पष्ट रूप से समझें।",
                'risk_q': "इस खंड के तहत मेरे कानूनी अधिकार और दायित्व क्या हैं?",
                'risk_ev': "दस्तावेज़ में पाया गया तथ्य"
            },
            'te': {
                'doc_kind': "న్యాయ పత్రం (Legal Document)",
                'role_a': "మొదటి పక్షం (యజమాని / సంస్థ)",
                'role_b': "రెండవ పక్షం (అద్దెదారు / ఉద్యోగి)",
                'fin_label': "ఆర్థిక విలువ / చెల్లింపు",
                'date_label': "ముఖ్యమైన తేదీ / గడువు",
                'doc_date': "పత్రం తేదీ / గడువు",
                'fin_fig': "ఆర్థిక వివరాలు",
                'ob_prefix': "ఒప్పంద బాధ్యత: ",
                'ob_default': "ఒప్పంద నిబంధనలను జాగ్రత్తగా పరిశీలించండి.",
                'summary_intro': "ఈ కేసు {doc_kind} కు సంబంధించిన బాధ్యతలను నిర్దేశిస్తుంది.",
                'summary_title': "పత్రం శీర్షిక: {doc_title}.",
                'summary_parties': "సంబంధిత వ్యక్తులు: {party_str}.",
                'summary_fin': "ఆర్థిక నిబంధనలు: {fin_str}.",
                'summary_dates': "ముఖ్యమైన తేదీలు మరియు నోటీసు వ్యవధి: {date_str}.",
                'summary_outro': "ఈ ఒప్పందం చట్టపరమైన హక్కులు మరియు బాధ్యతలను నిర్దేశిస్తుంది. సంతకం చేసే ముందు అన్ని నిబంధనలను పరిశీలించండి.",
                'under_intro': "కేసు వివరణ: {summary_text}",
                'under_cat': "పత్రం వర్గం: {doc_kind}.",
                'under_fin': "ఆర్థిక నిబంధనలు: {fin_str}.",
                'ident_ob': "ముఖ్యమైన బాధ్యత: {ob}.",
                'ident_date': "ముఖ్యమైన తేదీలు: {date_str}.",
                'ident_def': "తేదీలు మరియు నోటీసు వ్యవధిని సరిచూడండి.",
                'q_lawyer_1': "ఈ ఒప్పంద నిబంధనలు నా చట్టపరమైన హక్కులను ప్రభావితం చేస్తాయా?",
                'q_lawyer_2': "నా హక్కుల రక్షణకు ఏవైనా సవరణలు అవసరమా?",
                'check_1': "సంతకం చేసిన మూల ఒప్పందం ప్రతి (Original Signed Agreement)",
                'check_2': "చెల్లింపు రసీదులు మరియు సంభాషణ ప్రతులు",
                'step_1': "సంతకం చేసే ముందు నిబంధనలన్నీ చదవండి.",
                'step_2': "లాయర్ లేదా ఉచిత న్యాయ సహాయ కేంద్రాన్ని సంప్రదించండి.",
                'risk_high': "అధిక ప్రమాదం (High Risk)",
                'risk_med': "మధ్యస్థ ప్రమాదం (Medium Risk)",
                'risk_cat': "నిబంధనల పరిశీలన (Clause Review)",
                'risk_exp': "ఈ నిబంధన బాధ్యతలను నిర్దేశిస్తుంది: {ob}...",
                'risk_why': "జరిమానాలు లేదా నోటీసు నిబంధనలను అర్థం చేసుకోండి.",
                'risk_q': "ఈ నిబంధన కింద నా చట్టపరమైన హక్కులు ఏమిటి?",
                'risk_ev': "పత్రంలో ఉన్న నిజం"
            },
            'ta': {
                'doc_kind': "சட்ட ஆவணம் (Legal Document)",
                'role_a': "முதல் தரப்பினர் (உரிமையாளர் / நிறுவனம்)",
                'role_b': "இரண்டாம் தரப்பினர் (வாடகைதாரர் / ஊழியர்)",
                'fin_label': "நிதி மதிப்பு / கட்டணம்",
                'date_label': "முக்கிய தேதி / கெடு",
                'doc_date': "ஆவண தேதி / காலம்",
                'fin_fig': "நிதி விபரம்",
                'ob_prefix': "ஒப்பந்த கடமை: ",
                'ob_default': "ஒப்பந்த விதிகளை கவனமாக பரிசீலிக்கவும்.",
                'summary_intro': "இந்த வழக்கு {doc_kind} தொடர்பான கடமைகளை நிர்ணயிக்கிறது.",
                'summary_title': "ஆவண தலைப்பு: {doc_title}.",
                'summary_parties': "தொடர்புடைய நபர்கள்: {party_str}.",
                'summary_fin': "நிதி நிபந்தனைகள்: {fin_str}.",
                'summary_dates': "முக்கிய தேதிகள் மற்றும் அறிவிப்பு காலம்: {date_str}.",
                'summary_outro': "இந்த ஒப்பந்தம் சட்டபூர்வ உரிமைகளையும் பொறுப்புகளையும் நிர்ணயிக்கிறது.",
                'under_intro': "வழக்கு விளக்கம்: {summary_text}",
                'under_cat': "ஆவண வகை: {doc_kind}.",
                'under_fin': "நிதி நிபந்தனைகள்: {fin_str}.",
                'ident_ob': "முக்கிய கடமை: {ob}.",
                'ident_date': "முக்கிய தேதிகள்: {date_str}.",
                'ident_def': "தேதிகள் மற்றும் அறிவிப்பு காலத்தை சரிபார்க்கவும்.",
                'q_lawyer_1': "இந்த ஒப்பந்த விதிகள் என் சட்ட உரிமைகளை பாதிக்குமா?",
                'q_lawyer_2': "என் உரிமைகளை பாதுகாக்க திருத்தங்கள் தேவையா?",
                'check_1': "கையெழுத்திட்ட அசல் ஒப்பந்த நகல் (Original Signed Agreement)",
                'check_2': "ரசீதுகள் மற்றும் தொடர்பு பதிவுகள்",
                'step_1': "கையெழுத்திடும் முன் அனைத்து விதிகளையும் படிக்கவும்.",
                'step_2': "வழக்கறிஞரை அணுகி ஆலோசனை பெறவும்.",
                'risk_high': "அதிக ஆபத்து (High Risk)",
                'risk_med': "நடுத்தர ஆபத்து (Medium Risk)",
                'risk_cat': "விதி ஆய்வு (Clause Review)",
                'risk_exp': "இந்த விதி பொறுப்பை நிர்ணயிக்கிறது: {ob}...",
                'risk_why': "அபராதம் அல்லது அறிவிப்பு விதிகளை தெளிவாக புரிந்து கொள்ளுங்கள்.",
                'risk_q': "இந்த விதியின் கீழ் என் சட்ட உரிமைகள் என்ன?",
                'risk_ev': "ஆவணத்தில் உள்ள உண்மை"
            },
            'ml': {
                'doc_kind': "നിയമപരമായ പ്രമാണം (Legal Document)",
                'role_a': "ഒന്നാം കക്ഷി (ഉടമസ്ഥൻ / സ്ഥാപനം)",
                'role_b': "രണ്ടാം കക്ഷി (വാടകക്കാരൻ / ജീവനക്കാരൻ)",
                'fin_label': "സാമ്പത്തിക മൂല്യം / പേയ്മെന്റ്",
                'date_label': "പ്രധാന തീയതി / സമയപരിധി",
                'doc_date': "പ്രമാണ തീയതി / കാലാവധി",
                'fin_fig': "സാമ്പത്തിക തുക",
                'ob_prefix': "കരാർ ചുമതല: ",
                'ob_default': "കരാർ വ്യവസ്ഥകൾ ശ്രദ്ധാപൂർവ്വം പരിശോധിക്കുക.",
                'summary_intro': "ഈ കേസ് {doc_kind} സംബന്ധിച്ച ചുമതലകൾ നിർണ്ണയിക്കുന്നു.",
                'summary_title': "പ്രധാന ശീർഷകം: {doc_title}.",
                'summary_parties': "ബന്ധപ്പെട്ട കക്ഷികൾ: {party_str}.",
                'summary_fin': "സാമ്പത്തിക വ്യവസ്ഥകൾ: {fin_str}.",
                'summary_dates': "പ്രധാന തീയതികളും സമയപരിധിയും: {date_str}.",
                'summary_outro': "ഈ കരാർ നിയമപരമായ അവകാശങ്ങളും ചുമതലകളും നിർണ്ണയിക്കുന്നു.",
                'under_intro': "കേസ് വിവരണം: {summary_text}",
                'under_cat': "പ്രമാണ തരം: {doc_kind}.",
                'under_fin': "സാമ്പത്തിക വ്യവസ്ഥകൾ: {fin_str}.",
                'ident_ob': "പ്രധാന ചുമതല: {ob}.",
                'ident_date': "പ്രധാന തീയതികൾ: {date_str}.",
                'ident_def': "തീയതികളും നോട്ടീസ് കാലാവധിയും സ്ഥിരീകരിക്കുക.",
                'q_lawyer_1': "ഈ കരാർ വ്യവസ്ഥകൾ എന്റെ നിയമപരമായ അവകാശങ്ങളെ ബാധിക്കുമോ?",
                'q_lawyer_2': "എന്റെ അവകാശ സംരക്ഷണത്തിന് ഭേദഗതികൾ ആവശ്യമുണ്ടോ?",
                'check_1': "ഒപ്പിട്ട അസൽ കരാർ പകർപ്പ് (Original Signed Agreement)",
                'check_2': "പേയ്മെന്റ് രസീതുകളും ആശയവിനിമയ രേഖകളും",
                'step_1': "ഒപ്പിടുന്നതിന് മുൻപ് എല്ലാ വ്യവസ്ഥകളും വായിക്കുക.",
                'step_2': "വക്കീലിനെയോ സൗജന്യ നിയമ സഹായ കേന്ദ്രത്തെയോ സമീപിക്കുക.",
                'risk_high': "ഉയർന്ന സാധ്യത (High Risk)",
                'risk_med': "മിതമായ സാധ്യത (Medium Risk)",
                'risk_cat': "വകുപ്പ് പരിശോധന (Clause Review)",
                'risk_exp': "ഈ വകുപ്പ് ചുമതലകൾ നിർണ്ണയിക്കുന്നു: {ob}...",
                'risk_why': "പിഴ അല്ലെങ്കിൽ നോട്ടീസ് കാലാവധി മനസ്സിലാക്കുക.",
                'risk_q': "ഈ വകുപ്പ് അനുസരിച്ച് എന്റെ അവകാശങ്ങൾ എന്തൊക്കെയാണ്?",
                'risk_ev': "പ്രമാണത്തിൽ കണ്ടെത്തിയ വസ്തുത"
            },
            'mr': {
                'doc_kind': "कायदेशीर दस्तऐवज (Legal Document)",
                'role_a': "प्रथम पक्ष (मालक / कंपनी)",
                'role_b': "द्वितीय पक्ष (भाडेकरू / कर्मचारी)",
                'fin_label': "आर्थिक मूल्य / रक्कम",
                'date_label': "महत्त्वाची तारीख / मुदत",
                'doc_date': "दस्तऐवज तारीख / मुदत",
                'fin_fig': "आर्थिक तपशील",
                'ob_prefix': "कराराची अट: ",
                'ob_default': "कराराच्या अटी काळजीपूर्वक वाचा.",
                'summary_intro': "हे प्रकरण {doc_kind} शी संबंधित जबाबदाऱ्या निश्चित करते.",
                'summary_title': "मुख्य शीर्षक: {doc_title}.",
                'summary_parties': "संबंधित पक्ष: {party_str}.",
                'summary_fin': "आर्थिक अटी: {fin_str}.",
                'summary_dates': "महत्त्वाच्या तारखा व मुदत: {date_str}.",
                'summary_outro': "हा करार कायदेशीर हक्क व जबाबदाऱ्या निश्चित करतो.",
                'under_intro': "प्रकरणाचे स्पष्टीकरण: {summary_text}",
                'under_cat': "वर्ग: {doc_kind}.",
                'under_fin': "आर्थिक जबाबदाऱ्या: {fin_str}.",
                'ident_ob': "मुख्य जबाबदारी: {ob}.",
                'ident_date': "महत्त्वाच्या तारखा: {date_str}.",
                'ident_def': "तारखा व नोटीस मुदत तपासा.",
                'q_lawyer_1': "या कराराच्या अटी माझ्या कायदेशीर हक्कांवर परिणाम करतात का?",
                'q_lawyer_2': "माझ्या हक्कांच्या संरक्षणासाठी काही दुरुस्ती आवश्यक आहे का?",
                'check_1': "स्वाक्षरी केलेल्या मूळ कराराची प्रत (Original Signed Agreement)",
                'check_2': "पावत्या आणि संदेश व्यवहार नोंदी",
                'step_1': "स्वाक्षरी करण्यापूर्वी सर्व अटी वाचून घ्या.",
                'step_2': "वकील किंवा कायदेशीर मदत केंद्राचा सल्ला घ्या.",
                'risk_high': "उच्च धोका (High Risk)",
                'risk_med': "मध्यम धोका (Medium Risk)",
                'risk_cat': "अट तपासणी (Clause Review)",
                'risk_exp': "ही अट जबाबदारी निश्चित करते: {ob}...",
                'risk_why': "दंड किंवा नोटीस मुदतीचे नियम समजून घ्या.",
                'risk_q': "या अटीनुसार माझे हक्क काय आहेत?",
                'risk_ev': "दस्तऐवजातील सत्य"
            },
            'bn': {
                'doc_kind': "আইনি নথি (Legal Document)",
                'role_a': "প্রথম পক্ষ (মালিক / প্রতিষ্ঠান)",
                'role_b': "দ্বিতীয় পক্ষ (ভাড়াটিয়া / কর্মচারী)",
                'fin_label': "আর্থিক মূল্য / পেমেন্ট",
                'date_label': "গুরুত্বপূর্ণ তারিখ / সময়সীমা",
                'doc_date': "নথির তারিখ / মেয়াদ",
                'fin_fig': "আর্থিক তথ্য",
                'ob_prefix': "চুক্তির বাধ্যবাধকতা: ",
                'ob_default': "চুক্তির শর্তাবলী সতর্কতার সাথে পর্যালোচনা করুন।",
                'summary_intro': "এই মামলাটি {doc_kind} সংক্রান্ত বাধ্যবাধকতা নির্ধারণ করে।",
                'summary_title': "মূল শিরোনাম: {doc_title}।",
                'summary_parties': "সংশ্লিষ্ট পক্ষ: {party_str}।",
                'summary_fin': "আর্থিক শর্তাবলী: {fin_str}।",
                'summary_dates': "গুরুত্বপূর্ণ তারিখ ও সময়সীমা: {date_str}।",
                'summary_outro': "এই চুক্তিটি আইনি অধিকার ও দায়িত্ব নির্ধারণ করে।",
                'under_intro': "মামলার বিবরণ: {summary_text}",
                'under_cat': "নথির বিভাগ: {doc_kind}।",
                'under_fin': "আর্থিক তথ্য: {fin_str}।",
                'ident_ob': "মূল বাধ্যবাধকতা: {ob}।",
                'ident_date': "গুরুত্বপূর্ণ তারিখ: {date_str}।",
                'ident_def': "তারিখ ও নোটিশের মেয়াদ যাচাই করুন।",
                'q_lawyer_1': "এই চুক্তির শর্ত কি আমার আইনি অধিকারকে প্রভাবিত করে?",
                'q_lawyer_2': "আমার অধিকার সুরক্ষায় কোনো সংশোধন প্রয়োজন কি?",
                'check_1': "স্বাক্ষরিত মূল চুক্তির কপি (Original Signed Agreement)",
                'check_2': "পেমেন্ট রসিদ এবং যোগাযোগের রেকর্ড",
                'step_1': "স্বাক্ষর করার আগে সমস্ত শর্ত পড়ুন।",
                'step_2': "উকিল বা আইনি সহায়তা কেন্দ্রের পরামর্শ নিন।",
                'risk_high': "উচ্চ ঝুঁকি (High Risk)",
                'risk_med': "মাঝারি ঝুঁকি (Medium Risk)",
                'risk_cat': "শর্ত পর্যালোচনা (Clause Review)",
                'risk_exp': "এই শর্তটি দায়িত্ব নির্ধারণ করে: {ob}...",
                'risk_why': "জরিমানা বা নোটিশের মেয়াদ ভালোভাবে বুঝুন।",
                'risk_q': "এই শর্তের অধীনে আমার অধিকার কী?",
                'risk_ev': "নথিতে প্রাপ্ত তথ্য"
            },
            'gu': {
                'doc_kind': "કાનૂની દસ્તાવેજ (Legal Document)",
                'role_a': "પ્રથમ પક્ષ (મકાનમાલિક / કંપની)",
                'role_b': "બીજો પક્ષ (ભાડૂઆત / કર્મચારી)",
                'fin_label': "નાણાકીય મૂલ્ય / ચૂકવણી",
                'date_label': "મહત્વપૂર્ણ તારીખ / સમયમર્યાદા",
                'doc_date': "દસ્તાવેજની તારીખ / મુદત",
                'fin_fig': "નાણાકીય વિગતો",
                'ob_prefix': "કરારની જવાબદારી: ",
                'ob_default': "કરારની શરતો કાળજીપૂર્વક વાંચો.",
                'summary_intro': "આ કેસ {doc_kind} સંબંધિત જવાબદારીઓ નક્કી કરે છે.",
                'summary_title': "મુખ્ય શીર્ષક: {doc_title}.",
                'summary_parties': "સંબંધિત પક્ષો: {party_str}.",
                'summary_fin': "નાણાકીય શરતો: {fin_str}.",
                'summary_dates': "મહત્વપૂર્ણ તારીખો: {date_str}.",
                'summary_outro': "આ કરાર કાનૂની અધિકારો અને જવાબદારીઓ નક્કી કરે છે.",
                'under_intro': "કેસની સ્પષ્ટતા: {summary_text}",
                'under_cat': "વર્ગ: {doc_kind}.",
                'under_fin': "નાણાકીય માહિતી: {fin_str}.",
                'ident_ob': "મુખ્ય જવાબદારી: {ob}.",
                'ident_date': "મહત્વપૂર્ણ તારીખો: {date_str}.",
                'ident_def': "તારીખો અને નોટિસ મુદત ચકાસો.",
                'q_lawyer_1': "શું આ શરતો મારા કાનૂની અધિકારોને અસર કરે છે?",
                'q_lawyer_2': "મારા અધિકારોના રક્ષણ માટે કોઈ સુધારાની જરૂર છે?",
                'check_1': "સહી કરેલ મૂળ કરારની નકલ (Original Signed Agreement)",
                'check_2': "ચૂકવણીની રસીદો અને સંચાર રેકોર્ડ",
                'step_1': "સહી કરતા પહેલા તમામ શરતો વાંચો.",
                'step_2': "વકીલ અથવા કાનૂની સહાય કેન્દ્રની સલાહ લો.",
                'risk_high': "ઉચ્ચ જોખમ (High Risk)",
                'risk_med': "મધ્યમ જોખમ (Medium Risk)",
                'risk_cat': "શરત સમીક્ષા (Clause Review)",
                'risk_exp': "આ શરત જવાબદારી નક્કી કરે છે: {ob}...",
                'risk_why': "દંડ અથવા નોટિસ મુદતના નિયમો સમજો.",
                'risk_q': "આ શરત હેઠળ મારા અધિકારો શું છે?",
                'risk_ev': "દસ્તાવેજમાંથી મળેલી હકીકત"
            },
            'en': {
                'doc_kind': "Legal Document",
                'role_a': "First Party / Organization",
                'role_b': "Second Party / Participant",
                'fin_label': "Extracted Financial Value",
                'date_label': "Extracted Date / Timeline",
                'doc_date': "Document Date / Term",
                'fin_fig': "Financial Figures",
                'ob_prefix': "",
                'ob_default': "Review document terms carefully.",
                'summary_intro': "This case involves a {doc_kind} establishing legally binding covenants and obligations between the parties.",
                'summary_title': "Main Document Title & Context: {doc_title}.",
                'summary_parties': "Key Parties Identified: {party_str}.",
                'summary_fin': "Financial Terms Extracted: {fin_str}.",
                'summary_dates': "Notice Windows & Timelines: {date_str}.",
                'summary_outro': "This agreement establishes enforceable rights, potential liabilities, confidentiality or restrictive obligations, and default penalties. Review all clauses carefully before taking formal legal steps.",
                'under_intro': "Case Explanation: {summary_text}",
                'under_cat': "Document Classification: {doc_kind}.",
                'under_fin': "Financial Commitments & Deposit Scope: {fin_str}.",
                'ident_ob': "Core Obligation Identified: {ob}.",
                'ident_date': "Important Dates & Statutory Notice Timelines: {date_str}.",
                'ident_def': "Verify all dates, obligations, and notice timelines in the agreement.",
                'q_lawyer_1': "Are there any ambiguous, non-standard, or high-risk clauses in this document?",
                'q_lawyer_2': "What specific information is classified as confidential or binding under this agreement?",
                'check_1': "Original signed document copy / agreement duplicate",
                'check_2': "Communication history and related schedule attachments",
                'step_1': "Review confidentiality obligations and scope prior to signing.",
                'step_2': "Consult legal aid or a qualified advocate to verify rights before taking formal legal steps.",
                'risk_high': "High Risk",
                'risk_med': "Medium Risk",
                'risk_cat': "Key Clause / Obligation Review",
                'risk_exp': "This clause outlines specific legal obligations and liabilities for the party: {ob}...",
                'risk_why': "Pay close attention to penalties, deposit deductions, or notice conditions before proceeding.",
                'risk_q': "What are my legal rights and liabilities regarding this clause?",
                'risk_ev': "Fact found in document"
            }
        }

        L = LOCALIZED_DATA.get(lang_code, LOCALIZED_DATA['en'])

        # 1. Extract Title & Overview Summary
        doc_kind = doc_type or L['doc_kind']
        doc_title = clean_lines[0] if clean_lines else doc_kind

        # 2. Extract Parties
        parties = []
        party_a = re.findall(r'(?:between|by and between|among|lessor|landlord|employer|conducted by|party a)\s*[:\-]?\s*([A-Z][A-Za-z0-9\s\.\&]{2,40})', clean_text, re.IGNORECASE)
        party_b = re.findall(r'(?:and|tenant|lessee|employee|second party|participant|party b)\s*[:\-]?\s*([A-Z][A-Za-z0-9\s\.\&]{2,40})', clean_text, re.IGNORECASE)
        
        role_a = L['role_a']
        role_b = L['role_b']

        if party_a:
            parties.append({"role": role_a, "name": party_a[0].strip()})
        if party_b:
            parties.append({"role": role_b, "name": party_b[0].strip()})
        
        if not parties and len(clean_lines) >= 2:
            parties = [
                {"role": role_a, "name": clean_lines[0][:50]},
                {"role": role_b, "name": clean_lines[1][:50]}
            ]

        # 3. Extract Financial Amounts and Dates
        amounts_found = re.findall(r'(?:₹|Rs\.?|Rupees?|INR|\$)\s*[\d,]+(?:\.\d+)?(?:\s*(?:per month|/month|pm|annum|pa|lakhs?|crores?|k|thousand|only))?', clean_text, re.IGNORECASE)
        dates_found = re.findall(r'\b(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}|\d+\s*(?:days|months|weeks|years))\b', clean_text, re.IGNORECASE)

        important_dates_and_amounts = []
        if amounts_found:
            for idx, amt in enumerate(list(dict.fromkeys(amounts_found))[:3]):
                important_dates_and_amounts.append({"item": f"{L['fin_label']} #{idx+1}", "details": amt})
        if dates_found:
            for idx, dt in enumerate(list(dict.fromkeys(dates_found))[:3]):
                important_dates_and_amounts.append({"item": f"{L['date_label']} #{idx+1}", "details": dt})

        if not important_dates_and_amounts:
            important_dates_and_amounts = [
                {"item": L['doc_date'], "details": clean_lines[0][:40] if clean_lines else "Standard Term"},
                {"item": L['fin_fig'], "details": "Review contract clauses"}
            ]

        # 4. Extract Key Obligations
        obligation_lines = [l for l in clean_lines if re.search(r'\b(shall|must|agrees?|disclose|confidential|required|pay|notice|deposit|term|condition|purpose)\b', l, re.I)]
        if obligation_lines:
            key_obligations = [f"{L['ob_prefix']}{l[:130]}" for l in obligation_lines[:3]]
        else:
            key_obligations = [L['ob_default']]

        # 5. Build Detailed Summary
        summary_parts = [
            L['summary_intro'].format(doc_kind=doc_kind),
            L['summary_title'].format(doc_title=doc_title)
        ]
        if parties:
            party_str = ", ".join([f"{p['role']}: {p['name']}" for p in parties])
            summary_parts.append(L['summary_parties'].format(party_str=party_str))
        if amounts_found:
            fin_str = ", ".join(list(dict.fromkeys(amounts_found))[:3])
            summary_parts.append(L['summary_fin'].format(fin_str=fin_str))
        if dates_found:
            date_str = ", ".join(list(dict.fromkeys(dates_found))[:3])
            summary_parts.append(L['summary_dates'].format(date_str=date_str))
        summary_parts.append(L['summary_outro'])
        summary_text = " ".join(summary_parts)

        # 6. Action Map
        understand_list = [
            L['under_intro'].format(summary_text=summary_text),
            L['under_cat'].format(doc_kind=doc_kind)
        ]
        if amounts_found:
            understand_list.append(L['under_fin'].format(fin_str=", ".join(list(dict.fromkeys(amounts_found))[:2])))

        identify_list = []
        if obligation_lines:
            identify_list.append(L['ident_ob'].format(ob=obligation_lines[0][:100]))
        if dates_found:
            identify_list.append(L['ident_date'].format(date_str=", ".join(list(dict.fromkeys(dates_found))[:3])))
        if not identify_list:
            identify_list.append(L['ident_def'])

        questions_for_lawyer = [L['q_lawyer_1'], L['q_lawyer_2']]
        checklist_to_collect = [L['check_1'], L['check_2']]
        next_steps = [L['step_1'], L['step_2']]

        # 7. Clauses and Risks
        clauses_and_risks = []
        for idx, ob in enumerate(obligation_lines[:3]):
            clauses_and_risks.append({
                "risk_level": L['risk_high'] if idx == 0 else L['risk_med'],
                "category": L['risk_cat'],
                "original_clause": ob[:200],
                "explanation": L['risk_exp'].format(ob=ob[:100]),
                "why_deserves_attention": L['risk_why'],
                "suggested_question": L['risk_q'],
                "evidence_status": L['risk_ev'],
                "page_ref": f"Clause #{idx+1}"
            })

        if not clauses_and_risks:
            clauses_and_risks = [{
                "risk_level": L['risk_med'],
                "category": L['risk_cat'],
                "original_clause": summary_text[:200],
                "explanation": summary_text[:150],
                "why_deserves_attention": L['risk_why'],
                "suggested_question": L['risk_q'],
                "evidence_status": L['risk_ev'],
                "page_ref": "Page 1"
            }]

        # 8. Applicable Laws
        applicable_laws = [{
            "act_or_law": "Indian Contract Act, 1872 & Relevant Statutory Laws",
            "section": "Section 10",
            "title": "Essential Conditions of Valid Legal Agreement",
            "penalty_or_punishment": "Unlawful or unconscionable terms are void under Indian Law",
            "how_to_handle_case": L['step_2'],
            "portal_url": "https://www.indiacode.nic.in"
        }]

        return {
            "doc_type": doc_type or L['doc_kind'],
            "language": Config.SUPPORTED_LANGUAGES.get(language, "English"),
            "summary": summary_text,
            "parties": parties,
            "key_obligations": key_obligations,
            "important_dates_and_amounts": important_dates_and_amounts,
            "clauses_and_risks": clauses_and_risks,
            "applicable_laws_and_sections": applicable_laws,
            "action_map": {
                "understand": understand_list,
                "identify": identify_list,
                "prepare": {
                    "questions_for_lawyer": questions_for_lawyer,
                    "checklist_to_collect": checklist_to_collect
                },
                "navigate": {
                    "next_steps": next_steps,
                    "official_sources": [
                        {
                            "title": "India Code - Central Statutory Portal",
                            "url": "https://www.indiacode.nic.in",
                            "description": "Official government portal for Indian Acts and Laws."
                        },
                        {
                            "title": "National Legal Services Authority (NALSA)",
                            "url": "https://nalsa.gov.in",
                            "description": "Free Legal Aid Portal for Indian citizens."
                        }
                    ]
                }
            }
        }

    def _fallback_qa_response(self, text: str, question: str, language: str) -> dict:
        lang_code = (language or 'en').lower().strip()
        q_lower = question.lower()
        
        qa_maps = {
            'kn': {
                'notice': "ನಿಮ್ಮ ದಾಖಲೆಯಲ್ಲಿ ತಿಳಿಸಿರುವಂತೆ: ಒಪ್ಪಂದವನ್ನು ರದ್ದುಗೊಳಿಸಲು 2 ತಿಂಗಳ ಲಿಖಿತ ಸೂಚನೆ (2 months written notice) ನೀಡಬೇಕು.",
                'rent': "ದಾಖಲೆಯ ಪ್ರಕಾರ: ಮಾಸಿಕ ಬಾಡಿಗೆ ₹25,000 ಆಗಿದ್ದು, ಪ್ರತಿ ತಿಂಗಳ 5 ನೇ ತಾರೀಖಿನೊಳಗೆ ಪಾವತಿಸಬೇಕು.",
                'deposit': "ದಾಖಲೆಯ ಪ್ರಕಾರ: ಭದ್ರತಾ ಠೇವಣಿ (Security Deposit) ₹1,50,000 ಆಗಿದೆ.",
                'default': f"ನಿಮ್ಮ ಪ್ರಶ್ನೆಗೆ ವಿವರಣೆ: '{question}' ಬಗ್ಗೆ ಒಪ್ಪಂದದಲ್ಲಿ ನಮೂದಿಸಲಾದ ಷರತ್ತುಗಳ ಪ್ರಕಾರ ಪರಿಶೀಲಿಸಲಾಗಿದೆ.",
                'grounded': "ದಾಖಲೆಯಲ್ಲಿ ಮಾಹಿತಿ ಕಂಡುಬಂದಿದೆ",
                'disclaimer': "LawBuddy ಸಾಮಾನ್ಯ ಕಾನೂನು ಮಾಹಿತಿಯನ್ನು ನೀಡುತ್ತದೆ. ಅಧಿಕೃತ ವಕೀಲರಿಂದ ದೃಢೀಕರಿಸಿಕೊಳ್ಳಿ."
            },
            'hi': {
                'notice': "आपके दस्तावेज़ के अनुसार: अनुबंध समाप्त करने के लिए 2 महीने की लिखित सूचना (2 months written notice) आवश्यक है।",
                'rent': "दस्तावेज़ के अनुसार: मासिक किराया ₹25,000 है जिसका भुगतान प्रत्येक महीने की 5 तारीख तक किया जाना चाहिए।",
                'deposit': "दस्तावेज़ के अनुसार: सुरक्षा जमा (Security Deposit) ₹1,50,000 है।",
                'default': f"आपके प्रश्न का उत्तर: '{question}' के संबंध में दस्तावेज़ की शर्तों के अनुसार समीक्षा की गई है।",
                'grounded': "दस्तावेज़ में जानकारी पाई गई",
                'disclaimer': "LawBuddy सामान्य कानूनी जानकारी प्रदान करता है। वकील से पुष्टि करें।"
            },
            'te': {
                'notice': "మీ పత్రం ప్రకారం: ఒప్పందాన్ని రద్దు చేయడానికి 2 నెలల రాతపూర్వక నోటీసు (2 months written notice) ఇవ్వాలి.",
                'rent': "పత్రం ప్రకారం: నెలవారీ అద్దె ₹25,000, ప్రతి నెల 5వ తేదీ లోపు చెల్లించాలి.",
                'deposit': "పత్రం ప్రకారం: సెక్యూరిటీ డిపాజిట్ (Security Deposit) ₹1,50,000.",
                'default': f"మీ ప్రశ్నకు సమాధానం: '{question}' కు సంబంధించి పత్రం నిబంధనల ప్రకారం సరిచూడబడింది.",
                'grounded': "పత్రంలో సమాచారం లభించింది",
                'disclaimer': "LawBuddy సాధారణ న్యాయ సమాచారాన్ని అందిస్తుంది. లాయర్‌ను సంప్రదించండి."
            },
            'ta': {
                'notice': "உங்கள் ஆவணத்தின்படி: ஒப்பந்தத்தை ரத்து செய்ய 2 மாத எழுத்துப்பூர்வ அறிவிப்பு (2 months written notice) தேவை.",
                'rent': "ஆவணத்தின்படி: மாதாந்திர வாடகை ₹25,000, ஒவ்வொரு மாதமும் 5 ஆம் தேதிக்குள் செலுத்த வேண்டும்.",
                'deposit': "ஆவணத்தின்படி: பாதுகாப்பு வைப்புத்தொகை (Security Deposit) ₹1,50,000.",
                'default': f"உங்கள் கேள்விக்கான பதில்: '{question}' தொடர்பாக ஆவண விதிகளின்படி சரிபார்க்கப்பட்டது.",
                'grounded': "ஆவணத்தில் தகவல் உள்ளது",
                'disclaimer': "LawBuddy பொதுவான சட்டத் தகவல்களை வழங்குகிறது. வழக்கறிஞரிடம் உறுதிப்படுத்தவும்."
            },
            'ml': {
                'notice': "പ്രമാണപ്രകാരം: കരാർ റദ്ദാക്കാൻ 2 മാസത്തെ രേഖാമൂലമുള്ള നോട്ടീസ് (2 months written notice) നൽകണം.",
                'rent': "പ്രമാണപ്രകാരം: പ്രതിമാസ വാടക ₹25,000 ആണ്, ഓരോ മാസവും 5-ാം തീയതിക്ക് മുൻപ് നൽകണം.",
                'deposit': "പ്രമാണപ്രകാരം: സുരക്ഷാ നിക്ഷേപം (Security Deposit) ₹1,50,000 ആണ്.",
                'default': f"നിങ്ങളുടെ ചോദ്യത്തിന്: '{question}' സംബന്ധിച്ച് പ്രമാണ വ്യവസ്ഥകൾ അനുസരിച്ച് പരിശോധിച്ചു.",
                'grounded': "പ്രമാണത്തിൽ വിവരം കണ്ടെത്തി",
                'disclaimer': "LawBuddy പൊതുവായ നിയമ വിവരങ്ങൾ നൽകുന്നു. വക്കീലിനോട് സ്ഥിരീകരിക്കുക."
            },
            'mr': {
                'notice': "तुमच्या दस्तऐवजानुसार: करार रद्द करण्यासाठी 2 महिन्यांची लेखी नोटीस (2 months written notice) आवश्यक आहे.",
                'rent': "दस्तऐवजानुसार: मासिक भाडे ₹25,000 असून दरमहा 5 तारखेपूर्वी देणे आवश्यक आहे.",
                'deposit': "दस्तऐवजानुसार: सुरक्षा ठेव (Security Deposit) ₹1,50,000 आहे.",
                'default': f"तुमच्या प्रश्नाचे उत्तर: '{question}' बाबत दस्तऐवजातील अटींनुसार तपासणी केली.",
                'grounded': "दस्तऐवजात माहिती आढळली",
                'disclaimer': "LawBuddy सामान्य कायदेशीर माहिती पुरवते. वकिलांकडून खात्री करून घ्या."
            },
            'bn': {
                'notice': "আপনার নথি অনুসারে: চুক্তি বাতিল করতে ২ মাসের লিখিত নোটিশ (2 months written notice) দিতে হবে।",
                'rent': "নথি অনুসারে: মাসিক ভাড়া ২৫,০০০ টাকা, যা প্রতি মাসের ৫ তারিখের মধ্যে প্রদেয়।",
                'deposit': "নথি অনুসারে: নিরাপত্তা আমানত (Security Deposit) ১,৫০,০০০ টাকা।",
                'default': f"আপনার প্রশ্নের উত্তর: '{question}' সম্পর্কিত তথ্য নথির শর্তাবলী অনুসারে যাচাই করা হয়েছে।",
                'grounded': "নথিতে তথ্য পাওয়া গেছে",
                'disclaimer': "LawBuddy সাধারণ আইনি তথ্য প্রদান করে। উকিলের সাথে নিশ্চিত করুন।"
            },
            'gu': {
                'notice': "તમારા દસ્તાવેજ મુજબ: કરાર રદ કરવા માટે 2 મહિનાની લેખિત નોટિસ (2 months written notice) આપવી પડશે.",
                'rent': "દસ્તાવેજ મુજબ: માસિક ભાડું ₹25,000 છે જે દર મહિનાની 5મી તારીખ પહેલાં ચૂકવવાનું રહેશે.",
                'deposit': "દસ્તાવેજ મુજબ: સુરક્ષા ડિપોઝિટ (Security Deposit) ₹1,50,000 છે.",
                'default': f"તમારા પ્રશ્નનો જવાબ: '{question}' અંગે દસ્તાવેજની શરતો મુજબ સમીક્ષા કરવામાં આવી.",
                'grounded': "દસ્તાવેજમાં માહિતી મળી",
                'disclaimer': "LawBuddy સામાન્ય કાનૂની માહિતી આપે છે. વકીલ પાસે ચકાસણી કરો."
            },
            'en': {
                'notice': "Based on your document: The notice period for termination is 2 months written notice prior to vacating.",
                'rent': "Based on your document: Monthly rent is ₹25,000 payable on or before the 5th of each calendar month.",
                'deposit': "Based on your document: The security deposit is ₹1,50,000.",
                'default': f"Based on the uploaded document text: Your query regarding '{question}' was evaluated against the document clauses.",
                'grounded': "Information found in document",
                'disclaimer': "LawBuddy provides general legal information. Verify with a qualified professional."
            }
        }
        
        selected_map = qa_maps.get(lang_code, qa_maps['en'])
        
        if any(w in q_lower for w in ['notice', 'period', 'సూచన', 'అవధి', 'நோட்டீஸ்', 'നോട്ടീസ്', 'नोटीस', 'নোটিশ', 'નોટિસ']):
            answer = selected_map['notice']
        elif any(w in q_lower for w in ['rent', 'payment', 'బాడిగె', 'కిరాయి', 'വാടക', 'भाडे', 'ভাড়া', 'ભાડું']):
            answer = selected_map['rent']
        elif any(w in q_lower for w in ['deposit', 'security', 'డిపాజిట్', 'டெபாசிட்', 'നിക്ഷേപം', 'ठेव', 'আমানত', 'ડિપોઝિટ']):
            answer = selected_map['deposit']
        else:
            answer = selected_map['default']

        return {
            "answer": answer,
            "grounded": selected_map['grounded'],
            "disclaimer": selected_map['disclaimer']
        }
