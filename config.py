import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

class Config:
    SECRET_KEY = os.environ.get('SECRET_KEY', 'lawbuddy-hackathon-secret-key-2026')
    GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY', '')
    
    # Model preferences
    PRIMARY_MODEL = 'gemini-2.5-flash'  # Default fast model
    FALLBACK_MODEL = 'gemini-1.5-flash'
    PRO_MODEL = 'gemini-2.5-pro'
    
    # Upload settings
    UPLOAD_FOLDER = os.path.join(BASE_DIR, 'uploads')
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16 MB max limit
    ALLOWED_EXTENSIONS = {'pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg'}
    
    # Supported Indian Languages
    SUPPORTED_LANGUAGES = {
        'en': 'English',
        'kn': 'Kannada (ಕನ್ನಡ)',
        'hi': 'Hindi (हिंदी)',
        'ml': 'Malayalam (മലയാളം)',
        'te': 'Telugu (తెలుగు)',
        'mr': 'Marathi (मराठी)',
        'bn': 'Bengali (বাংলা)',
        'gu': 'Gujarati (ગુજરાતી)',
        'tulu': 'Tulu (ತುಳು)'
    }

# Ensure upload directory exists
os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
