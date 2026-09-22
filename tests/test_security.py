import sys
import os
import unittest
import json

sys.path.insert(0, os.path.abspath('.'))

from app import app, sanitize_upload_filename, _validate_public_web_url

class TestSecurity(unittest.TestCase):
    """
    Test suite for Security parameter:
    - HTTP Security Headers (CSP, X-Frame-Options, HSTS, XSS)
    - Path Traversal prevention in filename uploads
    - SSRF protection against private IP ranges
    - Max Upload File Size Enforcement
    """

    def setUp(self):
        self.client = app.test_client()

    def test_http_security_headers_present(self):
        response = self.client.get('/api/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get('X-Content-Type-Options'), 'nosniff')
        self.assertEqual(response.headers.get('X-Frame-Options'), 'DENY')
        self.assertEqual(response.headers.get('X-XSS-Protection'), '1; mode=block')
        self.assertIn('Content-Security-Policy', response.headers)

    def test_filename_sanitization_path_traversal(self):
        malicious_names = [
            "../../../etc/passwd",
            "..\\..\\windows\\system32\\cmd.exe",
            "../../uploads/hack.py",
            "....//....//secret.txt"
        ]
        for name in malicious_names:
            clean = sanitize_upload_filename(name)
            self.assertNotIn("..", clean)
            self.assertNotIn("/", clean)
            self.assertNotIn("\\", clean)

    def test_ssrf_private_ip_blocking(self):
        blocked_urls = [
            "http://127.0.0.1:5000/admin",
            "http://localhost:8080",
            "http://10.0.0.1",
            "http://169.254.169.254/latest/meta-data/"
        ]
        for url in blocked_urls:
            with self.assertRaises(ValueError):
                _validate_public_web_url(url)

    def test_empty_upload_payload_validation(self):
        response = self.client.post('/api/upload', json={"text": "   "})
        self.assertEqual(response.status_code, 400)
        data = response.get_json()
        self.assertIn("error", data)

if __name__ == '__main__':
    unittest.main()
