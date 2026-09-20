import os
import json
from app import app, Config

client = app.test_client()

def test_all():
    print("1. Testing /api/health...")
    r = client.get('/api/health')
    assert r.status_code == 200
    data = r.get_json()
    print("Health response:", data)
    assert data["status"] == "online"
    assert data["gemini_active"] is True
    assert data["openai_active"] is True
    assert data["deepseek_active"] is True
    assert data["grok_active"] is True
    assert data["perplexity_active"] is True

    print("\n2. Testing /api/sample-demo...")
    r = client.get('/api/sample-demo')
    assert r.status_code == 200
    sample_data = r.get_json()
    print("Sample demo response doc_id:", sample_data.get("doc_id"))
    doc_id = sample_data["doc_id"]

    print("\n3. Testing /api/analyze for sample doc...")
    r = client.post('/api/analyze', json={
        "doc_id": doc_id,
        "doc_type": "Eviction Notice",
        "language": "en"
    })
    assert r.status_code == 200
    analysis = r.get_json()
    print("Analysis doc_type:", analysis.get("doc_type"))
    print("Overview summary:", analysis.get("overview_summary", "")[:100])
    assert "clarity_action_map" in analysis
    assert "facts_and_timeline" in analysis

    print("\n4. Testing /api/upload with text content...")
    r = client.post('/api/upload', json={
        "text": "EMPLOYMENT CONTRACT\nThis employment agreement is made between Tech Corp India Pvt Ltd and Rahul Sharma. Position: Senior Software Engineer. Salary: ₹15,00,000 per annum. Notice Period: 90 days. Non-compete clause: Employee shall not join competitors within 6 months.",
        "filename": "Employment_Contract_Rahul.txt"
    })
    assert r.status_code == 200
    up_data = r.get_json()
    emp_doc_id = up_data["doc_id"]
    print("Uploaded text doc_id:", emp_doc_id, "Detected type:", up_data.get("doc_type"))

    print("\n5. Testing /api/analyze for Employment Contract...")
    r = client.post('/api/analyze', json={
        "doc_id": emp_doc_id,
        "doc_type": "Employment Contract",
        "language": "en"
    })
    assert r.status_code == 200
    emp_analysis = r.get_json()
    print("Employment Contract summary:", emp_analysis.get("overview_summary", "")[:120])

    print("\n6. Testing /api/chat...")
    r = client.post('/api/chat', json={
        "doc_id": emp_doc_id,
        "query": "What is the notice period?",
        "language": "en"
    })
    assert r.status_code == 200
    chat_resp = r.get_json()
    print("Chat answer:", chat_resp.get("answer"))

    print("\n7. Testing /api/official-sources...")
    r = client.get('/api/official-sources?topic=housing')
    assert r.status_code == 200
    sources = r.get_json()
    print("Sources count:", len(sources.get("sources", [])))

    print("\nALL API TESTS PASSED SUCCESSFULLY! 🎉")

if __name__ == "__main__":
    test_all()
