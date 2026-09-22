import sys
import os
import time
import unittest

sys.path.insert(0, os.path.abspath('.'))

from services.rag_service import RAGService

class TestEfficiency(unittest.TestCase):
    """
    Test suite for Efficiency parameter:
    - RAG TF-IDF semantic chunking and retrieval performance (<500ms)
    - Memory & execution speed
    """

    def test_rag_semantic_chunking_speed(self):
        sample_doc = ("Paragraph " + "legal content " * 50 + "\n\n") * 20
        start_t = time.time()
        chunks = RAGService.chunk_text(sample_doc)
        duration = time.time() - start_t
        self.assertTrue(len(chunks) >= 2)
        self.assertLess(duration, 0.2, "Chunking took longer than 200ms")

    def test_rag_retrieval_performance(self):
        sample_doc = ("Paragraph " + "legal content " * 50 + "\n\n") * 20
        chunks = RAGService.chunk_text(sample_doc)
        start_t = time.time()
        retrieved = RAGService.retrieve_relevant_chunks(chunks, "legal content", top_k=3)
        duration = time.time() - start_t
        self.assertTrue(len(retrieved) <= 3)
        self.assertLess(duration, 0.3, "RAG Retrieval took longer than 300ms")

if __name__ == '__main__':
    unittest.main()
