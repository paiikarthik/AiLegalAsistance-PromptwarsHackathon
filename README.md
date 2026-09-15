# LawBuddy AI

LawBuddy is a Flask-based legal-document assistant. It accepts PDF, DOCX,
TXT, PNG, and JPG documents, extracts their text, and provides analysis,
document comparison, and a document-grounded chat interface.

## Run locally

1. Create and activate a virtual environment.
2. Install dependencies: `pip install -r requirements.txt`
3. Optionally add `GEMINI_API_KEY=...` to a `.env` file. Without a key, the
   application uses its built-in demo/fallback responses.
4. Start the server: `python app.py`
5. Open `http://127.0.0.1:5000/login.html` in your browser. Do not open the
   HTML file directly from the file system; uploads require the Flask server.

Uploads are limited to 16 MB. Upload errors are returned as readable messages
in the page instead of raw JSON parsing errors.
