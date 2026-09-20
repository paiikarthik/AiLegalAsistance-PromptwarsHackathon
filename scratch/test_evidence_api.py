import sys
sys.path.insert(0, '.')
import json
from app import app

client = app.test_client()

def test_evidence_endpoints():
    print("1. Uploading test document...")
    r = client.post('/api/upload', json={
        "text": "RENTAL AGREEMENT\nClause 7: Tenant has paid a security deposit of RS 50,000 to Landlord. Rent of RS 25,000 payable on 5th of every month. Notice period for termination is 2 months.",
        "filename": "Rental_Agreement_Evidence_Test.txt"
    })
    assert r.status_code == 200
    doc_id = r.get_json()["doc_id"]
    print("Doc uploaded, doc_id:", doc_id)

    print("2. Extracting evidence map...")
    r = client.post('/api/evidence/extract', json={"doc_id": doc_id, "language": "en"})
    assert r.status_code == 200
    evidence_data = r.get_json()
    assert "issues" in evidence_data
    assert len(evidence_data["issues"]) > 0
    print("Extracted issues count:", len(evidence_data["issues"]))

    issue_id = evidence_data["issues"][0]["issue_id"]

    print("3. Adding manual evidence item...")
    r = client.post('/api/evidence/item', json={
        "doc_id": doc_id,
        "issue_id": issue_id,
        "name": "HDFC Bank Statement June 2025",
        "status": "Evidence found",
        "notes": "Shows RS 50,000 transfer to landlord"
    })
    assert r.status_code == 201
    item = r.get_json()
    item_id = item["item_id"]
    assert item["status"] == "Evidence found"
    print("Added evidence item:", item_id, item["name"])

    print("4. Updating evidence item status...")
    r = client.put(f'/api/evidence/item/{item_id}', json={
        "doc_id": doc_id,
        "status": "Requires verification",
        "notes": "Bank statement verified by tenant"
    })
    assert r.status_code == 200
    updated = r.get_json()
    assert updated["status"] == "Requires verification"
    print("Updated evidence item status:", updated["status"])

    print("5. Deleting evidence item...")
    r = client.delete(f'/api/evidence/item/{item_id}?doc_id={doc_id}')
    assert r.status_code == 200
    print("Deleted evidence item successfully.")

    print("[SUCCESS] ALL EVIDENCE API ENDPOINT TESTS PASSED!")

if __name__ == '__main__':
    test_evidence_endpoints()
