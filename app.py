import os
import re
import uuid
import logging
import ipaddress
import socket
from html import unescape
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, build_opener, HTTPRedirectHandler
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
from werkzeug.exceptions import HTTPException, RequestEntityTooLarge

from config import Config
from services.ocr_service import OCRService
from services.gemini_service import GeminiService
from services.rag_service import RAGService
from services.comparison_service import ComparisonService
from services.consultation_service import ConsultationService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lawbuddy")

app = Flask(__name__, static_folder="static", template_folder=".")
app.config.from_object(Config)
CORS(app)


def sanitize_upload_filename(filename: str) -> str:
    """
    Sanitize uploaded filename safely preserving Unicode characters (e.g. Indian languages)
    while preventing path traversal vulnerabilities.
    """
    if not filename:
        return "uploaded_document.txt"
    base_name = os.path.basename(filename.replace('\\', '/'))
    base_name = re.sub(r'[\x00-\x1f\x7f]', '', base_name)
    base_name = base_name.replace('..', '')
    base_name = base_name.strip(' .')
    if not base_name:
        return "uploaded_document.txt"
    return base_name



@app.errorhandler(RequestEntityTooLarge)
def handle_file_too_large(error):
    """Keep API failures JSON so the browser can show a useful upload message."""
    return jsonify({"error": "File is too large. Maximum upload size is 16 MB."}), 413


@app.errorhandler(HTTPException)
def handle_http_error(error):
    if request.path.startswith('/api/'):
        return jsonify({"error": error.description}), error.code
    return error


@app.errorhandler(Exception)
def handle_unexpected_error(error):
    logger.exception("Unhandled request error")
    if request.path.startswith('/api/'):
        return jsonify({"error": "The server could not complete this request. Please try again."}), 500
    return "An unexpected server error occurred.", 500

# In-memory document session cache
DOCUMENT_CACHE = {}
gemini_service = GeminiService()


class _NoRedirect(HTTPRedirectHandler):
    """Make redirects explicit so every destination can be safety-checked."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _WebsiteTextExtractor(HTMLParser):
    """Small dependency-free HTML-to-text extractor for public webpages."""
    def __init__(self):
        super().__init__()
        self.parts = []
        self.title = ""
        self._skip_depth = 0
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "noscript", "svg", "template"}:
            self._skip_depth += 1
        elif tag == "title":
            self._in_title = True
        elif tag in {"p", "div", "br", "li", "h1", "h2", "h3", "h4", "article", "section", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "noscript", "svg", "template"} and self._skip_depth:
            self._skip_depth -= 1
        elif tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._skip_depth:
            return
        cleaned = unescape(data).strip()
        if cleaned:
            self.parts.append(cleaned + " ")
            if self._in_title:
                self.title += cleaned + " "


def _validate_public_web_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Enter a valid public http:// or https:// website link.")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), type=socket.SOCK_STREAM)
        for address in addresses:
            ip = ipaddress.ip_address(address[4][0])
            if not ip.is_global:
                raise ValueError("Links to private or local network addresses are not allowed.")
    except socket.gaierror:
        raise ValueError("We could not find that website. Check the link and try again.")
    return parsed.geturl()


def _fetch_website_text(url: str) -> tuple[str, str]:
    opener = build_opener(_NoRedirect())
    current_url = _validate_public_web_url(url)
    for _ in range(4):
        request_obj = Request(current_url, headers={"User-Agent": "LawBuddyAI/1.0 (document analysis)"})
        try:
            response = opener.open(request_obj, timeout=12)
        except HTTPError as error:
            if error.code in {301, 302, 303, 307, 308} and error.headers.get("Location"):
                from urllib.parse import urljoin
                current_url = _validate_public_web_url(urljoin(current_url, error.headers["Location"]))
                continue
            raise ValueError(f"The website returned HTTP {error.code}.")
        except URLError:
            raise ValueError("We could not retrieve that website. It may block automated access.")

        content_type = response.headers.get_content_type()
        if content_type not in {"text/html", "text/plain"}:
            raise ValueError("That link does not point to a readable webpage or text document.")
        raw = response.read(1_000_001)
        if len(raw) > 1_000_000:
            raise ValueError("That webpage is too large to analyze. Please paste the relevant text instead.")
        charset = response.headers.get_content_charset() or "utf-8"
        page_text = raw.decode(charset, errors="replace")
        if content_type == "text/plain":
            return re.sub(r'\s+', ' ', page_text).strip(), current_url
        parser = _WebsiteTextExtractor()
        parser.feed(page_text)
        text = re.sub(r'\s+', ' ', ''.join(parser.parts)).strip()
        title = re.sub(r'\s+', ' ', parser.title).strip()
        return text, title or current_url
    raise ValueError("Too many website redirects.")

@app.route('/')
def root():
    return send_from_directory('.', 'index.html')

@app.route('/<path:filename>')
def serve_static_pages(filename):
    # Do not let the HTML-app fallback mask a misspelled API route.  Doing so
    # used to return index.html to fetch(), which then surfaced as a JSON error.
    if filename.startswith('api/'):
        return jsonify({"error": "API endpoint not found"}), 404
    if os.path.exists(filename) and filename.endswith(('.html', '.js', '.css', '.png', '.jpg', '.svg', '.txt')):
        return send_from_directory('.', filename)
    return send_from_directory('.', 'index.html')

# API Endpoints
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "online",
        "service": "LawBuddy AI API",
        "version": "1.0.0",
        "gemini_active": bool(gemini_service.client),
        "openai_active": bool(Config.OPENAI_API_KEY),
        "deepseek_active": bool(Config.DEEPSEEK_API_KEY),
        "grok_active": bool(Config.GROK_API_KEY),
        "perplexity_active": bool(Config.PERPLEXITY_API_KEY),
        "supported_languages": Config.SUPPORTED_LANGUAGES
    })

@app.route('/api/sample-demo', methods=['GET'])
def sample_demo():
    """
    Loads pre-configured sample Indian rental agreement for instant 1-click hackathon demo.
    """
    sample_path = os.path.join(Config.BASE_DIR, 'data', 'sample_rental_agreement.txt')
    if os.path.exists(sample_path):
        extracted = OCRService.extract_text_from_file(sample_path)
    else:
        extracted = {
            "raw_text": "Sample Indian Rental Agreement text fallback...",
            "pages": [{"page_num": 1, "text": "Sample text"}],
            "total_pages": 1,
            "doc_type_hint": "Rental Agreement"
        }

    doc_id = "sample_rental_demo_2026"
    chunks = RAGService.chunk_text(extracted["raw_text"])
    
    DOCUMENT_CACHE[doc_id] = {
        "filename": "Sample_Indian_Rental_Agreement.txt",
        "raw_text": extracted["raw_text"],
        "pages": extracted["pages"],
        "total_pages": extracted["total_pages"],
        "doc_type": extracted["doc_type_hint"],
        "chunks": chunks
    }
    
    return jsonify({
        "doc_id": doc_id,
        "filename": "Sample_Indian_Rental_Agreement.txt",
        "doc_type": extracted["doc_type_hint"],
        "total_pages": extracted["total_pages"],
        "preview_text": extracted["raw_text"][:600] + "..."
    })

@app.route('/api/upload', methods=['POST'])
def upload_document():
    if 'file' not in request.files:
        # Check text upload
        data = request.get_json(silent=True) or {}
        text_content = data.get('text', '')
        filename = data.get('filename', 'Pasted_Legal_Document.txt')
        
        if not text_content.strip():
            return jsonify({"error": "No file uploaded or text provided"}), 400
            
        extracted = {
            "raw_text": text_content.strip(),
            "pages": [{"page_num": 1, "text": text_content.strip()}],
            "total_pages": 1,
            "doc_type_hint": OCRService.detect_document_type_hint(text_content)
        }
    else:
        file = request.files['file']
        if file.filename == '':
            return jsonify({"error": "Selected file is empty"}), 400
            
        filename = sanitize_upload_filename(file.filename)
        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        if ext not in Config.ALLOWED_EXTENSIONS:
            return jsonify({"error": f"File type '.{ext}' is not supported. Upload PDF, DOCX, TXT, or PNG/JPG."}), 400

        doc_uuid = str(uuid.uuid4())[:8]
        saved_filename = f"{doc_uuid}_{filename}"
        save_path = os.path.join(Config.UPLOAD_FOLDER, saved_filename)
        file.save(save_path)

        try:
            extracted = OCRService.extract_text_from_file(save_path)
        except Exception as e:
            logger.error(f"Text extraction failed for {filename}: {e}")
            return jsonify({"error": f"Failed to extract document text: {str(e)}"}), 500

    doc_id = str(uuid.uuid4())
    chunks = RAGService.chunk_text(extracted["raw_text"])

    DOCUMENT_CACHE[doc_id] = {
        "filename": filename,
        "raw_text": extracted["raw_text"],
        "pages": extracted["pages"],
        "total_pages": extracted["total_pages"],
        "doc_type": extracted["doc_type_hint"],
        "chunks": chunks
    }

    return jsonify({
        "doc_id": doc_id,
        "filename": filename,
        "doc_type": extracted["doc_type_hint"],
        "total_pages": extracted["total_pages"],
        "preview_text": extracted["raw_text"][:600] + "..."
    })


@app.route('/api/upload-link', methods=['POST'])
def upload_website_link():
    """Fetch public webpage text and make it available to the normal AI analysis flow."""
    data = request.get_json(silent=True) or {}
    url = (data.get("url") or "").strip()
    if not url:
        return jsonify({"error": "A website link is required."}), 400

    try:
        raw_text, page_title = _fetch_website_text(url)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        logger.exception("Website text extraction failed for %s", url)
        return jsonify({"error": "We could not extract text from that website. Please paste the relevant text instead."}), 502

    if len(raw_text) < 40:
        return jsonify({"error": "We could not find enough readable text on that webpage. Please paste the relevant text instead."}), 400

    filename = sanitize_upload_filename(f"Website - {page_title[:100]}.txt")
    extracted = {
        "raw_text": raw_text,
        "pages": [{"page_num": 1, "text": raw_text}],
        "total_pages": 1,
        "doc_type_hint": OCRService.detect_document_type_hint(raw_text)
    }
    doc_id = str(uuid.uuid4())
    DOCUMENT_CACHE[doc_id] = {
        "filename": filename,
        "source_url": url,
        "raw_text": raw_text,
        "pages": extracted["pages"],
        "total_pages": 1,
        "doc_type": extracted["doc_type_hint"],
        "chunks": RAGService.chunk_text(raw_text)
    }
    return jsonify({
        "doc_id": doc_id,
        "filename": filename,
        "doc_type": extracted["doc_type_hint"],
        "total_pages": 1,
        "preview_text": raw_text[:600] + ("..." if len(raw_text) > 600 else "")
    })

@app.route('/api/analyze', methods=['POST'])
def analyze_document():
    data = request.get_json() or {}
    doc_id = data.get('doc_id')
    doc_type = data.get('doc_type')
    language = data.get('language', 'en')

    if not doc_id or doc_id not in DOCUMENT_CACHE:
        return jsonify({"error": "Invalid or expired document session ID"}), 404

    cached_doc = DOCUMENT_CACHE[doc_id]
    actual_doc_type = doc_type or cached_doc["doc_type"]
    cached_doc["doc_type"] = actual_doc_type

    try:
        analysis_result = gemini_service.analyze_document(
            text=cached_doc["raw_text"],
            doc_type=actual_doc_type,
            language=language
        )
        cached_doc["analysis"] = analysis_result
        return jsonify(analysis_result)
    except Exception as e:
        logger.error(f"Document analysis failed: {e}")
        return jsonify({"error": f"Failed to analyze document: {str(e)}"}), 500

@app.route('/api/chat', methods=['POST'])
def chat_with_document():
    data = request.get_json() or {}
    doc_id = data.get('doc_id')
    question = data.get('question', '').strip()
    language = data.get('language', 'en')

    if not doc_id or doc_id not in DOCUMENT_CACHE:
        return jsonify({"error": "Invalid or expired document session ID"}), 404

    if not question:
        return jsonify({"error": "Question parameter is required"}), 400

    cached_doc = DOCUMENT_CACHE[doc_id]
    relevant_chunks = RAGService.retrieve_relevant_chunks(cached_doc["chunks"], question, top_k=3)
    context_text = "\n\n".join([f"[{c['ref']}]: {c['text']}" for c in relevant_chunks])

    response = gemini_service.answer_question(
        text=context_text,
        question=question,
        language=language
    )
    
    response["sources"] = [{"ref": c["ref"], "snippet": c["text"][:150] + "..."} for c in relevant_chunks]
    return jsonify(response)

@app.route('/api/compare', methods=['POST'])
def compare_documents():
    data = request.get_json() or {}
    doc_id_a = data.get('doc_id_a')
    doc_id_b = data.get('doc_id_b')
    language = data.get('language', 'en')

    if not doc_id_a or doc_id_a not in DOCUMENT_CACHE:
        return jsonify({"error": "Original document (Doc A) not found"}), 404
    if not doc_id_b or doc_id_b not in DOCUMENT_CACHE:
        return jsonify({"error": "Revised document (Doc B) not found"}), 404

    text_a = DOCUMENT_CACHE[doc_id_a]["raw_text"]
    text_b = DOCUMENT_CACHE[doc_id_b]["raw_text"]

    diff_result = ComparisonService.compare_documents(
        text_a=text_a,
        text_b=text_b,
        gemini_service=gemini_service,
        language=language
    )

    return jsonify(diff_result)

@app.route('/api/export-brief', methods=['POST'])
def export_brief():
    data = request.get_json() or {}
    doc_id = data.get('doc_id')
    notes = data.get('notes', '')

    if not doc_id or doc_id not in DOCUMENT_CACHE:
        return jsonify({"error": "Invalid or expired document session ID"}), 404

    cached_doc = DOCUMENT_CACHE[doc_id]
    analysis = cached_doc.get("analysis")
    if not analysis:
        # Run analysis first if missing
        analysis = gemini_service.analyze_document(cached_doc["raw_text"], cached_doc["doc_type"])

    html_brief = ConsultationService.generate_consultation_brief(analysis, notes)
    return Response(html_brief, mimetype="text/html")

@app.route('/api/official-sources', methods=['GET'])
def get_official_sources():
    return jsonify([
        {
            "name": "India Code (Central Acts & Statutory Portal)",
            "url": "https://www.indiacode.nic.in",
            "category": "Statutory Laws",
            "description": "Digital repository of all Indian Central and State Acts, legislations, and amendments."
        },
        {
            "name": "National Legal Services Authority (NALSA)",
            "url": "https://nalsa.gov.in",
            "category": "Legal Aid",
            "description": "Constitutional body providing free legal services to eligible Indian citizens."
        },
        {
            "name": "e-Courts Services Portal India",
            "url": "https://ecourts.gov.in",
            "category": "Court Cases & Orders",
            "description": "Official case status, court listings, and judgment portal for Indian District & High Courts."
        },
        {
            "name": "National Consumer Disputes Redressal Commission (NCDRC)",
            "url": "http://ncdrc.nic.in",
            "category": "Consumer Rights",
            "description": "Apex statutory body for consumer grievances and dispute resolution in India."
        },
        {
            "name": "Ministry of Corporate Affairs (MCA)",
            "url": "https://www.mca.gov.in",
            "category": "Business & Contracts",
            "description": "Official registry for Indian companies, master data, and corporate compliances."
        }
    ])

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"\n=======================================================")
    print(f"LawBuddy AI Platform is running on http://127.0.0.1:{port}")
    print(f"=======================================================\n")
    app.run(host='0.0.0.0', port=port, debug=True)
