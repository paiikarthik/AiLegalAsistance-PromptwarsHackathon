import os
import sqlite3
import json
import logging
from datetime import datetime

logger = logging.getLogger("lawbuddy")

DB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "data"))
DB_PATH = os.path.join(DB_DIR, "lawbuddy.db")

def get_db_connection():
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10.0)
    conn.row_factory = sqlite3.Row
    return conn

class DatabaseService:
    @staticmethod
    def init_db():
        """Initialize database schema for permanent storage of user accounts and case data."""
        os.makedirs(DB_DIR, exist_ok=True)
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            
            # Users table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    user_id TEXT PRIMARY KEY,
                    email TEXT UNIQUE,
                    name TEXT,
                    password TEXT DEFAULT '',
                    auth_provider TEXT DEFAULT 'email',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    last_login TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Migration check for password column on existing SQLite DBs
            try:
                cursor.execute("ALTER TABLE users ADD COLUMN password TEXT DEFAULT ''")
            except Exception:
                pass

            # User documents table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_documents (
                    doc_id TEXT PRIMARY KEY,
                    user_id TEXT,
                    filename TEXT,
                    doc_type TEXT,
                    raw_text TEXT,
                    analysis_json TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
                )
            """)

            # User case evidence table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_case_evidence (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    doc_id TEXT,
                    evidence_text TEXT NOT NULL,
                    status TEXT DEFAULT 'user_added',
                    category TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
                )
            """)

            # Factual claims table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_case_facts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    doc_id TEXT,
                    claim_title TEXT NOT NULL,
                    claim_details TEXT,
                    claim_category TEXT DEFAULT 'Claim',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
                )
            """)

            # User chat history table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS user_chat_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id TEXT,
                    doc_id TEXT,
                    sender TEXT NOT NULL,
                    message TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
                )
            """)

            conn.commit()
            logger.info(f"SQLite database initialized at {DB_PATH}")
        except Exception as e:
            logger.error(f"Failed to initialize database: {e}")
        finally:
            conn.close()

    @staticmethod
    def register_user(user_id, email, password, name=None, auth_provider='email'):
        if not user_id or not email:
            return None, "user_id and email are required"
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            email_clean = email.lower().strip()
            
            cursor.execute("SELECT user_id FROM users WHERE email = ?", (email_clean,))
            if cursor.fetchone():
                return None, "This email is already registered. Please log in instead."
            
            now = datetime.utcnow().isoformat()
            cursor.execute("""
                INSERT INTO users (user_id, email, name, password, auth_provider, created_at, last_login)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (user_id, email_clean, name or email_clean.split('@')[0], password or "", auth_provider, now, now))
            conn.commit()
            return {"user_id": user_id, "email": email_clean, "name": name or email_clean.split('@')[0]}, None
        except Exception as e:
            logger.error(f"Error registering user: {e}")
            return None, str(e)
        finally:
            conn.close()

    @staticmethod
    def verify_user_credentials(email, password):
        if not email or not password:
            return False, None, "Email address and password are required"
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            email_clean = email.lower().strip()
            cursor.execute("SELECT * FROM users WHERE email = ?", (email_clean,))
            row = cursor.fetchone()
            if not row:
                return False, None, "No account found with this email. Please sign up first."
            
            user = dict(row)
            if user.get("password") and user["password"] != password:
                return False, None, "Invalid email or password. Please try again."
            
            now = datetime.utcnow().isoformat()
            cursor.execute("UPDATE users SET last_login = ? WHERE user_id = ?", (now, user["user_id"]))
            conn.commit()
            
            user_data = {
                "uid": user["user_id"],
                "user_id": user["user_id"],
                "email": user["email"],
                "name": user["name"] or user["email"].split('@')[0]
            }
            return True, user_data, None
        except Exception as e:
            logger.error(f"Error verifying user credentials: {e}")
            return False, None, "Authentication error. Please try again."
        finally:
            conn.close()

    @staticmethod
    def upsert_user(user_id, email, name=None, password=None, auth_provider='email'):
        if not user_id or not email:
            return None
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            now = datetime.utcnow().isoformat()
            cursor.execute("""
                INSERT INTO users (user_id, email, name, password, auth_provider, created_at, last_login)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    email = excluded.email,
                    name = COALESCE(excluded.name, users.name),
                    password = CASE WHEN excluded.password != '' THEN excluded.password ELSE users.password END,
                    auth_provider = excluded.auth_provider,
                    last_login = excluded.last_login
            """, (user_id, email.lower().strip(), name or email.split('@')[0], password or "", auth_provider, now, now))
            conn.commit()
            return {"user_id": user_id, "email": email, "name": name}
        except Exception as e:
            logger.error(f"Error upserting user: {e}")
            return None
        finally:
            conn.close()

    @staticmethod
    def save_document(doc_id, user_id, filename, doc_type, raw_text, analysis=None):
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            now = datetime.utcnow().isoformat()
            analysis_str = json.dumps(analysis) if isinstance(analysis, (dict, list)) else (analysis or "")
            
            cursor.execute("""
                INSERT INTO user_documents (doc_id, user_id, filename, doc_type, raw_text, analysis_json, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(doc_id) DO UPDATE SET
                    user_id = COALESCE(excluded.user_id, user_documents.user_id),
                    filename = excluded.filename,
                    doc_type = excluded.doc_type,
                    raw_text = excluded.raw_text,
                    analysis_json = CASE WHEN excluded.analysis_json != '' THEN excluded.analysis_json ELSE user_documents.analysis_json END,
                    updated_at = excluded.updated_at
            """, (doc_id, user_id or "anonymous", filename, doc_type, raw_text, analysis_str, now, now))
            conn.commit()
            logger.info(f"Saved document {doc_id} for user {user_id} to database.")
        except Exception as e:
            logger.error(f"Error saving document to database: {e}")
        finally:
            conn.close()

    @staticmethod
    def update_document_analysis(doc_id, analysis):
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            now = datetime.utcnow().isoformat()
            analysis_str = json.dumps(analysis) if isinstance(analysis, (dict, list)) else (analysis or "")
            cursor.execute("""
                UPDATE user_documents
                SET analysis_json = ?, updated_at = ?
                WHERE doc_id = ?
            """, (analysis_str, now, doc_id))
            conn.commit()
        except Exception as e:
            logger.error(f"Error updating document analysis: {e}")
        finally:
            conn.close()

    @staticmethod
    def get_document(doc_id):
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM user_documents WHERE doc_id = ?", (doc_id,))
            row = cursor.fetchone()
            if not row:
                return None
            doc = dict(row)
            if doc.get("analysis_json"):
                try:
                    doc["analysis"] = json.loads(doc["analysis_json"])
                except Exception:
                    doc["analysis"] = None
            return doc
        except Exception as e:
            logger.error(f"Error fetching document {doc_id}: {e}")
            return None
        finally:
            conn.close()

    @staticmethod
    def get_latest_user_document(user_id):
        if not user_id:
            return None
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM user_documents
                WHERE user_id = ?
                ORDER BY updated_at DESC LIMIT 1
            """, (user_id,))
            row = cursor.fetchone()
            if not row:
                return None
            doc = dict(row)
            if doc.get("analysis_json"):
                try:
                    doc["analysis"] = json.loads(doc["analysis_json"])
                except Exception:
                    doc["analysis"] = None
            return doc
        except Exception as e:
            logger.error(f"Error fetching latest document for user {user_id}: {e}")
            return None
    @staticmethod
    def get_user_documents(user_id):
        if not user_id:
            return []
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT doc_id, user_id, filename, doc_type, created_at, updated_at, analysis_json
                FROM user_documents
                WHERE user_id = ?
                ORDER BY updated_at DESC
            """, (user_id,))
            rows = cursor.fetchall()
            docs = []
            for r in rows:
                d = dict(r)
                d["has_analysis"] = bool(d.get("analysis_json") and len(d["analysis_json"]) > 10)
                d.pop("analysis_json", None)
                docs.append(d)
            return docs
        except Exception as e:
            logger.error(f"Error fetching user documents for user {user_id}: {e}")
            return []
        finally:
            conn.close()

    @staticmethod
    def save_evidence_item(user_id, doc_id, evidence_text, status='user_added', category=None):
        if not user_id or not evidence_text:
            return None
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO user_case_evidence (user_id, doc_id, evidence_text, status, category)
                VALUES (?, ?, ?, ?, ?)
            """, (user_id, doc_id or "", evidence_text.strip(), status, category or "Document Evidence"))
            conn.commit()
            return cursor.lastrowid
        except Exception as e:
            logger.error(f"Error saving evidence item: {e}")
            return None
        finally:
            conn.close()

    @staticmethod
    def get_user_evidence(user_id, doc_id=None):
        if not user_id:
            return []
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            if doc_id:
                cursor.execute("""
                    SELECT * FROM user_case_evidence
                    WHERE user_id = ? AND (doc_id = ? OR doc_id = '' OR doc_id IS NULL)
                    ORDER BY created_at ASC
                """, (user_id, doc_id))
            else:
                cursor.execute("""
                    SELECT * FROM user_case_evidence
                    WHERE user_id = ?
                    ORDER BY created_at ASC
                """, (user_id,))
            rows = cursor.fetchall()
            return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Error fetching user evidence: {e}")
            return []
        finally:
            conn.close()

    @staticmethod
    def save_case_fact(user_id, doc_id, claim_title, claim_details="", claim_category="Claim"):
        if not user_id or not claim_title:
            return None
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO user_case_facts (user_id, doc_id, claim_title, claim_details, claim_category)
                VALUES (?, ?, ?, ?, ?)
            """, (user_id, doc_id or "", claim_title.strip(), claim_details.strip(), claim_category))
            conn.commit()
            return cursor.lastrowid
        except Exception as e:
            logger.error(f"Error saving case fact: {e}")
            return None
        finally:
            conn.close()

    @staticmethod
    def get_user_case_facts(user_id, doc_id=None):
        if not user_id:
            return []
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            if doc_id:
                cursor.execute("""
                    SELECT * FROM user_case_facts
                    WHERE user_id = ? AND (doc_id = ? OR doc_id = '' OR doc_id IS NULL)
                    ORDER BY created_at ASC
                """, (user_id, doc_id))
            else:
                cursor.execute("""
                    SELECT * FROM user_case_facts
                    WHERE user_id = ?
                    ORDER BY created_at ASC
                """, (user_id,))
            rows = cursor.fetchall()
            return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Error fetching case facts: {e}")
            return []
        finally:
            conn.close()

    @staticmethod
    def save_chat_message(user_id, doc_id, sender, message):
        if not user_id or not message:
            return None
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO user_chat_history (user_id, doc_id, sender, message)
                VALUES (?, ?, ?, ?)
            """, (user_id, doc_id or "", sender, message))
            conn.commit()
        except Exception as e:
            logger.error(f"Error saving chat message: {e}")
        finally:
            conn.close()

    @staticmethod
    def get_chat_history(user_id, doc_id=None):
        if not user_id:
            return []
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            if doc_id:
                cursor.execute("""
                    SELECT * FROM user_chat_history
                    WHERE user_id = ? AND (doc_id = ? OR doc_id = '')
                    ORDER BY created_at ASC
                """, (user_id, doc_id))
            else:
                cursor.execute("""
                    SELECT * FROM user_chat_history
                    WHERE user_id = ?
                    ORDER BY created_at ASC
                """, (user_id,))
            rows = cursor.fetchall()
            return [dict(r) for r in rows]
        except Exception as e:
            logger.error(f"Error fetching chat history: {e}")
            return []
        finally:
            conn.close()

    @staticmethod
    def delete_user_data(user_id):
        if not user_id:
            return
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM user_case_evidence WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM user_case_facts WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM user_chat_history WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM user_documents WHERE user_id = ?", (user_id,))
            cursor.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
            conn.commit()
            logger.info(f"Permanently deleted all user data for user {user_id}")
        except Exception as e:
            logger.error(f"Error deleting user data: {e}")
        finally:
            conn.close()
