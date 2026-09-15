/**
 * LawBuddy AI Frontend Application JavaScript Engine
 */

document.addEventListener('DOMContentLoaded', () => {
    // Global State
    window.appState = {
        activeDocId: null,
        activeDocName: null,
        activeDocType: null,
        selectedLanguage: localStorage.getItem("lawbuddyLanguage") || 'kn', // Preferred language from localStorage or default to Kannada
        analysisData: null,
        compareDocIdB: null
    };

    initNavigation();
    initUploadHandlers();
    initDemoHandler();
    initLanguageSelector();
    initChatHandler();
    initComparisonHandler();
    initBriefHandler();
    loadOfficialSources();
});

// Navigation & Tab Switching
function initNavigation() {
    const tabs = document.querySelectorAll('.nav-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.getAttribute('data-target');
            switchTab(targetId);
        });
    });
}

function switchTab(targetId) {
    document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

    const selectedNav = document.querySelector(`.nav-tab[data-target="${targetId}"]`);
    const selectedPane = document.getElementById(targetId);

    if (selectedNav) selectedNav.classList.add('active');
    if (selectedPane) selectedPane.classList.add('active');
}

// Language Selector Handler
function initLanguageSelector() {
    const langSelect = document.getElementById('languageSelect');
    if (langSelect) {
        const savedLanguage = localStorage.getItem("lawbuddyLanguage");
        if (savedLanguage) {
            langSelect.value = savedLanguage;
            window.appState.selectedLanguage = savedLanguage;
        }
        langSelect.addEventListener('change', (e) => {
            window.appState.selectedLanguage = e.target.value;
            localStorage.setItem("lawbuddyLanguage", e.target.value);
            showNotification(`Language set to ${e.target.options[e.target.selectedIndex].text}`);
            
            // Re-analyze document in new language if active
            if (window.appState.activeDocId) {
                runDocumentAnalysis(window.appState.activeDocId);
            }
        });
    }
}

// Notification Banner Helper
function showNotification(msg, isError = false) {
    const banner = document.getElementById('statusNotification');
    const msgEl = document.getElementById('notificationMessage');
    
    msgEl.innerText = msg;
    banner.style.background = isError ? '#fee2e2' : '#eff6ff';
    banner.style.color = isError ? '#991b1b' : '#1e40af';
    banner.classList.remove('hidden');

    setTimeout(() => {
        banner.classList.add('hidden');
    }, 4000);
}

// 1-Click Instant Demo Mode
function initDemoHandler() {
    const demoBtn = document.getElementById('loadSampleDemoBtn');
    const loadSampleBtn = document.getElementById('loadSampleBtn');

    const triggerDemo = async () => {
        showNotification("⚡ Loading pre-loaded Indian Rental Agreement Demo...");
        try {
            const res = await fetch('/api/sample-demo');
            const data = await res.json();
            if (data.doc_id) {
                updateActiveDocSession(data);
                switchTab('uploadTab');
                showNotification("Sample Rental Agreement loaded successfully! Click 'Analyze Document' below.");
            }
        } catch (err) {
            showNotification("Failed to load sample demo: " + err, true);
        }
    };

    if (demoBtn) demoBtn.addEventListener('click', triggerDemo);
    if (loadSampleBtn) loadSampleBtn.addEventListener('click', triggerDemo);
}

// Document Upload & Extraction Handlers
function initUploadHandlers() {
    const fileInput = document.getElementById('fileInput');
    const analyzePastedBtn = document.getElementById('analyzePastedTextBtn');
    const startAnalysisBtn = document.getElementById('startAnalysisBtn');

    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('file', file);

            showNotification(`Uploading and extracting text from ${file.name}...`);
            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                if (data.error) {
                    showNotification(data.error, true);
                } else {
                    updateActiveDocSession(data);
                    showNotification("Text extracted successfully!");
                }
            } catch (err) {
                showNotification("Upload failed: " + err, true);
            }
        });
    }

    if (analyzePastedBtn) {
        analyzePastedBtn.addEventListener('click', async () => {
            const pastedText = document.getElementById('pasteTextInput').value;
            if (!pastedText.trim()) {
                showNotification("Please paste some legal text first!", true);
                return;
            }

            showNotification("Processing pasted legal text...");
            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: pastedText, filename: "Pasted_Agreement_Text.txt" })
                });
                const data = await res.json();
                if (data.error) {
                    showNotification(data.error, true);
                } else {
                    updateActiveDocSession(data);
                    showNotification("Text processed! Click 'Analyze Document Now'.");
                }
            } catch (err) {
                showNotification("Pasted text upload failed: " + err, true);
            }
        });
    }

    if (startAnalysisBtn) {
        startAnalysisBtn.addEventListener('click', () => {
            if (!window.appState.activeDocId) {
                showNotification("No document active. Upload or paste text first!", true);
                return;
            }
            const selectedDocType = document.getElementById('docTypeSelect').value;
            runDocumentAnalysis(window.appState.activeDocId, selectedDocType);
        });
    }
}

function updateActiveDocSession(data) {
    window.appState.activeDocId = data.doc_id;
    window.appState.activeDocName = data.filename;
    window.appState.activeDocType = data.doc_type;

    document.getElementById('activeDocName').innerText = data.filename;
    document.getElementById('activeDocTypeBadge').innerText = data.doc_type;
    
    document.getElementById('docMetadataPanel').classList.remove('hidden');
    document.getElementById('metaFileName').innerText = data.filename;
    document.getElementById('docTypeSelect').value = data.doc_type;
    document.getElementById('textPreviewContent').innerText = data.preview_text;
}

// Run Document Analysis via API
async function runDocumentAnalysis(docId, overrideDocType = null) {
    const language = window.appState.selectedLanguage;
    const docType = overrideDocType || window.appState.activeDocType;

    showNotification(`Running AI analysis in ${language.toUpperCase()}...`);
    
    // Switch to Action Map tab automatically for MVP showcase
    switchTab('clarityMapTab');

    try {
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                doc_id: docId,
                doc_type: docType,
                language: language
            })
        });

        const data = await res.json();
        if (data.error) {
            showNotification(data.error, true);
            return;
        }

        window.appState.analysisData = data;
        renderClarityActionMap(data.action_map);
        renderClauseRisks(data.clauses_and_risks);
        showNotification("Document analysis completed successfully!");
    } catch (err) {
        showNotification("Analysis failed: " + err, true);
    }
}

// Render Hackathon Differentiator: Legal Clarity & Action Map
function renderClarityActionMap(actionMap) {
    if (!actionMap) return;

    // 1. Understand
    const understandEl = document.getElementById('actionMapUnderstand');
    understandEl.innerHTML = (actionMap.understand || [])
        .map(pt => `<li>${pt}</li>`).join('') || '<li>No summary points generated.</li>';

    // 2. Identify
    const identifyEl = document.getElementById('actionMapIdentify');
    identifyEl.innerHTML = (actionMap.identify || [])
        .map(pt => `<li>${pt}</li>`).join('') || '<li>No specific concerns identified.</li>';

    // 3. Prepare
    const prepareObj = actionMap.prepare || {};
    const questionsEl = document.getElementById('actionMapQuestions');
    questionsEl.innerHTML = (prepareObj.questions_for_lawyer || [])
        .map(q => `<li><strong>Q:</strong> ${q}</li>`).join('') || '<li>Prepare general contract questions.</li>';

    const checklistEl = document.getElementById('actionMapChecklist');
    checklistEl.innerHTML = (prepareObj.checklist_to_collect || [])
        .map(item => `<li>📋 ${item}</li>`).join('') || '<li>Collect original document copy.</li>';

    // 4. Navigate
    const navigateObj = actionMap.navigate || {};
    const nextStepsEl = document.getElementById('actionMapNextSteps');
    nextStepsEl.innerHTML = (navigateObj.next_steps || [])
        .map(step => `<li>➡️ ${step}</li>`).join('') || '<li>Review terms carefully.</li>';

    const sourcesEl = document.getElementById('actionMapSources');
    const sources = navigateObj.official_sources || [];
    if (sources.length > 0) {
        sourcesEl.innerHTML = sources.map(s => 
            `<a href="${s.url}" target="_blank" class="source-chip" title="${s.description || ''}">🏛️ ${s.title}</a>`
        ).join('');
    }
}

// Render Clause & Risk Explorer Cards
function renderClauseRisks(risks) {
    const container = document.getElementById('riskListContainer');
    if (!risks || risks.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No specific risk clauses flagged.</p></div>';
        return;
    }

    container.innerHTML = risks.map((r, idx) => {
        const riskClass = (r.risk_level || 'Low-Risk').replace(/\s+/g, '-');
        return `
        <div class="risk-card ${riskClass}">
            <div class="risk-header">
                <h3>#${idx + 1} ${r.category || 'Clause Note'}</h3>
                <span class="risk-badge ${riskClass}">${r.risk_level || 'Informational'}</span>
            </div>

            <div class="original-clause-box">
                📜 <strong>Original Clause (${r.page_ref || 'Reference'}):</strong><br>
                "${r.original_clause || 'Text'}"
            </div>

            <p><strong>Plain Language Explanation:</strong> ${r.explanation || ''}</p>
            <p style="margin-top: 6px; color: #92400e;"><strong>Why it deserves attention:</strong> ${r.why_deserves_attention || ''}</p>
            
            <div style="margin-top: 10px; background: #eff6ff; padding: 10px; border-radius: 8px;">
                <strong>Suggested Question for Lawyer:</strong><br>
                ❓ ${r.suggested_question || 'Review clause with legal counsel.'}
            </div>
        </div>
        `;
    }).join('');

    // Setup filter listeners
    document.querySelectorAll('.risk-filter-bar .filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.risk-filter-bar .filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const targetRisk = btn.getAttribute('data-risk');
            
            document.querySelectorAll('.risk-card').forEach(card => {
                if (targetRisk === 'all' || card.classList.contains(targetRisk.replace(/\s+/g, '-'))) {
                    card.style.display = 'block';
                } else {
                    card.style.display = 'none';
                }
            });
        });
    });
}

// Grounded AI Chat Handler
function initChatHandler() {
    window.sendChatMessage = async () => {
        const inputEl = document.getElementById('chatInput');
        const question = inputEl.value.trim();
        if (!question) return;

        if (!window.appState.activeDocId) {
            showNotification("Please upload a document before asking questions!", true);
            return;
        }

        const chatBox = document.getElementById('chatMessages');

        // Append User Message
        chatBox.innerHTML += `
            <div class="chat-bubble user">
                <strong>You:</strong>
                <p>${question}</p>
            </div>
        `;
        inputEl.value = '';
        chatBox.scrollTop = chatBox.scrollHeight;

        // Fetch AI Response
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    doc_id: window.appState.activeDocId,
                    question: question,
                    language: window.appState.selectedLanguage
                })
            });

            const data = await res.json();
            
            let sourcesHtml = '';
            if (data.sources && data.sources.length > 0) {
                sourcesHtml = `<div class="chat-sources-tag">📌 <strong>Document Grounding:</strong> ${data.sources.map(s => s.ref).join(', ')}</div>`;
            }

            chatBox.innerHTML += `
                <div class="chat-bubble ai">
                    <strong>⚖️ LawBuddy AI:</strong>
                    <p>${data.answer || 'No response generated.'}</p>
                    ${sourcesHtml}
                </div>
            `;
            chatBox.scrollTop = chatBox.scrollHeight;
        } catch (err) {
            chatBox.innerHTML += `
                <div class="chat-bubble ai" style="background:#fee2e2;">
                    <strong>Error:</strong> Failed to fetch answer. ${err}
                </div>
            `;
        }
    };
}

// Side-by-Side Comparison Handler
function initComparisonHandler() {
    const compareInput = document.getElementById('compareFileInput');
    const runCompareBtn = document.getElementById('runCompareBtn');

    if (compareInput) {
        compareInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const formData = new FormData();
            formData.append('file', file);

            showNotification(`Uploading Doc B (${file.name})...`);
            try {
                const res = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await res.json();
                window.appState.compareDocIdB = data.doc_id;
                document.getElementById('docBNameLabel').innerText = data.filename;
                showNotification("Doc B uploaded successfully!");
            } catch (err) {
                showNotification("Upload failed: " + err, true);
            }
        });
    }

    if (runCompareBtn) {
        runCompareBtn.addEventListener('click', async () => {
            if (!window.appState.activeDocId || !window.appState.compareDocIdB) {
                showNotification("Please select both Document A and Document B to compare!", true);
                return;
            }

            showNotification("Comparing documents...");
            try {
                const res = await fetch('/api/compare', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        doc_id_a: window.appState.activeDocId,
                        doc_id_b: window.appState.compareDocIdB,
                        language: window.appState.selectedLanguage
                    })
                });

                const data = await res.json();
                renderComparisonResults(data);
                showNotification("Comparison completed!");
            } catch (err) {
                showNotification("Comparison failed: " + err, true);
            }
        });
    }
}

function renderComparisonResults(data) {
    const container = document.getElementById('compareResultsContainer');
    container.classList.remove('hidden');

    document.getElementById('diffSummaryText').innerText = data.summary || "Comparison completed.";

    const detailsEl = document.getElementById('diffDetailsContainer');
    const modified = data.modified_clauses || [];
    const added = data.added_clauses || [];
    const removed = data.removed_clauses || [];

    detailsEl.innerHTML = `
        <h4 style="margin: 14px 0 8px;">Modified Clauses (${modified.length})</h4>
        ${modified.map(m => `
            <div style="background:#fff; padding:12px; border-radius:8px; border:1px solid #cbd5e1; margin-bottom:10px;">
                <strong>${m.clause_name}:</strong>
                <p style="color:#991b1b;">🔴 Original: "${m.original_text}"</p>
                <p style="color:#166534;">🟢 Revised: "${m.revised_text}"</p>
                <p style="font-size:12px; color:#536b91;">Impact: ${m.significance}</p>
            </div>
        `).join('')}

        <h4 style="margin: 14px 0 8px;">Added Clauses (${added.length})</h4>
        ${added.map(a => `
            <div style="background:#f0fdf4; padding:12px; border-radius:8px; border:1px solid #86efac; margin-bottom:10px;">
                <strong>➕ ${a.clause_name}:</strong> "${a.text}"
                <p style="font-size:12px; color:#166534;">Impact: ${a.significance}</p>
            </div>
        `).join('')}
    `;
}

// Lawyer Consultation Brief Handler
function initBriefHandler() {
    const btn = document.getElementById('generateBriefBtn');
    if (btn) {
        btn.addEventListener('click', async () => {
            if (!window.appState.activeDocId) {
                showNotification("Please upload and analyze a document first!", true);
                return;
            }

            const notes = document.getElementById('briefNotesInput').value;

            showNotification("Generating printable Consultation Brief...");
            try {
                const res = await fetch('/api/export-brief', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        doc_id: window.appState.activeDocId,
                        notes: notes
                    })
                });

                const htmlText = await res.text();
                const container = document.getElementById('briefPreviewContainer');
                const iframe = document.getElementById('briefIframe');

                container.classList.remove('hidden');
                iframe.contentWindow.document.open();
                iframe.contentWindow.document.write(htmlText);
                iframe.contentWindow.document.close();

                showNotification("Consultation Brief generated! Use the print button inside the preview.");
            } catch (err) {
                showNotification("Brief generation failed: " + err, true);
            }
        });
    }
}

// Load Official Indian Legal Sources
async function loadOfficialSources() {
    try {
        const res = await fetch('/api/official-sources');
        const sources = await res.json();
        const container = document.getElementById('sourcesContainer');
        if (container && sources) {
            container.innerHTML = sources.map(s => `
                <div class="source-card">
                    <h3>🏛️ ${s.name}</h3>
                    <span style="background:#e0f2fe; color:#0369a1; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:bold;">${s.category}</span>
                    <p>${s.description}</p>
                    <a href="${s.url}" target="_blank" class="btn btn-secondary" style="font-size:12px; text-decoration:none;">Visit Official Portal 🔗</a>
                </div>
            `).join('');
        }
    } catch (err) {
        console.warn("Could not load official sources:", err);
    }
}
