import difflib
import json
import logging
from typing import Dict
from services.gemini_service import GeminiService

logger = logging.getLogger("lawbuddy.comparison")

class ComparisonService:
    """
    Compares two contracts (e.g. Original draft vs Revised agreement)
    and highlights added, deleted, modified clauses, dates, and amounts.
    """
    
    @staticmethod
    def compare_documents(text_a: str, text_b: str, gemini_service: GeminiService = None, language: str = 'en') -> Dict:
        """
        Runs structured comparison between text_a (Doc A) and text_b (Doc B).
        """
        is_kannada = (language in ('kn', 'kannada'))
        # If Gemini Service is active, try AI structured diff
        if gemini_service and gemini_service.client:
            try:
                target_lang = "Kannada (ಕನ್ನಡ)" if is_kannada else "English"
                kannada_instruction = ""
                if is_kannada:
                    kannada_instruction = """
KANNADA TRANSLATION GUIDELINES:
- Provide all summaries, added/removed/modified clause descriptions, and practical significance in natural, fluent Kannada script (ಕನ್ನಡ).
- Follow Kannada SOV sentence structure.
- Retain key English legal terms in brackets (e.g. 'ಮಾಸಿಕ ಬಾಡಿಗೆ (Monthly Rent)', 'ನೋಟಿಸ್ ಅವಧಿ (Notice Period)').
"""
                prompt = f"""
You are LawBuddy AI. Compare the following two versions of a legal contract.
Document A (Original Draft) vs Document B (Revised Version).
Respond in {target_lang}.

Identify and summarize:
1. Added clauses in Document B.
2. Removed clauses from Document A.
3. Modified clauses (changed payment amounts, lock-in periods, notice periods, obligations).
4. Overall practical impact on the user (Tenant/Employee/Consumer).
{kannada_instruction}

Return ONLY a valid JSON matching this schema:
{{
  "summary": "Brief explanation of key differences between the two versions",
  "changes_count": {{"added": int, "removed": int, "modified": int}},
  "modified_clauses": [
    {{
      "clause_name": "Rent Amount / Notice Period / Security Deposit",
      "original_text": "Clause from Doc A",
      "revised_text": "Clause from Doc B",
      "significance": "Practical impact of this change for the user"
    }}
  ],
  "added_clauses": [
    {{
      "clause_name": "New Clause title",
      "text": "Text of new clause",
      "significance": "Why this was added and what it means"
    }}
  ],
  "removed_clauses": [
    {{
      "clause_name": "Removed clause title",
      "text": "Text of removed clause",
      "significance": "Why this removal matters"
    }}
  ]
}}

DOCUMENT A (Original):
\"\"\"
{text_a[:6000]}
\"\"\"

DOCUMENT B (Revised):
\"\"\"
{text_b[:6000]}
\"\"\"
"""
                raw = gemini_service._call_llm_raw(prompt, language)
                extracted_json = gemini_service._extract_json_string(raw)
                return json.loads(extracted_json)
            except Exception as e:
                logger.error(f"Gemini document comparison failed: {e}")

        # Fallback Python diff analysis
        return ComparisonService._fallback_diff(text_a, text_b, language)

    @staticmethod
    def _fallback_diff(text_a: str, text_b: str, language: str = 'en') -> Dict:
        is_kannada = (language in ('kn', 'kannada'))
        lines_a = [l.strip() for l in text_a.splitlines() if l.strip()]
        lines_b = [l.strip() for l in text_b.splitlines() if l.strip()]
        
        matcher = difflib.SequenceMatcher(None, lines_a, lines_b)
        added = []
        removed = []
        modified = []
        
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == 'replace':
                modified.append({
                    "clause_name": f"ವಿಭಾಗ {i1+1} ರ ಸಾಲಿನಲ್ಲಿ ಬದಲಾವಣೆ" if is_kannada else f"Clause change around section {i1+1}",
                    "original_text": " ".join(lines_a[i1:i2]),
                    "revised_text": " ".join(lines_b[j1:j2]),
                    "significance": "ಕರಾರಿನ ಷರತ್ತು ಅಥವಾ ಹಣಕಾಸಿನ ಮೊತ್ತದಲ್ಲಿ ಬದಲಾವಣೆಗಳನ್ನು ಮಾಡಲಾಗಿದೆ." if is_kannada else "Clause text or figures have been altered between versions."
                })
            elif tag == 'delete':
                removed.append({
                    "clause_name": f"ಸಾಲು {i1+1} ರಲ್ಲಿ ಷರತ್ತು ಹಿಂತೆಗೆದುಕೊಳ್ಳಲಾಗಿದೆ" if is_kannada else f"Clause removed near line {i1+1}",
                    "text": " ".join(lines_a[i1:i2]),
                    "significance": "ಈ ಷರತ್ತನ್ನು ಮೂಲ ಕರಾರಿನಿಂದ ತೆಗೆದುಹಾಕಲಾಗಿದೆ." if is_kannada else "This clause was present in original document but removed in the revision."
                })
            elif tag == 'insert':
                added.append({
                    "clause_name": f"ಸಾಲು {j1+1} ರಲ್ಲಿ ಹೊಸ ಷರತ್ತು ಸೇರಿಸಲಾಗಿದೆ" if is_kannada else f"New clause added near line {j1+1}",
                    "text": " ".join(lines_b[j1:j2]),
                    "significance": "ಈ ಷರತ್ತು ಪರಿಷ್ಕೃತ ಒಪ್ಪಂದದಲ್ಲಿ ಮಾತ್ರ ಸೇರಿಸಲಾದ ಹೊಸ ನಿಯಮವಾಗಿದೆ." if is_kannada else "This is a new addition present only in the revised agreement."
                })

        summary = f"ಒಟ್ಟು {len(modified)} ತಿದ್ದುಪಡಿ ಮಾಡಿದ ಷರತ್ತುಗಳು, {len(added)} ಹೊಸ ಷರತ್ತುಗಳು, ಮತ್ತು {len(removed)} ತೆಗೆದುಹಾಕಲಾದ ಷರತ್ತುಗಳನ್ನು ಗುರುತಿಸಲಾಗಿದೆ." if is_kannada else f"Detected {len(modified)} modified clauses, {len(added)} added clauses, and {len(removed)} removed clauses."

        return {
            "summary": summary,
            "changes_count": {
                "added": len(added),
                "removed": len(removed),
                "modified": len(modified)
            },
            "modified_clauses": modified[:5],
            "added_clauses": added[:5],
            "removed_clauses": removed[:5]
        }
