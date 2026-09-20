import uuid
import logging
from typing import Dict, List, Optional

logger = logging.getLogger("lawbuddy.evidence")

# In-memory storage for evidence mappings and evidence items
EVIDENCE_STORE = {}

class EvidenceService:
    """
    Manages Evidence-to-Clause Mapping and Evidence Tracking.
    Connects important legal clauses with evidence categories and status tracking.
    Enforces neutral labeling: 'Evidence found', 'Evidence missing', 'Evidence suggested', 'Requires verification'.
    """

    NEUTRAL_STATUSES = {
        "found": "Evidence found",
        "missing": "Evidence missing",
        "suggested": "Evidence suggested",
        "verification_required": "Requires verification"
    }

    @staticmethod
    def get_or_create_evidence_map(doc_id: str, analysis_data: Dict = None, gemini_service = None, language: str = 'en') -> Dict:
        """
        Retrieves existing evidence map for doc_id, or extracts a new Evidence-to-Clause map.
        Reuses existing document analysis to avoid unnecessary parsing duplication.
        """
        if doc_id in EVIDENCE_STORE:
            return EVIDENCE_STORE[doc_id]

        evidence_entries = []

        if analysis_data:
            # 1. Extract from clauses and risks in existing analysis
            clauses_and_risks = analysis_data.get("clauses_and_risks", [])
            for idx, item in enumerate(clauses_and_risks, start=1):
                cat = item.get("category", "General Clause")
                orig = item.get("original_clause", "Clause text")
                ref = item.get("page_ref", f"Section {idx}")
                
                suggested_evidence = EvidenceService._infer_evidence_categories(cat, orig)
                
                entry_id = f"ev_issue_{idx}"
                evidence_entries.append({
                    "issue_id": entry_id,
                    "issue": cat,
                    "clause": orig,
                    "location": ref,
                    "suggested_evidence": suggested_evidence,
                    "items": [
                        {
                            "item_id": f"item_{uuid.uuid4().hex[:8]}",
                            "name": ev_name,
                            "status": "Evidence missing",
                            "linked_doc_id": None,
                            "notes": ""
                        }
                        for ev_name in suggested_evidence
                    ]
                })

            # 2. Extract from important dates and amounts
            dates_amounts = analysis_data.get("important_dates_and_amounts", [])
            for idx, item in enumerate(dates_amounts, start=101):
                item_name = item.get("item", "Financial Obligation")
                details = item.get("details", "")
                
                entry_id = f"ev_issue_{idx}"
                suggested = ["Bank transaction / UPI receipt", "Payment voucher / Cash receipt"]
                evidence_entries.append({
                    "issue_id": entry_id,
                    "issue": f"Financial / Date: {item_name}",
                    "clause": f"{item_name}: {details}",
                    "location": "Document Financial Terms",
                    "suggested_evidence": suggested,
                    "items": [
                        {
                            "item_id": f"item_{uuid.uuid4().hex[:8]}",
                            "name": ev_name,
                            "status": "Requires verification",
                            "linked_doc_id": None,
                            "notes": ""
                        }
                        for ev_name in suggested
                    ]
                })

        # Default fallback issue if analysis data is minimal
        if not evidence_entries:
            evidence_entries.append({
                "issue_id": "ev_issue_1",
                "issue": "Agreement Execution & Terms",
                "clause": "General terms and conditions of document",
                "location": "Page 1",
                "suggested_evidence": ["Original signed document copy", "Identity proof of signing parties"],
                "items": [
                    {
                        "item_id": f"item_{uuid.uuid4().hex[:8]}",
                        "name": "Original signed document copy",
                        "status": "Evidence found",
                        "linked_doc_id": doc_id,
                        "notes": "Uploaded primary document"
                    },
                    {
                        "item_id": f"item_{uuid.uuid4().hex[:8]}",
                        "name": "Identity proof of signing parties",
                        "status": "Evidence missing",
                        "linked_doc_id": None,
                        "notes": ""
                    }
                ]
            })

        evidence_map = {
            "doc_id": doc_id,
            "issues": evidence_entries
        }

        EVIDENCE_STORE[doc_id] = evidence_map
        return evidence_map

    @staticmethod
    def _infer_evidence_categories(category: str, clause_text: str) -> List[str]:
        cat_lower = (category or "").lower()
        clause_lower = (clause_text or "").lower()

        evidence = []
        if "deposit" in cat_lower or "deposit" in clause_lower:
            evidence.extend(["Bank transaction / UPI UTR statement", "Security deposit receipt", "Agreement copy", "Email / WhatsApp communication"])
        elif "rent" in cat_lower or "rent" in clause_lower or "ctc" in cat_lower or "financial" in cat_lower:
            evidence.extend(["Bank statement / Salary slip", "Payment receipt", "TDS / Form 16 record"])
        elif "notice" in cat_lower or "termination" in cat_lower or "eviction" in cat_lower:
            evidence.extend(["Written notice copy", "Postal acknowledgement card (RPAD)", "Email / Message dispatch proof"])
        elif "non-compete" in cat_lower or "lock-in" in cat_lower:
            evidence.extend(["Signed offer letter / Contract annexure", "Company policy handbook"])
        else:
            evidence.extend(["Payment receipt or bank record", "Written communication log", "Signed contract copy"])
            
        return list(dict.fromkeys(evidence)) # Deduplicate while preserving order

    @staticmethod
    def add_evidence_item(doc_id: str, issue_id: str, name: str, status: str = "Evidence missing", linked_doc_id: str = None, notes: str = "") -> Dict:
        evidence_map = EvidenceService.get_or_create_evidence_map(doc_id)
        
        target_issue = None
        for issue in evidence_map["issues"]:
            if issue["issue_id"] == issue_id:
                target_issue = issue
                break
                
        if not target_issue:
            # Create new issue group if issue_id not found
            target_issue = {
                "issue_id": issue_id or f"ev_issue_{len(evidence_map['issues'])+1}",
                "issue": "Custom Evidence Category",
                "clause": "User added requirement",
                "location": "User Defined",
                "suggested_evidence": [],
                "items": []
            }
            evidence_map["issues"].append(target_issue)

        valid_status = EvidenceService._normalize_status(status)

        new_item = {
            "item_id": f"item_{uuid.uuid4().hex[:8]}",
            "name": name,
            "status": valid_status,
            "linked_doc_id": linked_doc_id,
            "notes": notes
        }
        
        target_issue["items"].append(new_item)
        return new_item

    @staticmethod
    def update_evidence_item(doc_id: str, item_id: str, status: str = None, name: str = None, notes: str = None, linked_doc_id: str = None) -> Optional[Dict]:
        evidence_map = EVIDENCE_STORE.get(doc_id)
        if not evidence_map:
            return None

        for issue in evidence_map["issues"]:
            for item in issue["items"]:
                if item["item_id"] == item_id:
                    if status:
                        item["status"] = EvidenceService._normalize_status(status)
                    if name is not None:
                        item["name"] = name
                    if notes is not None:
                        item["notes"] = notes
                    if linked_doc_id is not None:
                        item["linked_doc_id"] = linked_doc_id
                    return item
        return None

    @staticmethod
    def delete_evidence_item(doc_id: str, item_id: str) -> bool:
        evidence_map = EVIDENCE_STORE.get(doc_id)
        if not evidence_map:
            return False

        for issue in evidence_map["issues"]:
            initial_count = len(issue["items"])
            issue["items"] = [item for item in issue["items"] if item["item_id"] != item_id]
            if len(issue["items"]) < initial_count:
                return True
        return False

    @staticmethod
    def _normalize_status(status: str) -> str:
        s_lower = (status or "").lower()
        if "found" in s_lower or "available" in s_lower:
            return "Evidence found"
        elif "missing" in s_lower:
            return "Evidence missing"
        elif "verification" in s_lower or "verify" in s_lower:
            return "Requires verification"
        else:
            return "Evidence suggested"
