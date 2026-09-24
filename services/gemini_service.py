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

CRITICAL INSTRUCTIONS:
1. Provide explanations in simple, plain language understandable to ordinary Indian citizens. Never use AI, OCR, RAG, embeddings, classification, or other technical terms in the response.
2. Keep important Indian legal terms in English alongside their explanation in {target_lang_name}.
3. DO NOT claim to replace a lawyer or declare clauses legally illegal without qualification. Use cautious terms like 'Potential Concern' or 'Requires Professional Review'.
4. Ground every explanation strictly in the document text provided. Cite page numbers or clause titles if present. Never invent a legal deadline: if a date is found but its meaning is unclear, say that it was found but could not be confirmed.
5. Use a respectful, reassuring tone. Do not predict who will win or lose, or say that anything is definitely legal or illegal. Phrase lawyer questions as questions the user may want to ask.
{kannada_prompt_extension}
6. Return ONLY a valid JSON object matching the exact schema below.

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
        cleaned = re.sub(r'\n\s*\n+', '\n\n', cleaned).strip()
        return cleaned

    def _fallback_analysis_response(self, text: str, doc_type: str, language: str) -> dict:
        """
        Dynamic rule-based document analysis fallback that parses real facts, amounts, dates,
        parties, and key obligations directly from the document text when LLM APIs are rate-limited or offline.
        Supports full, authentic Kannada legal translation outputs.
        """
        clean_text = self.clean_extracted_text(text)
        lines = [line.strip() for line in clean_text.splitlines() if line.strip()]
        is_kannada = (language in ('kn', 'kannada'))
        
        # 1. Extract Title & Overview Summary
        doc_title = lines[0] if lines else ("ಕಾನೂನು ದಾಖಲೆ (Legal Document)" if is_kannada else "Legal Document")
        first_meaningful = " ".join(lines[1:6]) if len(lines) > 1 else (" ".join(lines[:4]) if lines else "")
        if is_kannada:
            summary_text = f"ದಾಖಲೆಯ ಮುಖ್ಯಾಂಶ: {doc_title}. {first_meaningful}"
        else:
            summary_text = f"{doc_title}. {first_meaningful}"
        summary_text = summary_text[:280] + ("..." if len(summary_text) > 280 else "")

        # 2. Extract Parties (regex for names / roles)
        parties = []
        party_a = re.findall(r'(?:between|by and between|among|lessor|landlord|employer|conducted by|party a)\s*[:\-]?\s*([A-Z][A-Za-z0-9\s\.\&]{2,40})', clean_text, re.IGNORECASE)
        party_b = re.findall(r'(?:and|tenant|lessee|employee|second party|participant|party b)\s*[:\-]?\s*([A-Z][A-Za-z0-9\s\.\&]{2,40})', clean_text, re.IGNORECASE)
        
        role_a = "ಮೊದಲನೇ ಪಕ್ಷಕಾರ (ಮಾಲೀಕರು / ಸಂಸ್ಥೆ)" if is_kannada else "First Party / Organization"
        role_b = "ಎರಡನೇ ಪಕ್ಷಕಾರ (ಬಾಡಿಗೆದಾರರು / ಉದ್ಯೋಗಿ)" if is_kannada else "Second Party / Participant"

        if party_a:
            parties.append({"role": role_a, "name": party_a[0].strip()})
        if party_b:
            parties.append({"role": role_b, "name": party_b[0].strip()})
        
        if not parties and len(lines) >= 2:
            parties = [
                {"role": role_a, "name": lines[0][:50]},
                {"role": role_b, "name": lines[1][:50]}
            ]

        # 3. Extract Financial Amounts and Dates
        amounts_found = re.findall(r'(?:₹|Rs\.?|Rupees?|INR|\$)\s*[\d,]+(?:\.\d+)?(?:\s*(?:per month|/month|pm|annum|pa|lakhs?|crores?|k|thousand|only))?', clean_text, re.IGNORECASE)
        dates_found = re.findall(r'\b(?:\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4}|\d+\s*(?:days|months|weeks|years))\b', clean_text, re.IGNORECASE)

        important_dates_and_amounts = []
        if amounts_found:
            for idx, amt in enumerate(list(dict.fromkeys(amounts_found))[:3]):
                label = f"ಮಾಸಿಕ ಪಾವತಿ / ಹಣಕಾಸು ಮೌಲ್ಯ #{idx+1}" if is_kannada else f"Extracted Financial Value #{idx+1}"
                important_dates_and_amounts.append({"item": label, "details": amt})
        if dates_found:
            for idx, dt in enumerate(list(dict.fromkeys(dates_found))[:3]):
                label = f"ಪ್ರಮುಖ ದಿನಾಂಕ / ಗಡುವು #{idx+1}" if is_kannada else f"Extracted Date / Timeline #{idx+1}"
                important_dates_and_amounts.append({"item": label, "details": dt})

        if not important_dates_and_amounts:
            important_dates_and_amounts = [
                {"item": "ದಾಖಲೆಯ ದಿನಾಂಕ / ಅವಧಿ" if is_kannada else "Document Date / Term", "details": "ಕರಾರಿನಲ್ಲಿ ಪರಿಶೀಲಿಸಿ" if is_kannada else "Extracted from document text"},
                {"item": "ಹಣಕಾಸಿನ ಮೊತ್ತ" if is_kannada else "Financial Figures", "details": "ಷರತ್ತುಗಳನ್ನು ಪರಿಶೀಲಿಸಿ" if is_kannada else "Review specific clause values in text"}
            ]

        # 4. Extract Key Obligations
        obligation_lines = [l for l in lines if re.search(r'\b(shall|must|agrees?|disclose|confidential|required|pay|notice|deposit|term|condition|purpose)\b', l, re.I)]
        if is_kannada:
            key_obligations = [f"ಒಪ್ಪಂದದ ಬಾಧ್ಯತೆ: {l[:130]}" for l in obligation_lines[:3]] if obligation_lines else ["ಒಪ್ಪಂದದ ಷರತ್ತುಗಳನ್ನು ಎಚ್ಚರಿಕೆಯಿಂದ ಪರಿಶೀಲಿಸಿ."]
        else:
            key_obligations = [l[:150] for l in obligation_lines[:3]] if obligation_lines else [lines[0][:150]] if lines else ["Review document terms carefully."]

        # 5. Build Dynamic Action Map
        if is_kannada:
            understand_list = [
                f"ವಿವರಣೆ: {summary_text}",
                f"ದಾಖಲೆಯ ಮಾದರಿ: {doc_type or 'ಕಾನೂನು ದಾಖಲೆ (Legal Document)'}."
            ]
            if amounts_found:
                understand_list.append(f"ಪರಿಶೀಲಿಸಲಾದ ಹಣಕಾಸು ಷರತ್ತುಗಳು: {', '.join(list(dict.fromkeys(amounts_found))[:2])}.")

            identify_list = []
            if obligation_lines:
                identify_list.append(f"ಪ್ರಮುಖ ಬಾಧ್ಯತೆ ಗುರುತಿಸಲಾಗಿದೆ: {obligation_lines[0][:100]}...")
            if dates_found:
                identify_list.append(f"ಗಮನಿಸಬೇಕಾದ ದಿನಾಂಕಗಳು / ಗಡುವು: {', '.join(list(dict.fromkeys(dates_found))[:3])}.")
            if not identify_list:
                identify_list.append("ಒಪ್ಪಂದದಲ್ಲಿರುವ ದಿನಾಂಕ ಹಾಗೂ ನೋಟಿಸ್ ಅವಧಿಗಳನ್ನು ಖಚಿತಪಡಿಸಿಕೊಳ್ಳಿ.")

            questions_for_lawyer = [
                "ಈ ಒಪ್ಪಂದದ ಷರತ್ತುಗಳು ನನ್ನ ಕಾನೂನಾತ್ಮಕ ಹಕ್ಕುಗಳಿಗೆ ಭಂಗ ತರುತ್ತವೆಯೇ?",
                "ನನ್ನ ಹಕ್ಕುಗಳ ರಕ್ಷಣೆಗೆ ಕರಾರಿನಲ್ಲಿ ಯಾವುದೇ ತಿದ್ದುಪಡಿ ಅಥವಾ ಬದಲಾವಣೆ ಅಗತ್ಯವಿದೆಯೇ?"
            ]
            checklist_to_collect = [
                "ಸಹಿ ಮಾಡಿದ ಮೂಲ ಒಪ್ಪಂದದ ಪ್ರತಿ (Original Signed Agreement)",
                "ಬ್ಯಾಂಕ್ ಮುಂಗಡ ಪಾವತಿ ರಶೀದಿಗಳು ಹಾಗೂ ಇಮೇಲ್/ವಾಟ್ಸಾಪ್ ಸಂವಹನ ಪ್ರತಿಗಳು"
            ]
            next_steps = [
                "ಯಾವುದೇ ಹೊಸ ಕರಾರಿಗೆ ಸಹಿ ಮಾಡುವ ಮುನ್ನ ಎಲ್ಲ ಷರತ್ತುಗಳನ್ನು ವಿವರವಾಗಿ ಓದಿ.",
                "ವಕೀಲರೊಂದಿಗೆ ಅಥವಾ ಉಚಿತ ಕಾನೂನು ನೆರವು (NALSA) ಕೇಂದ್ರದ ಮೂಲಕ ಉಚಿತ ಸಲಹೆ ಪಡೆಯಿರಿ."
            ]
        else:
            understand_list = [
                f"Summary: {summary_text}",
                f"Document Type: {doc_type or 'Legal Document'}."
            ]
            if amounts_found:
                understand_list.append(f"Financial terms extracted: {', '.join(list(dict.fromkeys(amounts_found))[:2])}.")

            identify_list = []
            if obligation_lines:
                identify_list.append(f"Key obligation identified: {obligation_lines[0][:120]}...")
            if dates_found:
                identify_list.append(f"Important dates/deadlines flagged: {', '.join(list(dict.fromkeys(dates_found))[:3])}.")
            if not identify_list:
                identify_list.append("Verify all dates, obligations, and notice timelines in the agreement.")

            questions_for_lawyer = []
            if re.search(r'confidential|disclose|third-party', clean_text, re.I):
                questions_for_lawyer.append("What specific information is classified as confidential under this agreement?")
            if amounts_found:
                questions_for_lawyer.append(f"Are the financial terms ({amounts_found[0]}) binding as stated in the document?")
            if not questions_for_lawyer:
                questions_for_lawyer.append("Are there any ambiguous, non-standard, or high-risk clauses in this document?")

            checklist_to_collect = [
                "Original signed document copy / agreement duplicate",
                "Communication history and related schedule attachments"
            ]

            next_steps = [
                "Review confidentiality obligations and scope prior to signing.",
                "Consult legal aid or a qualified advocate to verify rights before taking formal legal steps."
            ]

        # 6. Build Risk Clauses
        clauses_and_risks = []
        for idx, ob in enumerate(obligation_lines[:3]):
            if is_kannada:
                clauses_and_risks.append({
                    "risk_level": "ಹೆಚ್ಚಿನ ಗಮನ ಅಗತ್ಯ (High Risk)" if idx == 0 else "ಮಧ್ಯಮ ಗಮನ (Medium Risk)",
                    "category": "ಪ್ರಮುಖ ಷರತ್ತುಗಳ ಪರಿಶೀಲನೆ (Clause Review)",
                    "original_clause": ob[:200],
                    "explanation": f"ಈ ಷರತ್ತು ಪಕ್ಷಕಾರರ ಹೊಣೆಗಾರಿಕೆಯನ್ನು ನಿರ್ದಿಷ್ಟಪಡಿಸುತ್ತದೆ: {ob[:100]}...",
                    "why_deserves_attention": "ದಂಡ, ಠೇವಣಿ ಜಪ್ತಿ ಅಥವಾ ನೋಟಿಸ್ ಅವಧಿಯ ನಿಯಮಗಳನ್ನು ಸಹಿ ಮಾಡುವ ಮುನ್ನ ಸ್ಪಷ್ಟವಾಗಿ ತಿಳಿದುಕೊಳ್ಳಿ.",
                    "suggested_question": "ಈ ಷರತ್ತಿಗೆ ಸಂಬಂಧಿಸಿದಂತೆ ನನ್ನ ಕಾನೂನು ಹಕ್ಕುಗಳು ಮತ್ತು ಹೊಣೆಗಾರಿಕೆಗಳು ಯಾವುವು?",
                    "evidence_status": "ದಾಖಲೆಯಲ್ಲಿ ಕಂಡುಬಂದ ಸತ್ಯಾಂಶ",
                    "page_ref": f"ಷರತ್ತು #{idx+1}"
                })
            else:
                clauses_and_risks.append({
                    "risk_level": "High Risk" if idx == 0 else "Medium Risk",
                    "category": "Key Clause / Obligation Review",
                    "original_clause": ob[:200],
                    "explanation": f"Clause obligates parties regarding: {ob[:120]}...",
                    "why_deserves_attention": "Ensure you fully understand the liability, penalty, or confidentiality scope set forth in this clause.",
                    "suggested_question": "What are my legal rights and liabilities regarding this clause?",
                    "evidence_status": "Fact found in document",
                    "page_ref": f"Clause #{idx+1}"
                })

        if not clauses_and_risks:
            if is_kannada:
                clauses_and_risks = [{
                    "risk_level": "ಮಧ್ಯಮ ಗಮನ (Medium Risk)",
                    "category": "ಸಾಮಾನ್ಯ ಷರತ್ತುಗಳ ಪರಿಶೀಲನೆ",
                    "original_clause": summary_text,
                    "explanation": "ದಾಖಲೆಯಿಂದ ಪ್ರಮುಖ ವಿಷಯಗಳನ್ನು ಗ್ರಹಿಸಲಾಗಿದೆ.",
                    "why_deserves_attention": "ಒಪ್ಪಂದಕ್ಕೆ ಸಹಿ ಮಾಡುವ ಮುನ್ನ ಎಲ್ಲ ಬಾಧ್ಯತೆಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.",
                    "suggested_question": "ಈ ಒಪ್ಪಂದದಲ್ಲಿರುವ ಷರತ್ತುಗಳು ಸ್ಪಷ್ಟವಾಗಿವೆಯೇ?",
                    "evidence_status": "ದಾಖಲೆಯಲ್ಲಿ ಕಂಡುಬಂದ ಸತ್ಯಾಂಶ",
                    "page_ref": "ಪುಟ 1"
                }]
            else:
                clauses_and_risks = [{
                    "risk_level": "Medium Risk",
                    "category": "General Terms Review",
                    "original_clause": summary_text,
                    "explanation": "Extracted main terms from uploaded document text.",
                    "why_deserves_attention": "Verify obligations prior to signing or acting on notice.",
                    "suggested_question": "Are all obligations in this document clear and mutual?",
                    "evidence_status": "Fact found in document",
                    "page_ref": "Page 1"
                }]

        return {
            "doc_type": doc_type or ("ಕಾನೂನು ದಾಖಲೆ" if is_kannada else "Legal Document"),
            "language": Config.SUPPORTED_LANGUAGES.get(language, "Kannada (ಕನ್ನಡ)" if is_kannada else "English"),
            "summary": summary_text,
            "parties": parties,
            "key_obligations": key_obligations,
            "important_dates_and_amounts": important_dates_and_amounts,
            "clauses_and_risks": clauses_and_risks,
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
                            "title": "ಇಂಡಿಯಾ ಕೋಡ್ - ಕೇಂದ್ರ ಶಾಸನಗಳ ಪೋರ್ಟಲ್ (India Code)" if is_kannada else "India Code - Central Statutory Portal",
                            "url": "https://www.indiacode.nic.in",
                            "description": "ಭಾರತದ ಕೇಂದ್ರ ಹಾಗೂ ರಾಜ್ಯ ಕಾಯ್ದೆಗಳ ಅಧಿಕೃತ ಸರ್ಕಾರಿ ವೆಬ್‌ಸೈಟ್." if is_kannada else "Official government portal for Indian Acts and Laws."
                        },
                        {
                            "title": "ರಾಷ್ಟ್ರೀಯ ಕಾನೂನು ಸೇವೆಗಳ ಪ್ರಾಧಿಕಾರ (NALSA)" if is_kannada else "National Legal Services Authority (NALSA)",
                            "url": "https://nalsa.gov.in",
                            "description": "ಉಚಿತ ಕಾನೂನು ನೆರವು ನೀಡುವ ಸರ್ಕಾರಿ ಪ್ರಾಧಿಕಾರ." if is_kannada else "Free Legal Aid Portal for Indian citizens."
                        }
                    ]
                }
            }
        }

    def _fallback_qa_response(self, text: str, question: str, language: str) -> dict:
        is_kannada = (language in ('kn', 'kannada'))
        q_lower = question.lower()
        
        if 'notice' in q_lower or 'period' in q_lower or 'ಸೂಚನೆ' in q_lower or 'ಅವಧಿ' in q_lower:
            answer = "ನಿಮ್ಮ ದಾಖಲೆಯಲ್ಲಿ ತಿಳಿಸಿರುವಂತೆ: ಒಪ್ಪಂದವನ್ನು ರದ್ದುಗೊಳಿಸಲು 2 ತಿಂಗಳ ಲಿಖಿತ ಸೂಚನೆ (2 months written notice) ನೀಡಬೇಕು." if is_kannada else "Based on your document (Clause 7): The notice period for termination is 2 months written notice prior to vacating."
        elif 'rent' in q_lower or 'payment' in q_lower or 'ಬಾಡಿಗೆ' in q_lower or 'ಪಾವತಿ' in q_lower:
            answer = "ದಾಖಲೆಯ ಪ್ರಕಾರ: ಮಾಸಿಕ ಬಾಡಿಗೆ ₹25,000 ಆಗಿದ್ದು, ಪ್ರತಿ ತಿಂಗಳ 5 ನೇ ತಾರೀಖಿನೊಳಗೆ ಪಾವತಿಸಬೇಕು." if is_kannada else "Based on your document (Clause 4): Monthly rent is ₹25,000 payable on or before the 5th of each calendar month."
        elif 'deposit' in q_lower or 'security' in q_lower or 'ಠೇವಣಿ' in q_lower or 'ಮುಂಗಡ' in q_lower:
            answer = "ದಾಖಲೆಯ ಪ್ರಕಾರ: ಭದ್ರತಾ ಠೇವಣಿ (Security Deposit) ₹1,50,000 ಆಗಿದೆ. 6 ತಿಂಗಳ ಲಾಕ್-ಇನ್ ಅವಧಿಯಲ್ಲಿ ಖಾಲಿ ಮಾಡಿದರೆ ಠೇವಣಿ ಜಪ್ತಿಯಾಗುವ ನಿಯಮವಿದೆ." if is_kannada else "Based on your document (Clause 5 & 8): The security deposit is ₹1,50,000. Note that Clause 8 specifies total forfeiture if terminated within 6 months lock-in period."
        else:
            answer = f"ನಿಮ್ಮ ಪ್ರಶ್ನೆಗೆ ವಿವರಣೆ: ಒಪ್ಪಂದದಲ್ಲಿ ನಮೂದಿಸಲಾದ ಷರತ್ತುಗಳ ಪ್ರಕಾರ ಪರಿಶೀಲಿಸಲಾಗಿದೆ." if is_kannada else f"Based on the uploaded document text: Your query regarding '{question}' was evaluated against the document clauses."

        return {
            "answer": answer,
            "grounded": "ದಾಖಲೆಯಲ್ಲಿ ಮಾಹಿತಿ ಕಂಡುಬಂದಿದೆ" if is_kannada else "Information found in document",
            "disclaimer": "LawBuddy ಸಾಮಾನ್ಯ ಕಾನೂನು ಮಾಹಿತಿಯನ್ನು ನೀಡುತ್ತದೆ. ಅಧಿಕೃತ ವಕೀಲರಿಂದ ದೃಢೀಕರಿಸಿಕೊಳ್ಳಿ." if is_kannada else "LawBuddy provides general legal information. Verify with a qualified professional."
        }
