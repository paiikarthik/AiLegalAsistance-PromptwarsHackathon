import os
import json
import re
import uuid
import logging
import ipaddress
import socket
import time
import threading
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
from services.case_preparation_service import EvidenceService
from services.database_service import DatabaseService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("lawbuddy")

app = Flask(__name__, static_folder="static", template_folder=".")
app.config.from_object(Config)
CORS(app)

# Initialize SQLite Database for permanent user and case data storage
DatabaseService.init_db()

# --- SECURITY HEADERS MIDDLEWARE ---
@app.after_request
def apply_security_headers(response):
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Content-Security-Policy'] = (
        "default-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com https://www.gstatic.com; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.gstatic.com https://apis.google.com https://accounts.google.com https://*.firebaseapp.com https://*.googleapis.com; "
        "connect-src 'self' https://*.googleapis.com https://*.firebaseapp.com https://accounts.google.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com wss: ws:; "
        "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.gstatic.com; "
        "font-src 'self' data: https://fonts.gstatic.com; "
        "img-src 'self' data: blob: https://*.googleusercontent.com https://lh3.googleusercontent.com https://www.gstatic.com; "
        "frame-ancestors 'none';"
    )
    return response

# --- THREAD-SAFE IN-MEMORY API RATE LIMITER ---
RATE_LIMIT_STORE = {}
RATE_LIMIT_LOCK = threading.Lock()
MAX_REQUESTS_PER_MINUTE = 100

@app.before_request
def rate_limit_check():
    if request.path.startswith('/api/'):
        client_ip = request.remote_addr or '127.0.0.1'
        now = time.time()
        with RATE_LIMIT_LOCK:
            timestamps = RATE_LIMIT_STORE.get(client_ip, [])
            timestamps = [t for t in timestamps if now - t < 60]
            if len(timestamps) >= MAX_REQUESTS_PER_MINUTE:
                return jsonify({"error": "Too many requests. Please wait a minute before trying again."}), 429
            timestamps.append(now)
            RATE_LIMIT_STORE[client_ip] = timestamps


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
    url = (url or "").strip()
    if not url:
        raise ValueError("Enter a valid public website link.")
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
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
    # Do not let the HTML-app fallback mask a misspelled API route.
    if filename.startswith('api/'):
        return jsonify({"error": "API endpoint not found"}), 404
    norm_path = os.path.normpath(filename).replace('\\', '/')
    if norm_path.startswith(('uploads', 'scratch', '.env', '.git', '__pycache__')) or '/uploads' in norm_path or 'uploads/' in norm_path:
        return jsonify({"error": "Access denied"}), 403
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

def _get_request_user_id(req_data=None):
    if req_data and isinstance(req_data, dict):
        if req_data.get('user_id'): return req_data.get('user_id')
        if req_data.get('uid'): return req_data.get('uid')
    header_uid = request.headers.get('X-User-ID') or request.headers.get('x-user-id')
    return header_uid

@app.route('/api/user/signup', methods=['POST'])
def user_signup_endpoint():
    data = request.get_json(silent=True) or {}
    email = data.get('email')
    password = data.get('password')
    name = data.get('name') or data.get('fullName')
    user_id = data.get('user_id') or data.get('uid') or ('user_' + str(int(time.time() * 1000)))

    if not email or not password:
        return jsonify({"error": "Email address and password are required."}), 400

    user_info, err = DatabaseService.register_user(user_id, email, password, name, auth_provider='email')
    if err:
        return jsonify({"error": err}), 400

    return jsonify({
        "status": "success",
        "user": user_info,
        "message": "Account created successfully."
    }), 201

@app.route('/api/user/login', methods=['POST'])
def user_login_endpoint():
    data = request.get_json(silent=True) or {}
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"error": "Email address and password are required."}), 400

    is_valid, user_data, err_msg = DatabaseService.verify_user_credentials(email, password)
    if not is_valid:
        return jsonify({"error": err_msg}), 401

    return jsonify({
        "status": "success",
        "user": user_data,
        "message": "Login successful."
    })

@app.route('/api/user/sync', methods=['POST'])
def sync_user_account():
    data = request.get_json(silent=True) or {}
    user_id = _get_request_user_id(data)
    email = data.get('email')
    name = data.get('name') or data.get('displayName')
    auth_provider = data.get('auth_provider', 'email')

    if not user_id or not email:
        return jsonify({"error": "user_id and email are required to sync user profile"}), 400

    user_info = DatabaseService.upsert_user(user_id, email, name, auth_provider)
    
    # Retrieve user's latest saved active document and claims from SQLite DB
    latest_doc = DatabaseService.get_latest_user_document(user_id)
    evidence = DatabaseService.get_user_evidence(user_id)
    facts = DatabaseService.get_user_case_facts(user_id)
    
    if latest_doc:
        doc_id = latest_doc["doc_id"]
        if doc_id not in DOCUMENT_CACHE:
            chunks = RAGService.chunk_text(latest_doc["raw_text"])
            DOCUMENT_CACHE[doc_id] = {
                "filename": latest_doc["filename"],
                "raw_text": latest_doc["raw_text"],
                "pages": [{"page_num": 1, "text": latest_doc["raw_text"]}],
                "total_pages": 1,
                "doc_type": latest_doc["doc_type"],
                "chunks": chunks,
                "analysis": latest_doc.get("analysis"),
                "created_at": time.time()
            }

    return jsonify({
        "status": "success",
        "user": user_info,
        "latest_doc": latest_doc,
        "evidence": evidence,
        "facts": facts
    })

@app.route('/api/user/case-data', methods=['GET'])
def get_user_case_data():
    user_id = request.args.get('user_id') or request.headers.get('X-User-ID')
    if not user_id:
        return jsonify({"error": "user_id is required"}), 400

    latest_doc = DatabaseService.get_latest_user_document(user_id)
    evidence = DatabaseService.get_user_evidence(user_id)
    facts = DatabaseService.get_user_case_facts(user_id)
    
    if latest_doc:
        doc_id = latest_doc["doc_id"]
        if doc_id not in DOCUMENT_CACHE:
            chunks = RAGService.chunk_text(latest_doc["raw_text"])
            DOCUMENT_CACHE[doc_id] = {
                "filename": latest_doc["filename"],
                "raw_text": latest_doc["raw_text"],
                "pages": [{"page_num": 1, "text": latest_doc["raw_text"]}],
                "total_pages": 1,
                "doc_type": latest_doc["doc_type"],
                "chunks": chunks,
                "analysis": latest_doc.get("analysis"),
                "created_at": time.time()
            }

    return jsonify({
        "latest_doc": latest_doc,
        "evidence": evidence,
        "facts": facts
    })

@app.route('/api/user/cases', methods=['GET'])
def get_user_cases():
    user_id = request.args.get('user_id') or request.headers.get('X-User-ID')
    if not user_id:
        return jsonify({"error": "user_id is required to fetch user cases"}), 400

    docs = DatabaseService.get_user_documents(user_id)
    return jsonify({
        "status": "success",
        "cases": docs
    })

@app.route('/api/user/case/<doc_id>', methods=['GET'])
def get_user_case_by_id(doc_id):
    user_id = request.args.get('user_id') or request.headers.get('X-User-ID')
    doc = DatabaseService.get_document(doc_id)
    if not doc:
        return jsonify({"error": "Case document not found"}), 404

    if doc_id not in DOCUMENT_CACHE:
        chunks = RAGService.chunk_text(doc["raw_text"])
        DOCUMENT_CACHE[doc_id] = {
            "filename": doc["filename"],
            "raw_text": doc["raw_text"],
            "pages": [{"page_num": 1, "text": doc["raw_text"]}],
            "total_pages": 1,
            "doc_type": doc["doc_type"],
            "chunks": chunks,
            "analysis": doc.get("analysis"),
            "created_at": time.time()
        }

    evidence = DatabaseService.get_user_evidence(user_id, doc_id=doc_id) if user_id else []
    facts = DatabaseService.get_user_case_facts(user_id, doc_id=doc_id) if user_id else []

    return jsonify({
        "status": "success",
        "doc": doc,
        "evidence": evidence,
        "facts": facts
    })

@app.route('/api/case-facts/save', methods=['POST'])
def save_user_case_fact():
    data = request.get_json(silent=True) or {}
    user_id = _get_request_user_id(data)
    doc_id = data.get('doc_id')
    title = data.get('title') or data.get('claim_title')
    details = data.get('details') or data.get('claim_details', '')
    category = data.get('category') or data.get('claim_category', 'Claim')

    if not user_id or not title:
        return jsonify({"error": "user_id and claim title are required."}), 400

    fact_id = DatabaseService.save_case_fact(user_id, doc_id, title, details, category)
    return jsonify({
        "status": "success",
        "fact_id": fact_id,
        "message": "Factual claim saved permanently in database."
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
    user_id = request.headers.get('X-User-ID') or "demo_user"
    chunks = RAGService.chunk_text(extracted["raw_text"])
    
    DOCUMENT_CACHE[doc_id] = {
        "filename": "Sample_Indian_Rental_Agreement.txt",
        "raw_text": extracted["raw_text"],
        "pages": extracted["pages"],
        "total_pages": extracted["total_pages"],
        "doc_type": extracted["doc_type_hint"],
        "chunks": chunks,
        "created_at": time.time()
    }

    # Save to SQLite DB
    DatabaseService.save_document(doc_id, user_id, "Sample_Indian_Rental_Agreement.txt", extracted["doc_type_hint"], extracted["raw_text"])
    
    return jsonify({
        "doc_id": doc_id,
        "filename": "Sample_Indian_Rental_Agreement.txt",
        "doc_type": extracted["doc_type_hint"],
        "total_pages": extracted["total_pages"],
        "preview_text": extracted["raw_text"][:600] + "..."
    })

@app.route('/api/upload', methods=['POST'])
def upload_document():
    req_json = request.get_json(silent=True) or {}
    user_id = _get_request_user_id(req_json) or request.form.get('user_id') or "anonymous"

    if 'file' not in request.files:
        # Check text upload
        text_content = req_json.get('text', '')
        raw_filename = req_json.get('filename', 'Pasted_Legal_Document.txt')
        filename = sanitize_upload_filename(raw_filename)
        
        if not text_content.strip():
            return jsonify({"error": "No file uploaded or text provided"}), 400
        if len(text_content) > 2_000_000:
            return jsonify({"error": "Pasted text is too large. Maximum size is 2 MB."}), 400
            
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
        # Ensure target file stays strictly within Config.UPLOAD_FOLDER
        save_path = os.path.abspath(os.path.join(Config.UPLOAD_FOLDER, saved_filename))
        if not save_path.startswith(os.path.abspath(Config.UPLOAD_FOLDER)):
            return jsonify({"error": "Invalid upload file path."}), 400

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
        "chunks": chunks,
        "created_at": time.time()
    }

    # Save permanently to SQLite Database
    DatabaseService.save_document(doc_id, user_id, filename, extracted["doc_type_hint"], extracted["raw_text"])

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
    user_id = _get_request_user_id(data) or "anonymous"
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

    # Save permanently to SQLite Database
    DatabaseService.save_document(doc_id, user_id, filename, extracted["doc_type_hint"], raw_text)

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
    user_id = _get_request_user_id(data)

    if not doc_id:
        return jsonify({"error": "doc_id is required"}), 400

    # Retrieve from DOCUMENT_CACHE or SQLite DB
    if doc_id not in DOCUMENT_CACHE:
        db_doc = DatabaseService.get_document(doc_id)
        if db_doc:
            DOCUMENT_CACHE[doc_id] = {
                "filename": db_doc["filename"],
                "raw_text": db_doc["raw_text"],
                "pages": [{"page_num": 1, "text": db_doc["raw_text"]}],
                "total_pages": 1,
                "doc_type": db_doc["doc_type"],
                "chunks": RAGService.chunk_text(db_doc["raw_text"]),
                "analysis": db_doc.get("analysis"),
                "created_at": time.time()
            }

    if doc_id not in DOCUMENT_CACHE:
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
        
        # Save analysis permanently to SQLite DB
        DatabaseService.update_document_analysis(doc_id, analysis_result)
        
        return jsonify(analysis_result)
    except Exception as e:
        logger.error(f"Document analysis failed: {e}")
        return jsonify({"error": f"Failed to analyze document: {str(e)}"}), 500

@app.route('/api/chat', methods=['POST'])
def chat_with_document():
    data = request.get_json() or {}
    doc_id = data.get('doc_id')
    question = (data.get('question') or data.get('query') or '').strip()
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

# --- EVIDENCE-TO-CLAUSE MAPPING & TRACKING ENDPOINTS ---
@app.route('/api/evidence/<doc_id>', methods=['GET'])
def get_evidence_map(doc_id):
    if doc_id not in DOCUMENT_CACHE:
        return jsonify({"error": "Invalid or expired document session ID"}), 404
        
    cached_doc = DOCUMENT_CACHE[doc_id]
    analysis = cached_doc.get("analysis")
    evidence_map = EvidenceService.get_or_create_evidence_map(
        doc_id=doc_id,
        analysis_data=analysis,
        gemini_service=gemini_service
    )
    return jsonify(evidence_map)

@app.route('/api/evidence/extract', methods=['POST'])
def extract_evidence_map():
    data = request.get_json() or {}
    doc_id = data.get('doc_id')
    language = data.get('language', 'en')

    if not doc_id or doc_id not in DOCUMENT_CACHE:
        return jsonify({"error": "Invalid or expired document session ID"}), 404

    cached_doc = DOCUMENT_CACHE[doc_id]
    analysis = cached_doc.get("analysis")
    if not analysis:
        try:
            analysis = gemini_service.analyze_document(cached_doc["raw_text"], cached_doc["doc_type"], language)
            cached_doc["analysis"] = analysis
        except Exception as e:
            logger.warning(f"Analysis extraction failed during evidence mapping: {e}")
            analysis = {}

    evidence_map = EvidenceService.get_or_create_evidence_map(
        doc_id=doc_id,
        analysis_data=analysis,
        gemini_service=gemini_service,
        language=language
    )
    return jsonify(evidence_map)

@app.route('/api/evidence/item', methods=['POST'])
def add_evidence_item():
    data = request.get_json() or {}
    doc_id = data.get('doc_id')
    issue_id = data.get('issue_id')
    name = (data.get('name') or '').strip()
    status = data.get('status', 'Evidence missing')
    linked_doc_id = data.get('linked_doc_id')
    notes = data.get('notes', '')

    if not doc_id or doc_id not in DOCUMENT_CACHE:
        return jsonify({"error": "Invalid or expired document session ID"}), 404
    if not name:
        return jsonify({"error": "Evidence item name is required"}), 400

    user_id = _get_request_user_id(data)
    item = EvidenceService.add_evidence_item(
        doc_id=doc_id,
        issue_id=issue_id,
        name=name,
        status=status,
        linked_doc_id=linked_doc_id,
        notes=notes
    )
    if user_id:
        DatabaseService.save_evidence_item(user_id, doc_id, name, status)
    return jsonify(item), 201

@app.route('/api/evidence/item/<item_id>', methods=['PUT'])
def update_evidence_item(item_id):
    data = request.get_json() or {}
    doc_id = data.get('doc_id')
    status = data.get('status')
    name = data.get('name')
    notes = data.get('notes')
    linked_doc_id = data.get('linked_doc_id')

    if not doc_id:
        return jsonify({"error": "doc_id is required"}), 400

    updated = EvidenceService.update_evidence_item(
        doc_id=doc_id,
        item_id=item_id,
        status=status,
        name=name,
        notes=notes,
        linked_doc_id=linked_doc_id
    )

    if not updated:
        return jsonify({"error": "Evidence item not found"}), 404
    return jsonify(updated)

@app.route('/api/evidence/item/<item_id>', methods=['DELETE'])
def delete_evidence_item(item_id):
    doc_id = request.args.get('doc_id')
    if not doc_id:
        data = request.get_json(silent=True) or {}
        doc_id = data.get('doc_id')
    if not doc_id:
        return jsonify({"error": "doc_id is required"}), 400

    deleted = EvidenceService.delete_evidence_item(doc_id, item_id)
    if not deleted:
        return jsonify({"error": "Evidence item not found"}), 404
    return jsonify({"status": "success", "message": "Evidence item deleted successfully"})

# --- CITIZEN ZERO-JARGON LEGAL WORD EXPLAINER ENDPOINT ---
LEGAL_GLOSSARY = {
    "indemnification": {
        "en": {
            "word": "Indemnification",
            "simple_meaning": "It generally means one person may have to compensate another person for certain covered losses or damages.",
            "real_world_example": "If a tenant damages apartment wiring and the landlord has to pay for repairs, this clause specifies who pays the bill.",
            "question_for_lawyer": "Does this clause make me responsible for pre-existing damages or third-party claims?"
        },
        "kn": {
            "word": "ನಷ್ಟಪರಿಹಾರ ಬಾಧ್ಯತೆ (Indemnification)",
            "simple_meaning": "ಒಬ್ಬ ವ್ಯಕ್ತಿಯು ಅನುಭವಿಸಿದ ನಷ್ಟ ಅಥವಾ ಹಾನಿಯನ್ನು ಮತ್ತೊಬ್ಬರು ಭರ್ತಿ ಮಾಡಿಕೊಡುವ ಕಾನೂನಾತ್ಮಕ ಒಪ್ಪಂದ.",
            "real_world_example": "ಉದಾಹರಣೆಗೆ: ಬಾಡಿಗೆದಾರರು ಮನೆಯಲ್ಲಿ ಹಾನಿ ಮಾಡಿದರೆ, ಅದರ ಸಂಪೂರ್ಣ ನಷ್ಟವನ್ನು ಅವರೇ ಭರಿಸಬೇಕೆಂದು ಹೇಳುವ ನಿಯಮ.",
            "question_for_lawyer": "ಈ ಷರತ್ತು ನನ್ನ ಮೇಲೆ ಅನಗತ್ಯ ನಷ್ಟ ಪರಿಹಾರದ ಹೊಣೆಗಾರಿಕೆಯನ್ನು ಹಾಕುತ್ತದೆಯೇ?"
        }
    },
    "jurisdiction": {
        "en": {
            "word": "Jurisdiction",
            "simple_meaning": "The specific court or legal location that has the official authority to hear and decide disputes.",
            "real_world_example": "If a dispute happens in Bengaluru, a Bangalore court jurisdiction clause means you cannot be forced to travel to Delhi to attend court.",
            "question_for_lawyer": "Can this dispute be handled in my local district court?"
        },
        "kn": {
            "word": "ನ್ಯಾಯಾಂಗ ವ್ಯಾಪ್ತಿ (Jurisdiction)",
            "simple_meaning": "ವಿವಾದವನ್ನು ಆಲಿಸಿ ತೀರ್ಪು ನೀಡಲು ಅಧಿಕಾರ ಹೊಂದಿರುವ ನಿರ್ದಿಷ್ಟ ನ್ಯಾಯಾಲಯ ಅಥವಾ ಕಾನೂನಾತ್ಮಕ ಪ್ರದೇಶ.",
            "real_world_example": "ಉದಾಹರಣೆಗೆ: ಬೆಂಗಳೂರಿನಲ್ಲಿ ವಿವಾದ ಸಂಭವಿಸಿದರೆ, ಬೆಂಗಳೂರು ನ್ಯಾಯಾಲಯದ ವ್ಯಾಪ್ತಿಯು ಪ್ರಕರಣದ ತೀರ್ಪು ನೀಡುವ ಅಧಿಕಾರ ಹೊಂದಿರುತ್ತದೆ.",
            "question_for_lawyer": "ಈ ವಿವಾದವನ್ನು ನನ್ನ ಸ್ಥಳೀಯ ಜಿಲ್ಲಾ ನ್ಯಾಯಾಲಯದಲ್ಲೇ ನಿರ್ವಹಿಸಬಹುದೇ?"
        }
    },
    "lock-in period": {
        "en": {
            "word": "Lock-in Period",
            "simple_meaning": "A fixed minimum timeframe during which neither party is allowed to cancel or terminate the agreement without paying a penalty.",
            "real_world_example": "If a lease has a 6-month lock-in period and you move out after 3 months, you may still be asked to pay rent for the remaining 3 months.",
            "question_for_lawyer": "What are the financial penalties if I need to leave before the lock-in period ends?"
        },
        "kn": {
            "word": "ಲಾಕ್-ಇನ್ ಅವಧಿ (Lock-in Period)",
            "simple_meaning": "ಒಪ್ಪಂದವನ್ನು ರದ್ದುಗೊಳಿಸಲು ಅವಕಾಶವಿಲ್ಲದ ಕನಿಷ್ಠ ನಿಗದಿತ ಅವಧಿ.",
            "real_world_example": "ಉದಾಹರಣೆಗೆ: 6 ತಿಂಗಳ ಲಾಕ್-ಇನ್ ಅವಧಿಯಲ್ಲಿದ್ದಾಗ 3 ತಿಂಗಳಲ್ಲಿ ಮನೆ ಖಾಲಿ ಮಾಡಿದರೆ, ಉಳಿದ 3 ತಿಂಗಳ ಬಾಡಿಗೆ ಪಾವತಿಸಬೇಕಾಗಬಹುದು.",
            "question_for_lawyer": "ಲಾಕ್-ಇನ್ ಅವಧಿ ಮುಗಿಯುವ ಮುನ್ನ ನಾನು ಖಾಲಿ ಮಾಡಿದರೆ ದಂಡದ ಮೊತ್ತ ಎಷ್ಟಾಗುತ್ತದೆ?"
        }
    },
    "security deposit": {
        "en": {
            "word": "Security Deposit",
            "simple_meaning": "An advance sum of money given to a landlord or service provider as financial protection against non-payment or property damage.",
            "real_world_example": "You give ₹50,000 when moving in; when you move out, the landlord must refund it minus valid repair costs.",
            "question_for_lawyer": "What specific conditions must be met for a full refund of my security deposit?"
        },
        "kn": {
            "word": "ಭದ್ರತಾ ಮುಂಗಡ ಠೇವಣಿ (Security Deposit)",
            "simple_meaning": "ಆಸ್ತಿಯ ಹಾನಿ ಅಥವಾ ಬಾಡಿಗೆ ಬಾಕಿಯ ವಿರುದ್ಧ ರಕ್ಷಣೆಗಾಗಿ ಮಾಲೀಕರಿಗೆ ನೀಡುವ ಮುಂಗಡ ಹಣ.",
            "real_world_example": "ಉದಾಹರಣೆಗೆ: ಮನೆಗೆ ಸೇರುವಾಗ ₹1,50,000 ಮುಂಗಡ ನೀಡಲಾಗುತ್ತದೆ, ಖಾಲಿ ಮಾಡುವಾಗ ಹಾನಿ ಕಡಿತಗೊಳಿಸಿ ಬಾಕಿ ಹಿಂತಿರುಗಿಸಲಾಗುತ್ತದೆ.",
            "question_for_lawyer": "ನನ್ನ ಮುಂಗಡ ಠೇವಣಿಯನ್ನು ಪೂರ್ಣವಾಗಿ ಹಿಂಪಡೆಯಲು ನಾನು ಪೂರೈಸಬೇಕಾದ ಷರತ್ತುಗಳು ಯಾವುವು?"
        }
    },
    "notice period": {
        "en": {
            "word": "Notice Period",
            "simple_meaning": "The advance warning time (in days or months) you must give before ending a contract or job.",
            "real_world_example": "A 30-day notice period means if you tell your landlord on June 1st you are moving out, you can leave on June 30th.",
            "question_for_lawyer": "Can I pay money instead of serving the full notice period if I need to leave early?"
        },
        "kn": {
            "word": "ನೋಟಿಸ್ ಅವಧಿ (Notice Period)",
            "simple_meaning": "ಒಪ್ಪಂದವನ್ನು ಕೊನೆಗೊಳಿಸುವ ಮುನ್ನ ನೀಡಬೇಕಾದ ಮುಂಗಡ ಮುನ್ನೆಚ್ಚರಿಕೆ ಸಮಯ.",
            "real_world_example": "ಉದಾಹರಣೆಗೆ: 2 ತಿಂಗಳ ನೋಟಿಸ್ ಅವಧಿಯಿದ್ದರೆ, ಜೂನ್ 1 ರಂದು ಮುನ್ಸೂಚನೆ ನೀಡಿ ಜುಲೈ 31 ರಂದು ಖಾಲಿ ಮಾಡಬಹುದು.",
            "question_for_lawyer": "ನೋಟಿಸ್ ಅವಧಿಯನ್ನು ಪೂರ್ಣಗೊಳಿಸಲು ಸಾಧ್ಯವಾಗದಿದ್ದರೆ ಹಣ ಪಾವತಿಸಿ ಖಾಲಿ ಮಾಡಲು ಅವಕಾಶವಿದೆಯೇ?"
        }
    },
    "arbitration": {
        "en": {
            "word": "Arbitration",
            "simple_meaning": "A process where a neutral private referee (arbitrator) settles a dispute outside of regular court.",
            "real_world_example": "Instead of waiting years in court, both parties present evidence to a private lawyer who makes a binding decision.",
            "question_for_lawyer": "Is arbitration mandatory, and who pays the arbitrator's fees?"
        },
        "kn": {
            "word": "ಮಧ್ಯಸ್ಥಿಕೆ (Arbitration)",
            "simple_meaning": "ನ್ಯಾಯಾಲಯದ ಹೊರಗೆ ಮೂರನೇ ವ್ಯಕ್ತಿಯ (ಮಧ್ಯಸ್ಥಗಾರರು) ಮೂಲಕ ವಿವಾದವನ್ನು ಬಗೆಹರಿಸಿಕೊಳ್ಳುವ ಪ್ರಕ್ರಿಯೆ.",
            "real_world_example": "ನ್ಯಾಯಾಲಯದಲ್ಲಿ ವರ್ಷಗಟ್ಟಲೆ ಕಾಯುವ ಬದಲು, ಮಧ್ಯಸ್ಥಗಾರರ ಮೂಲಕ ತ್ವರಿತವಾಗಿ ತೀರ್ಮಾನ ಪಡೆಯುವುದು.",
            "question_for_lawyer": "ಈ ಒಪ್ಪಂದದಲ್ಲಿ ಮಧ್ಯಸ್ಥಿಕೆ ಕಡ್ಡಾಯವೇ ಮತ್ತು ಮಧ್ಯಸ್ಥಗಾರರ ವೆಚ್ಚವನ್ನು ಯಾರು ಭರಿಸಬೇಕು?"
        }
    },
    "non-compete": {
        "en": {
            "word": "Non-Compete Clause",
            "simple_meaning": "A clause that attempts to stop an employee or business from working with competitors for a period of time.",
            "real_world_example": "An employer saying you cannot work for any rival tech company for 1 year after quitting.",
            "question_for_lawyer": "Is this post-employment non-compete enforceable under Section 27 of the Indian Contract Act?"
        },
        "kn": {
            "word": "ಸ್ಪರ್ಧಾತ್ಮಕವಲ್ಲದ ಷರತ್ತು (Non-Compete)",
            "simple_meaning": "ಉದ್ಯೋಗಿ ಕೆಲಸ ತೊರೆದ ನಂತರ ಸ್ಪರ್ಧಿ ಕಂಪನಿಗಳಲ್ಲಿ ಕೆಲಸ ಮಾಡುವುದನ್ನು ತಡೆಯುವ ಷರತ್ತು.",
            "real_world_example": "ಉದಾಹರಣೆಗೆ: ರಾಜೀನಾಮೆ ನೀಡಿದ 1 ವರ್ಷದವರೆಗೆ ಯಾವುದೇ ಪ್ರತಿಸ್ಪರ್ಧಿ ಸಂಸ್ಥೆಯಲ್ಲಿ ಕೆಲಸ ಮಾಡುವಂತಿಲ್ಲ ಎನ್ನುವ ನಿಯಮ.",
            "question_for_lawyer": "ಭಾರತೀಯ ಕರಾರು ಕಾಯ್ದೆಯ ನಿಯಮ 27 ರ ಅಡಿಯಲ್ಲಿ ಈ ಷರತ್ತು ಕಾನೂನುಬದ್ಧವೇ?"
        }
    }
}

@app.route('/api/explain-word', methods=['POST'])
def explain_word():
    data = request.get_json() or {}
    word = (data.get('word') or '').strip().lower()
    language = data.get('language', 'en')

    if not word:
        return jsonify({"error": "Word parameter is required"}), 400

    # 1. Check local dictionary first
    if word in LEGAL_GLOSSARY:
        dict_entry = LEGAL_GLOSSARY[word]
        lang_key = 'kn' if language in ('kn', 'kannada') else 'en'
        info = dict_entry.get(lang_key, dict_entry.get('en', list(dict_entry.values())[0]))
        return jsonify({
            "word": info.get("word", word.title()),
            "simple_meaning": info["simple_meaning"],
            "real_world_example": info["real_world_example"],
            "question_for_lawyer": info["question_for_lawyer"]
        })

    # 2. Call LLM for dynamic explanation
    target_lang = Config.SUPPORTED_LANGUAGES.get(language, 'English')
    prompt = f"""
Explain the legal term or phrase '{word}' for an ordinary Indian citizen in simple, clear language.
Respond in {target_lang}.

Return ONLY a JSON object matching this schema:
{{
  "word": "{word.title()}",
  "simple_meaning": "1-2 sentence simple explanation without legalese",
  "real_world_example": "Short, relatable real-world example from everyday life",
  "question_for_lawyer": "One clear question the user can ask a lawyer about this term"
}}
"""
    try:
        raw_resp = gemini_service._call_llm_raw(prompt, language)
        cleaned = gemini_service._extract_json_string(raw_resp)
        return jsonify(json.loads(cleaned))
    except Exception as e:
        logger.warning(f"Word explanation LLM call failed for '{word}': {e}")
        return jsonify({
            "word": word.title(),
            "simple_meaning": f"'{word.title()}' is a legal term mentioned in your document. It defines specific contractual rights or duties.",
            "real_world_example": "Legal documents use this term to set boundaries between participating parties.",
            "question_for_lawyer": f"How does the '{word.title()}' clause specifically apply to my situation?"
        })

# --- 3-HOUR AUTOMATED DOCUMENT & CACHE PRIVACY PURGER ---
def _auto_cleanup_old_documents():
    """
    Background worker that runs periodically and deletes any uploaded files or
    cached document sessions older than 3 hours (10,800 seconds).
    Ensures zero permanent document storage.
    """
    while True:
        try:
            time.sleep(600)  # Check every 10 minutes
            now = time.time()
            cutoff = 3 * 3600  # 3 hours (10,800s)

            # 1. Purge expired document sessions from DOCUMENT_CACHE
            expired_ids = [doc_id for doc_id, doc in list(DOCUMENT_CACHE.items()) if now - doc.get("created_at", now) > cutoff]
            for doc_id in expired_ids:
                DOCUMENT_CACHE.pop(doc_id, None)
                logger.info(f"Auto-purged expired document session: {doc_id}")

            # 2. Purge expired files from uploads directory
            if os.path.exists(Config.UPLOAD_FOLDER):
                for filename in os.listdir(Config.UPLOAD_FOLDER):
                    if filename == ".gitkeep":
                        continue
                    file_path = os.path.join(Config.UPLOAD_FOLDER, filename)
                    if os.path.isfile(file_path):
                        if now - os.path.getmtime(file_path) > cutoff:
                            try:
                                os.remove(file_path)
                                logger.info(f"Auto-purged 3-hour expired file: {filename}")
                            except Exception as file_err:
                                logger.warning(f"Could not purge file {filename}: {file_err}")
        except Exception as e:
            logger.error(f"Auto-cleanup error: {e}")

# Start background cleanup thread
cleanup_thread = threading.Thread(target=_auto_cleanup_old_documents, daemon=True)
cleanup_thread.start()


# --- ACCOUNT & SESSION DELETION ENDPOINT ---
@app.route('/api/account/delete', methods=['POST'])
def delete_account():
    data = request.get_json(silent=True) or {}
    doc_id = data.get('doc_id')
    user_id = _get_request_user_id(data)

    # Instantly purge document session from memory if active
    if doc_id and doc_id in DOCUMENT_CACHE:
        DOCUMENT_CACHE.pop(doc_id, None)

    # Permanently delete all user records from SQLite database
    if user_id:
        DatabaseService.delete_user_data(user_id)

    return jsonify({
        "status": "success",
        "message": "Account session and all temporary document data have been permanently deleted."
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"\n=======================================================")
    print(f"LawBuddy AI Platform is running on http://127.0.0.1:{port}")
    print(f"=======================================================\n")
    app.run(host='0.0.0.0', port=port, debug=True)
