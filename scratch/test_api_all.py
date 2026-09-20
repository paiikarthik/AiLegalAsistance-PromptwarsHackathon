import os
import json
from app import app, Config

client = app.test_client()

def test_all():
    print("1. Testing /api/health...")
    r = client.get('/api/health')
    assert r.status_code == 200
    data = r.get_json()
    print("Health response status:", data.get("status"))
    assert data["status"] == "online"

    print("2. Testing /api/sample-demo...")
    r = client.get('/api/sample-demo')
    assert r.status_code == 200
    sample_data = r.get_json()
    doc_id = sample_data["doc_id"]

    print("3. Testing /api/analyze for sample doc (English -> Gemini)...")
    r = client.post('/api/analyze', json={
        "doc_id": doc_id,
        "doc_type": "Eviction Notice",
        "language": "en"
    })
    assert r.status_code == 200
    analysis = r.get_json()
    assert "clarity_action_map" in analysis or "action_map" in analysis

    print("4. Testing /api/analyze for sample doc (Kannada -> ChatGPT)...")
    r = client.post('/api/analyze', json={
        "doc_id": doc_id,
        "doc_type": "Eviction Notice",
        "language": "kn"
    })
    assert r.status_code == 200
    kn_analysis = r.get_json()
    assert "clarity_action_map" in kn_analysis or "action_map" in kn_analysis

    print("5. Testing /api/upload with text content...")
    r = client.post('/api/upload', json={
        "text": "EMPLOYMENT CONTRACT\nThis employment agreement is made between Tech Corp India Pvt Ltd and Rahul Sharma. Position: Senior Software Engineer. Salary: RS 15,00,000 per annum. Notice Period: 90 days. Non-compete clause: Employee shall not join competitors within 6 months.",
        "filename": "Employment_Contract_Rahul.txt"
    })
    assert r.status_code == 200
    up_data = r.get_json()
    emp_doc_id = up_data["doc_id"]

    print("6. Testing /api/chat...")
    r = client.post('/api/chat', json={
        "doc_id": emp_doc_id,
        "query": "What is the notice period?",
        "language": "en"
    })
    assert r.status_code == 200

    print("7. Testing /api/official-sources...")
    r = client.get('/api/official-sources?topic=housing')
    assert r.status_code == 200
    sources = r.get_json()
    sources_list = sources if isinstance(sources, list) else sources.get("sources", [])
    assert len(sources_list) > 0

    print("[SUCCESS] ALL API TESTS PASSED CLEANLY!")

if __name__ == "__main__":
    test_all()
