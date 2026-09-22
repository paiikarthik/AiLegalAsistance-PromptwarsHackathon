import sys
import os
import unittest
import json

sys.path.insert(0, os.path.abspath('.'))

from app import app
from config import Config
from services.gemini_service import GeminiService
from services.ocr_service import OCRService

class TestCodeQuality(unittest.TestCase):
    """
    Test suite for Code Quality parameter:
    - Clean Flask response codes
    - JSON formatting & Schema consistency
    - Error handling & edge cases
    """

    def setUp(self):
        self.client = app.test_client()

    def test_health_check_endpoint(self):
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual(data["status"], "online")
        self.assertIn("service", data)

    def test_official_sources_endpoint(self):
        response = self.client.get('/api/official-sources')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertTrue(isinstance(data, list))
        self.assertTrue(len(data) >= 3)

    def test_sample_demo_endpoint(self):
        response = self.client.get('/api/sample-demo')
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertIn("doc_id", data)
        self.assertIn("filename", data)

    def test_invalid_document_id_error_handling(self):
        response = self.client.post('/api/analyze', json={"doc_id": "invalid_12345"})
        self.assertEqual(response.status_code, 404)
        data = response.get_json()
        self.assertIn("error", data)

    def test_document_type_hint_detection(self):
        rental_text = "RENTAL AGREEMENT between Landlord and Tenant"
        hint = OCRService.detect_document_type_hint(rental_text)
        self.assertEqual(hint, "Rental Agreement")

        eviction_text = "EVICTION NOTICE to vacate premises immediately"
        hint2 = OCRService.detect_document_type_hint(eviction_text)
        self.assertEqual(hint2, "Eviction Notice")

if __name__ == '__main__':
    unittest.main()
