from datetime import datetime
import html
import logging
from typing import Dict

logger = logging.getLogger("lawbuddy.consultation")

class ConsultationService:
    """
    Generates downloadable/printable lawyer consultation brief documents.
    """
    
    @staticmethod
    def generate_consultation_brief(analysis_data: Dict, user_notes: str = "") -> str:
        """
        Generates clean HTML string formatted as an official Lawyer Consultation Brief.
        """
        current_date = datetime.now().strftime("%Y-%m-%d")
        doc_type = html.escape(str(analysis_data.get("doc_type", "Legal Document")))
        summary = html.escape(str(analysis_data.get("summary", "N/A")))
        parties = analysis_data.get("parties", [])
        obligations = analysis_data.get("key_obligations", [])
        dates_amounts = analysis_data.get("important_dates_and_amounts", [])
        risks = analysis_data.get("clauses_and_risks", [])
        action_map = analysis_data.get("action_map", {})
        
        parties_html = "".join([
            f"<li>{html.escape(str(p))}</li>" if isinstance(p, str) else
            f"<li><strong>{html.escape(str(p.get('role', 'Party')))}:</strong> {html.escape(str(p.get('name', p)))}</li>"
            for p in parties
        ])
        dates_html = "".join([
            f"<li>{html.escape(str(d))}</li>" if isinstance(d, str) else
            f"<li><strong>{html.escape(str(d.get('item', 'Item')))}:</strong> {html.escape(str(d.get('details', d)))}</li>"
            for d in dates_amounts
        ])
        obligations_html = "".join([f"<li>{html.escape(str(o))}</li>" for o in obligations])
        
        questions = action_map.get("prepare", {}).get("questions_for_lawyer", [])
        questions_html = "".join([f"<li>{html.escape(str(q))}</li>" for q in questions])
        
        checklist = action_map.get("prepare", {}).get("checklist_to_collect", [])
        checklist_html = "".join([f"<li>[  ] {html.escape(str(c))}</li>" for c in checklist])

        risks_html = ""
        for r in risks:
            risks_html += f"""
            <div style="background: #fff8e1; border-left: 4px solid #f57c00; padding: 12px; margin-bottom: 12px; border-radius: 4px;">
                <strong style="color: #d84315;">[{html.escape(str(r.get('risk_level')))}] {html.escape(str(r.get('category')))}</strong>
                <p style="margin: 4px 0;"><strong>Original Clause:</strong> <em>"{html.escape(str(r.get('original_clause')))}"</em></p>
                <p style="margin: 4px 0;"><strong>Concern:</strong> {html.escape(str(r.get('explanation')))}</p>
                <p style="margin: 4px 0; color: #0277bd;"><strong>Question for Lawyer:</strong> {html.escape(str(r.get('suggested_question')))}</p>
            </div>
            """

        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>LawBuddy - Lawyer Consultation Brief</title>
    <style>
        body {{ font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1a2530; margin: 40px; background: #fff; }}
        .header {{ border-bottom: 3px solid #1a365d; padding-bottom: 15px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: center; }}
        .logo {{ font-size: 24px; font-weight: bold; color: #1a365d; }}
        .badge {{ background: #e2e8f0; color: #2d3748; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; }}
        h2 {{ color: #2b6cb0; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-top: 25px; }}
        ul {{ padding-left: 20px; }}
        li {{ margin-bottom: 6px; }}
        .disclaimer {{ background: #ebf8ff; border: 1px solid #bee3f8; padding: 15px; border-radius: 6px; font-size: 12px; color: #2b6cb0; margin-top: 40px; }}
        @media print {{ body {{ margin: 0; }} .no-print {{ display: none; }} }}
    </style>
</head>
<body>
    <div class="no-print" style="margin-bottom: 20px; text-align: right;">
        <button onclick="window.print()" style="background: #2b6cb0; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold;">🖨️ Print / Save as PDF</button>
    </div>

    <div class="header">
        <div class="logo">⚖️ LawBuddy AI — Consultation Brief</div>
        <div class="badge">Document: {doc_type}</div>
    </div>

    <p><strong>Date Generated:</strong> {current_date}</p>

    <h2>1. Executive Summary</h2>
    <p>{summary}</p>

    <h2>2. Key Document Parties & Terms</h2>
    <h3>Parties Involved</h3>
    <ul>{parties_html or "<li>Not specified</li>"}</ul>
    
    <h3>Important Financials & Deadlines</h3>
    <ul>{dates_html or "<li>Not specified</li>"}</ul>

    <h2>3. Key Obligations</h2>
    <ul>{obligations_html or "<li>None identified</li>"}</ul>

    <h2>4. Highlighted Clause Risks & Concerns</h2>
    {risks_html or "<p>No critical risks detected.</p>"}

    <h2>5. Recommended Questions to Ask Your Lawyer</h2>
    <ul>{questions_html or "<li>Review general agreement terms.</li>"}</ul>

    <h2>6. Evidence & Checklist to Bring to Consultation</h2>
    <ul>{checklist_html or "<li>Bring original signed copy of agreement.</li>"}</ul>

    {f"<h2>7. Additional User Notes</h2><p>{html.escape(user_notes)}</p>" if user_notes else ""}

    <div class="disclaimer">
        <strong>IMPORTANT LEGAL DISCLAIMER:</strong><br>
        LawBuddy provides general legal information and document assistance. It is not a substitute for advice from a qualified legal professional. AI-generated information may be incomplete or inaccurate. Verify all details with an advocate before taking legal action.
    </div>
</body>
</html>
"""
        return html_content
