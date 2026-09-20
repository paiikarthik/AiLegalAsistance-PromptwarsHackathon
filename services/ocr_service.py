import os
import io
import logging
from pathlib import Path

logger = logging.getLogger("lawbuddy.ocr")

class OCRService:
    """
    Handles text extraction from PDF, DOCX, TXT files, and images (OCR).
    Preserves page and section metadata wherever possible.
    """
    
    @staticmethod
    def extract_text_from_file(file_path: str) -> dict:
        """
        Extract text from file based on extension.
        Returns dict with:
        - raw_text: full text
        - pages: list of {"page_num": int, "text": str}
        - total_pages: int
        - doc_type_hint: string candidate
        """
        ext = Path(file_path).suffix.lower().replace('.', '')
        
        if ext == 'pdf':
            return OCRService._extract_pdf(file_path)
        elif ext == 'docx':
            return OCRService._extract_docx(file_path)
        elif ext == 'txt':
            return OCRService._extract_txt(file_path)
        elif ext in ['png', 'jpg', 'jpeg']:
            return OCRService._extract_image(file_path)
        else:
            raise ValueError(f"Unsupported file format: {ext}")
            
    @staticmethod
    def _extract_pdf(file_path: str) -> dict:
        pages_data = []
        full_text_parts = []
        
        # Method 1: Try pdfplumber
        try:
            import pdfplumber
            with pdfplumber.open(file_path) as pdf:
                for idx, page in enumerate(pdf.pages, start=1):
                    text = page.extract_text() or ""
                    # Fallback to OCR if page has no extracted text
                    if not text.strip():
                        ocr_text = OCRService._ocr_pdf_page(page)
                        if ocr_text:
                            text = ocr_text
                    
                    if text.strip():
                        pages_data.append({"page_num": idx, "text": text.strip()})
                        full_text_parts.append(f"--- PAGE {idx} ---\n{text.strip()}")
        except Exception as e:
            logger.warning(f"pdfplumber extraction failed, falling back to pypdf: {e}")
            # Method 2: Try pypdf
            try:
                from pypdf import PdfReader
                reader = PdfReader(file_path)
                for idx, page in enumerate(reader.pages, start=1):
                    text = page.extract_text() or ""
                    if text.strip():
                        pages_data.append({"page_num": idx, "text": text.strip()})
                        full_text_parts.append(f"--- PAGE {idx} ---\n{text.strip()}")
            except Exception as e2:
                logger.error(f"pypdf extraction failed as well: {e2}")
                raise RuntimeError(f"Could not extract text from PDF: {e2}")

        full_text = "\n\n".join(full_text_parts)
        if not full_text.strip():
            full_text = "No extractable text found in PDF. The document may be scanned or image-only."
            pages_data = [{"page_num": 1, "text": full_text}]
            
        return {
            "raw_text": full_text,
            "pages": pages_data,
            "total_pages": len(pages_data),
            "doc_type_hint": OCRService.detect_document_type_hint(full_text)
        }
        
    @staticmethod
    def _extract_docx(file_path: str) -> dict:
        try:
            import docx
            doc = docx.Document(file_path)
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            full_text = "\n\n".join(paragraphs)
            
            # Approximate pages by grouping every ~500 words
            words = full_text.split()
            chunk_size = 400
            pages_data = []
            for i in range(0, max(1, len(words)), chunk_size):
                page_words = words[i:i + chunk_size]
                page_num = (i // chunk_size) + 1
                pages_data.append({
                    "page_num": page_num,
                    "text": " ".join(page_words)
                })
                
            return {
                "raw_text": full_text,
                "pages": pages_data,
                "total_pages": len(pages_data),
                "doc_type_hint": OCRService.detect_document_type_hint(full_text)
            }
        except Exception as e:
            logger.error(f"DOCX extraction failed: {e}")
            raise RuntimeError(f"Could not extract text from DOCX file: {e}")

    @staticmethod
    def _extract_txt(file_path: str) -> dict:
        try:
            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                full_text = f.read()
                
            lines = full_text.splitlines()
            pages_data = [{"page_num": 1, "text": full_text}]
            
            return {
                "raw_text": full_text,
                "pages": pages_data,
                "total_pages": 1,
                "doc_type_hint": OCRService.detect_document_type_hint(full_text)
            }
        except Exception as e:
            logger.error(f"TXT reading failed: {e}")
            raise RuntimeError(f"Could not read text file: {e}")

    @staticmethod
    def _extract_image(file_path: str) -> dict:
        text = ""
        # Attempt 1: PyTesseract OCR
        try:
            from PIL import Image
            import pytesseract
            img = Image.open(file_path)
            extracted = pytesseract.image_to_string(img)
            if extracted and extracted.strip():
                text = extracted.strip()
        except Exception as e:
            logger.warning(f"PyTesseract OCR attempt failed: {e}")

        # Attempt 2: Gemini Vision API Fallback
        if not text:
            try:
                from config import Config
                if Config.GEMINI_API_KEY:
                    from google import genai
                    from PIL import Image
                    client = genai.Client(api_key=Config.GEMINI_API_KEY)
                    img = Image.open(file_path)
                    res = client.models.generate_content(
                        model=Config.PRIMARY_MODEL,
                        contents=[img, "Extract all readable text from this legal document image accurately. Return only the extracted text."]
                    )
                    if res and res.text and res.text.strip():
                        text = res.text.strip()
            except Exception as e:
                logger.warning(f"Gemini Vision OCR attempt failed: {e}")

        # Fallback if both OCR engines are unavailable or return empty text
        if not text:
            text = "Scanned Notice Image Received. (Tesseract OCR is not installed on this system. You can also paste notice text into the Upload Text box below for 100% instant analysis)."

        return {
            "raw_text": text,
            "pages": [{"page_num": 1, "text": text}],
            "total_pages": 1,
            "doc_type_hint": OCRService.detect_document_type_hint(text)
        }

    @staticmethod
    def _ocr_pdf_page(page) -> str:
        try:
            import pytesseract
            page_img = page.to_image(resolution=200).original
            return pytesseract.image_to_string(page_img)
        except Exception:
            return ""

    @staticmethod
    def detect_document_type_hint(text: str) -> str:
        """
        Rule-based quick detection hint for document type.
        """
        txt_lower = text.lower()
        if any(term in txt_lower for term in ['rental agreement', 'lease deed', 'tenancy agreement', 'rent agreement']):
            return 'Rental Agreement'
        elif any(term in txt_lower for term in ['employment agreement', 'employment contract', 'offer letter', 'appointment letter']):
            return 'Employment Contract'
        elif any(term in txt_lower for term in ['eviction notice', 'notice to vacate', 'vacate premises', 'quit and deliver']):
            return 'Eviction Notice'
        elif any(term in txt_lower for term in ['rent demand', 'cure notice', 'demand for rent', 'arrears of rent']):
            return 'Rent Demand Notice'
        elif any(term in txt_lower for term in ['non-disclosure', 'nda', 'confidentiality agreement', 'proprietary information']):
            return 'Non-Disclosure Agreement (NDA)'
        elif any(term in txt_lower for term in ['consumer complaint', 'deficiency of service', 'consumer forum', 'district commission']):
            return 'Consumer Complaint'
        elif any(term in txt_lower for term in ['loan agreement', 'promissory note', 'mortgage', 'sanction letter']):
            return 'Loan / Financial Agreement'
        elif any(term in txt_lower for term in ['refund of deposit', 'deposit dispute', 'security deposit refund']):
            return 'Deposit Dispute Notice'
        elif any(term in txt_lower for term in ['legal notice', 'advocate notice', 'hereby notice', 'cease and desist']):
            return 'Legal Notice'
        elif any(term in txt_lower for term in ['service agreement', 'master service agreement', 'statement of work']):
            return 'Service Agreement'
        elif any(term in txt_lower for term in ['summons', 'court order', 'pleading', 'petition', 'written statement']):
            return 'Court Order / Summons'
        elif any(term in txt_lower for term in ['privacy policy', 'terms of service', 'terms and conditions']):
            return 'Privacy Policy'
        elif any(term in txt_lower for term in ['landlord', 'lessor', 'lessee', 'tenant']):
            return 'Rental Agreement'
        elif any(term in txt_lower for term in ['employee', 'employer', 'ctc', 'salary']):
            return 'Employment Contract'
        else:
            return 'Other Legal Document'
