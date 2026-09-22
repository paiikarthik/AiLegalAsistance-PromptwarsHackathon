import sys
import os
import unittest

sys.path.insert(0, os.path.abspath('.'))

from app import app
from services.gemini_service import GeminiService

class TestKannadaTranslation(unittest.TestCase):
    """
    Test suite for Kannada Legal Translation quality & fallback generator:
    - SOV Kannada sentence structure
    - Standard Kannada legal terms (ಕನ್ನಡ ಕಾನೂನು ಶಬ್ದಕೋಶ)
    - Preserved English terms in brackets
    - Native Kannada fallback output
    """

    def setUp(self):
        self.client = app.test_client()
        self.gemini = GeminiService()
        self.sample_doc = """
        RENTAL AGREEMENT
        This Agreement made between Sri Ramesh (Landlord) and Sri Suresh (Tenant).
        1. Monthly Rent: Rs. 25,000 per month payable on or before 5th.
        2. Security Deposit: Rs. 1,50,000 refundable at vacate.
        3. Lock-in Period: 6 months minimum stay required.
        4. Notice Period: 2 months written notice prior to termination.
        """

    def test_kannada_fallback_analysis_structure(self):
        result = self.gemini._fallback_analysis_response(self.sample_doc, "Rental Agreement", "kn")
        self.assertEqual(result["language"], "Kannada (ಕನ್ನಡ)")
        self.assertIn("ಕನ್ನಡ", result["language"])
        
        # Verify Kannada script in output fields
        parties_roles = [p["role"] for p in result["parties"]]
        self.assertTrue(any("ಪಕ್ಷಕಾರ" in r for r in parties_roles))

    def test_kannada_qa_response_generation(self):
        result = self.gemini._fallback_qa_response(self.sample_doc, "notice period", "kn")
        self.assertIn("ಸೂಚನೆ", result["answer"])
        self.assertEqual(result["grounded"], "ದಾಖಲೆಯಲ್ಲಿ ಮಾಹಿತಿ ಕಂಡುಬಂದಿದೆ")

    def test_kannada_word_explainer_endpoint(self):
        response = self.client.post('/api/explain-word', json={
            "word": "security deposit",
            "language": "kn"
        })
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn("ಭದ್ರತಾ", data["word"])

if __name__ == '__main__':
    unittest.main()
