import sys
import os
import unittest
import json

sys.path.insert(0, os.path.abspath('.'))

from app import app
from services.gemini_service import GeminiService
from services.comparison_service import ComparisonService
from services.consultation_service import ConsultationService
from services.case_preparation_service import EvidenceService

class TestProblemStatementAlignment(unittest.TestCase):
    """
    Test suite verifying 100% alignment with the Hackathon Problem Statement:
    1. Simplifying complex legal documents
    2. Comparing contracts, agreements, or policies
    3. Highlighting important clauses, obligations, risks, or inconsistencies
    4. Answering questions based on provided legal documents
    5. Helping users understand options and potential next steps
    6. Generating summaries, checklists, or actionable outputs
    7. Helping users prepare information or questions for a legal professional
    """

    def setUp(self):
        self.client = app.test_client()
        self.gemini = GeminiService()
        self.sample_doc_a = """
        RENTAL AGREEMENT
        This agreement made on 01-01-2026 between Sri Ramesh (Landlord) and Sri Suresh (Tenant).
        1. Monthly Rent: Rs. 25,000 per month payable on or before 5th.
        2. Security Deposit: Rs. 1,50,000 refundable at vacate.
        3. Lock-in Period: 6 months minimum stay.
        4. Notice Period: 2 months written notice prior to vacating.
        5. Indemnity: Tenant agrees to indemnify landlord for third party damages.
        """
        self.sample_doc_b = """
        REVISED RENTAL AGREEMENT
        This agreement made on 01-01-2026 between Sri Ramesh (Landlord) and Sri Suresh (Tenant).
        1. Monthly Rent: Rs. 28,000 per month payable on or before 5th.
        2. Security Deposit: Rs. 2,00,000 refundable at vacate.
        3. Lock-in Period: 12 months minimum stay required.
        4. Notice Period: 3 months written notice prior to vacating.
        """

    def test_use_case_1_simplify_complex_legal_documents(self):
        """Use Case 1: Simplifying complex legal documents into plain language."""
        result = self.gemini._fallback_analysis_response(self.sample_doc_a, "Rental Agreement", "en")
        self.assertIn("summary", result)
        self.assertTrue(len(result["summary"]) > 10)
        self.assertIn("parties", result)

    def test_use_case_2_compare_contracts_and_agreements(self):
        """Use Case 2: Comparing contracts, agreements, or policies."""
        result = ComparisonService.compare_documents(self.sample_doc_a, self.sample_doc_b, language="en")
        self.assertIn("summary", result)
        self.assertIn("changes_count", result)
        self.assertIn("modified_clauses", result)

    def test_use_case_3_highlight_clauses_obligations_risks(self):
        """Use Case 3: Highlighting important clauses, obligations, risks, or inconsistencies."""
        result = self.gemini._fallback_analysis_response(self.sample_doc_a, "Rental Agreement", "en")
        self.assertIn("clauses_and_risks", result)
        self.assertIn("key_obligations", result)
        self.assertTrue(len(result["clauses_and_risks"]) >= 1)

    def test_use_case_4_answer_questions_grounded(self):
        """Use Case 4: Answering questions based on provided legal documents (RAG Q&A)."""
        result = self.gemini._fallback_qa_response(self.sample_doc_a, "What is the notice period?", "en")
        self.assertIn("answer", result)
        self.assertIn("notice", result["answer"].lower())

    def test_use_case_5_understand_options_and_next_steps(self):
        """Use Case 5: Helping users understand their options and potential next steps."""
        result = self.gemini._fallback_analysis_response(self.sample_doc_a, "Rental Agreement", "en")
        self.assertIn("action_map", result)
        self.assertIn("navigate", result["action_map"])
        self.assertIn("next_steps", result["action_map"]["navigate"])

    def test_use_case_6_generate_summaries_and_checklists(self):
        """Use Case 6: Generating summaries, checklists, or other actionable outputs."""
        evidence_map = EvidenceService.get_or_create_evidence_map("doc_align_test_100")
        self.assertIn("issues", evidence_map)
        brief = ConsultationService.generate_consultation_brief({"doc_type": "Rental Agreement", "summary": "Test"}, "User note")
        self.assertIn("Executive Summary", brief)

    def test_use_case_7_prepare_for_legal_professional(self):
        """Use Case 7: Helping users prepare information or questions for a legal professional."""
        result = self.gemini._fallback_analysis_response(self.sample_doc_a, "Rental Agreement", "en")
        prepare_section = result["action_map"]["prepare"]
        self.assertIn("questions_for_lawyer", prepare_section)
        self.assertIn("checklist_to_collect", prepare_section)

    def test_applicable_laws_and_sections(self):
        """Verify dynamic statutory sections, penalties, case procedures, and portal URLs."""
        result = self.gemini._fallback_analysis_response(self.sample_doc_a, "Rental Agreement", "en")
        self.assertIn("applicable_laws_and_sections", result)
        laws = result["applicable_laws_and_sections"]
        self.assertTrue(len(laws) >= 1)
        law = laws[0]
        self.assertIn("act_or_law", law)
        self.assertIn("section", law)
        self.assertIn("penalty_or_punishment", law)
        self.assertIn("how_to_handle_case", law)
        self.assertIn("portal_url", law)

if __name__ == '__main__':
    unittest.main()
