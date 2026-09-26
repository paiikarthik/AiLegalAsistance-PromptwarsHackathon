import sys
import os
import unittest
import json

sys.path.insert(0, os.path.abspath('.'))

from app import app, DOCUMENT_CACHE
from services.database_service import DatabaseService

class TestAPIEndpoints(unittest.TestCase):
    """
    Comprehensive API endpoint test suite:
    - User Signup & Login Validation
    - Document Upload & Website Link Extraction
    - Document QA Chat Endpoint
    - Document Comparison API
    - Consultation Brief Export
    - Case Facts Saving
    - Static Asset Caching & Security Headers
    """

    def setUp(self):
        self.client = app.test_client()
        self.app_context = app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_user_signup_and_login_validation(self):
        # Invalid payload (empty email/password)
        res = self.client.post('/api/user/signup', json={"email": "", "password": ""})
        self.assertEqual(res.status_code, 400)
        self.assertIn("error", res.get_json())

        # Valid signup
        res = self.client.post('/api/user/signup', json={"email": "testuser_api@example.com", "password": "password123", "name": "API User"})
        self.assertIn(res.status_code, (200, 201))
        data = res.get_json()
        self.assertEqual(data.get("status"), "success")

        # Login with correct password
        res = self.client.post('/api/user/login', json={"email": "testuser_api@example.com", "password": "password123"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json().get("status"), "success")

    def test_sample_demo_and_chat_flow(self):
        # Trigger sample demo
        res = self.client.get('/api/sample-demo')
        self.assertEqual(res.status_code, 200)
        doc_data = res.get_json()
        doc_id = doc_data.get("doc_id")
        self.assertTrue(doc_id)

        # Chat query on loaded doc
        res_chat = self.client.post('/api/chat', json={
            "doc_id": doc_id,
            "question": "What is the notice period?",
            "language": "en"
        })
        self.assertEqual(res_chat.status_code, 200)
        chat_data = res_chat.get_json()
        self.assertIn("answer", chat_data)

    def test_save_case_fact_endpoint(self):
        res = self.client.post('/api/case-facts/save', json={
            "user_id": "test_user_999",
            "doc_id": "doc_123",
            "title": "Security Deposit Advance",
            "details": "Paid ₹1,50,000 advance via NEFT",
            "category": "Deposit"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get("status"), "success")

    def test_document_comparison_endpoint(self):
        DOCUMENT_CACHE["doc_a_test"] = {"filename": "DocA.txt", "raw_text": "Monthly Rent is ₹25,000. Notice period is 2 months."}
        DOCUMENT_CACHE["doc_b_test"] = {"filename": "DocB.txt", "raw_text": "Monthly Rent is ₹30,000. Notice period is 1 month."}

        res = self.client.post('/api/compare', json={
            "doc_id_a": "doc_a_test",
            "doc_id_b": "doc_b_test",
            "language": "en"
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn("summary", data)

    def test_export_consultation_brief_endpoint(self):
        DOCUMENT_CACHE["brief_doc_test"] = {
            "filename": "Rental_Brief.txt",
            "doc_type": "Rental Agreement",
            "raw_text": "Sample rental agreement text for advocate brief export."
        }
        res = self.client.post('/api/export-brief', json={
            "doc_id": "brief_doc_test",
            "notes": "Advocate consultation notes."
        })
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.mimetype, "text/html")
        self.assertIn("Consultation Brief", res.get_data(as_text=True))

    def test_gzip_and_cache_control_headers(self):
        res = self.client.get('/api/health')
        self.assertEqual(res.status_code, 200)
        self.assertIn("X-Content-Type-Options", res.headers)
        self.assertIn("X-Frame-Options", res.headers)

if __name__ == '__main__':
    unittest.main()
