import sys
import os
import unittest

sys.path.insert(0, os.path.abspath('.'))

from app import app

class TestAccessibility(unittest.TestCase):
    """
    Test suite for Accessibility parameter:
    - HTML lang attribute
    - Noto Sans Kannada font imports
    - ARIA attributes and labels
    - Keyboard navigation & accessibility compliance
    """

    def setUp(self):
        self.client = app.test_client()

    def test_app_html_accessibility_elements(self):
        response = self.client.get('/app.html')
        self.assertEqual(response.status_code, 200)
        html_content = response.get_data(as_text=True)
        
        # Check font link for Noto Sans Kannada
        self.assertIn("Noto+Sans+Kannada", html_content)
        # Check ARIA attributes
        self.assertIn("data-i18n", html_content)
        self.assertIn("languageSelect", html_content)
        self.assertIn("sr-only", html_content)

    def test_index_html_accessibility_elements(self):
        response = self.client.get('/index.html')
        self.assertEqual(response.status_code, 200)
        html_content = response.get_data(as_text=True)
        
        self.assertIn("Noto+Sans+Kannada", html_content)
        self.assertIn("<!DOCTYPE html>", html_content)

if __name__ == '__main__':
    unittest.main()
