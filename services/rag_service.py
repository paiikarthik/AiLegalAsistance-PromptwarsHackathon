import re
import logging
from typing import List, Dict

logger = logging.getLogger("lawbuddy.rag")

class RAGService:
    """
    Retrieval-Augmented Generation service.
    Splits document into semantic chunks and uses lightweight TF-IDF / Cosine similarity
    to retrieve top relevant chunks for grounded Q&A.
    """
    
    @staticmethod
    def chunk_text(text: str, chunk_size: int = 400, overlap: int = 50) -> List[Dict]:
        """
        Splits text into overlapping chunks with section/page tracking.
        """
        paragraphs = [p.strip() for p in text.split('\n') if p.strip()]
        chunks = []
        current_chunk = []
        current_len = 0
        chunk_id = 1
        
        for p in paragraphs:
            words = p.split()
            if current_len + len(words) > chunk_size and current_chunk:
                chunk_str = " ".join(current_chunk)
                chunks.append({
                    "id": f"chunk_{chunk_id}",
                    "text": chunk_str,
                    "ref": f"Section/Chunk {chunk_id}"
                })
                chunk_id += 1
                # Keep last overlap words
                overlap_words = current_chunk[-overlap:] if len(current_chunk) >= overlap else current_chunk
                current_chunk = list(overlap_words)
                current_len = len(current_chunk)
                
            current_chunk.extend(words)
            current_len += len(words)
            
        if current_chunk:
            chunks.append({
                "id": f"chunk_{chunk_id}",
                "text": " ".join(current_chunk),
                "ref": f"Section/Chunk {chunk_id}"
            })
            
        return chunks

    @staticmethod
    def retrieve_relevant_chunks(chunks: List[Dict], query: str, top_k: int = 3) -> List[Dict]:
        """
        Retrieves top_k most relevant chunks using TF-IDF vector similarity.
        Falls back to keyword matching if scikit-learn is unavailable.
        """
        if not chunks:
            return []
            
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer
            from sklearn.metrics.pairwise import cosine_similarity
            
            corpus = [c["text"] for c in chunks]
            vectorizer = TfidfVectorizer(stop_words='english')
            tfidf_matrix = vectorizer.fit_transform(corpus + [query])
            
            query_vec = tfidf_matrix[-1]
            doc_vecs = tfidf_matrix[:-1]
            
            similarities = cosine_similarity(query_vec, doc_vecs).flatten()
            top_indices = similarities.argsort()[::-1][:top_k]
            
            results = []
            for idx in top_indices:
                if similarities[idx] > 0.05: # score threshold
                    c = chunks[idx].copy()
                    c["score"] = float(similarities[idx])
                    results.append(c)
                    
            if not results and chunks:
                return chunks[:top_k]
                
            return results
        except Exception as e:
            logger.warning(f"TF-IDF vector retrieval fallback triggered: {e}")
            query_words = set(re.findall(r'\w+', query.lower()))
            scored = []
            for c in chunks:
                words = set(re.findall(r'\w+', c["text"].lower()))
                overlap = len(query_words.intersection(words))
                scored.append((overlap, c))
            scored.sort(key=lambda x: x[0], reverse=True)
            return [item[1] for item in scored[:top_k]]
