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
    initUserProfile();
    initUploadHandlers();
    initDemoHandler();
    initLanguageSelector();
    initChatHandler();
    initComparisonHandler();
    initBriefHandler();
    loadOfficialSources();
});

// Authentication state is stored by login.html and signup.html.  Read it when
// the workspace opens so the signed-in person's name is visible in the header.
function initUserProfile() {
    const userNameLabel = document.getElementById('userNameLabel');
    if (!userNameLabel) return;

    try {
        const user = JSON.parse(localStorage.getItem('lawbuddyUser') || 'null');
        const name = user && (user.name || (user.email || '').split('@')[0]);
        if (name) {
            userNameLabel.textContent = name;
            userNameLabel.title = user.email || name;
        }
    } catch (error) {
        // A bad/stale localStorage value must not prevent the app from loading.
        console.warn('Could not read saved user profile:', error);
    }

    const logoutLink = document.querySelector('.logout-link');
    if (logoutLink) {
        logoutLink.addEventListener('click', () => localStorage.removeItem('lawbuddyUser'));
    }
}

// Flask can return an HTML error page for proxies or unexpected failures. Do
// not call response.json() blindly: turn it into an actionable user message.
async function readApiJson(response) {
    const contentType = response.headers.get('content-type') || '';
    let data;

    if (contentType.includes('application/json')) {
        data = await response.json();
    } else {
        const text = await response.text();
        data = {
            error: text
                ? `Server returned an unexpected response (${response.status}).`
                : `Request failed (${response.status}).`
        };
    }

    if (!response.ok && !data.error) {
        data.error = `Request failed (${response.status}).`;
    }
    return data;
}

// When app.html is previewed through a static development server (for example
// VS Code Live Server), relative /api requests reach that server and return
// 405. The Flask API normally runs on port 5000, while production/same-origin
// deployments keep using relative URLs.
function apiUrl(path) {
    const isFileProtocol = window.location.protocol === 'file:';
    const isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname)
        && window.location.port
        && window.location.port !== '5000';
    return (isFileProtocol || isLocalPreview) ? `http://127.0.0.1:5000${path}` : path;
}

function apiFetch(path, options) {
    return fetch(apiUrl(path), options);
}

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
        applyAppLanguage(window.appState.selectedLanguage);
        langSelect.addEventListener('change', (e) => {
            window.appState.selectedLanguage = e.target.value;
            localStorage.setItem("lawbuddyLanguage", e.target.value);
            applyAppLanguage(e.target.value);
            showNotification(`Language set to ${e.target.options[e.target.selectedIndex].text}`);
            
            // Re-analyze document in new language if active
            if (window.appState.activeDocId) {
                runDocumentAnalysis(window.appState.activeDocId);
            }
        });
    }
}

// The selector controls both UI labels and the language sent to the AI API.
// English is the complete fallback so incomplete translations never blank text.
const APP_TRANSLATIONS = {
    en: { tagline: 'Legal Access & Case Preparation Platform', language: 'Language', demo: '1-Click Rental Agreement Demo', aiActive: 'Responsible AI Active', exit: 'Exit', activeDocument: 'Active Document', uploadTitle: 'Upload Legal Document', uploadDescription: 'Supports Legal Notices, Rental Agreements, Employment Contracts, Consumer Complaints, NDAs, Service Contracts, and more.', dropTitle: 'Drag & Drop Legal Document Here', fileSupport: 'Supports PDF, DOCX, TXT, PNG, JPG (Scanned Notice & Document OCR Supported)', browse: 'Browse Files', loadDemo: '⚡ Load Sample Rental Agreement Demo', pasteTitle: '...or Paste Legal Text', pastePlaceholder: 'Paste legal notice text, agreement clauses, employment contract text, or communication here...', analyzePasted: 'Analyze Pasted Text' },
    kn: { language: 'ಭಾಷೆ', demo: 'ಒಂದು ಕ್ಲಿಕ್ ಮಾದರಿ ಒಪ್ಪಂದ', aiActive: 'ಜವಾಬ್ದಾರಿಯುತ AI ಸಕ್ರಿಯ', exit: 'ನಿರ್ಗಮಿಸಿ', activeDocument: 'ಸಕ್ರಿಯ ದಾಖಲೆ', uploadTitle: 'ಕಾನೂನು ದಾಖಲೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ', dropTitle: 'ಕಾನೂನು ದಾಖಲೆಯನ್ನು ಇಲ್ಲಿ ಎಳೆಯಿರಿ ಮತ್ತು ಬಿಡಿ', browse: 'ಫೈಲ್‌ಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ', loadDemo: '⚡ ಮಾದರಿ ಒಪ್ಪಂದ ಡೆಮೊ ಲೋಡ್ ಮಾಡಿ', pasteTitle: '...ಅಥವಾ ಕಾನೂನು ಪಠ್ಯ ಅಂಟಿಸಿ', analyzePasted: 'ಅಂಟಿಸಿದ ಪಠ್ಯವನ್ನು ವಿಶ್ಲೇಷಿಸಿ' },
    hi: { language: 'भाषा', demo: 'एक क्लिक नमूना अनुबंध', aiActive: 'जिम्मेदार AI सक्रिय', exit: 'बाहर निकलें', activeDocument: 'सक्रिय दस्तावेज़', uploadTitle: 'कानूनी दस्तावेज़ अपलोड करें', dropTitle: 'कानूनी दस्तावेज़ यहाँ खींचें और छोड़ें', browse: 'फ़ाइलें चुनें', loadDemo: '⚡ नमूना अनुबंध डेमो लोड करें', pasteTitle: '...या कानूनी पाठ चिपकाएँ', analyzePasted: 'चिपकाए गए पाठ का विश्लेषण करें' },
    ml: { language: 'ഭാഷ', demo: 'ഒറ്റ ക്ലിക്കിൽ മാതൃക കരാർ', aiActive: 'ഉത്തരവാദിത്ത AI സജീവം', exit: 'പുറത്തുകടക്കുക', activeDocument: 'സജീവ പ്രമാണം', uploadTitle: 'നിയമപരമായ പ്രമാണം അപ്‌ലോഡ് ചെയ്യുക', dropTitle: 'നിയമപരമായ പ്രമാണം ഇവിടെ വലിച്ചിടുക', browse: 'ഫയലുകൾ തിരഞ്ഞെടുക്കുക', loadDemo: '⚡ മാതൃക കരാർ ഡെമോ', pasteTitle: '...അല്ലെങ്കിൽ നിയമപരമായ പാഠം ഒട്ടിക്കുക', analyzePasted: 'ഒട്ടിച്ച പാഠം വിശകലനം ചെയ്യുക' },
    te: { language: 'భాష', demo: 'ఒక క్లిక్ నమూనా ఒప్పందం', aiActive: 'బాధ్యతాయుత AI సక్రియం', exit: 'నిష్క్రమించు', activeDocument: 'క్రియాశీల పత్రం', uploadTitle: 'న్యాయ పత్రాన్ని అప్‌లోడ్ చేయండి', dropTitle: 'న్యాయ పత్రాన్ని ఇక్కడ లాగి వదలండి', browse: 'ఫైల్‌లను ఎంచుకోండి', loadDemo: '⚡ నమూనా ఒప్పందం డెമോ', pasteTitle: '...లేదా న్యాయ పాఠ్యాన్ని అతికించండి', analyzePasted: 'అతికించిన పాఠ్యాన్ని విశ్ಲೇషించండి' },
    mr: { language: 'भाषा', demo: 'एका क्लिकमध्ये नमुना करार', aiActive: 'जबाबदार AI सक्रिय', exit: 'बाहेर पडा', activeDocument: 'सक्रिय दस्तऐवज', uploadTitle: 'कायदेशीर दस्तऐवज अपलोड करा', dropTitle: 'दस्तऐवज येथे ड्रॅग आणि ड्रॉप करा', browse: 'फाइल निवडा', loadDemo: '⚡ नमुना करार डेमो', pasteTitle: '...किंवा कायदेशीर मजकूर पेस्ट करा', analyzePasted: 'पेस्ट केलेल्या मजकुराचे विश्लेषण करा' },
    bn: { language: 'ভাষা', demo: 'এক ক্লিকে নমুনা চুক্তি', aiActive: 'দায়িত্বশীল AI সক্রিয়', exit: 'প্রস্থান', activeDocument: 'সক্রিয় নথি', uploadTitle: 'আইনি নথি আপলোড করুন', dropTitle: 'আইনি নথি এখানে টেনে আনুন', browse: 'ফাইল নির্বাচন করুন', loadDemo: '⚡ নমুনা চুক্তি ডেমো', pasteTitle: '...অথবা আইনি লেখা পেস্ট করুন', analyzePasted: 'পেস্ট করা লেখা বিশ্লেষণ করুন' },
    gu: { language: 'ભાષા', demo: 'એક ક્લિકમાં નમૂના કરાર', aiActive: 'જવાબદાર AI સક્રિય', exit: 'બહાર નીકળો', activeDocument: 'સક્રિય દસ્તાવેજ', uploadTitle: 'કાનૂની દસ્તાવેજ અપલોડ કરો', dropTitle: 'કાનૂની દસ્તાવેજ અહીં ખેંચીને મૂકો', browse: 'ફાઇલો પસંદ કરો', loadDemo: '⚡ નમૂના કરાર ડેમો', pasteTitle: '...અથવા કાનૂની ટેક્સ્ટ પેસ્ટ કરો', analyzePasted: 'પેસ્ટ કરેલા ટેક્સ્ટનું વિશ્લેષણ કરો' },
    tulu: { language: 'ಬಾಸೆ', demo: 'ಒಂಜಿ ಕ್ಲಿಕ್ ಮಾದರಿ ಒಪ್ಪಂದ', aiActive: 'ಜವಾಬ್ದಾರಿ AI', exit: 'ಪೊಲೆ', activeDocument: 'ಸಕ್ರಿಯ ದಾಖಲೆ', uploadTitle: 'ಕಾನೂನು ದಾಖಲೆ ಅಪ್‌ಲೋಡ್ ಮಲ್ಪುಲೆ', dropTitle: 'ಕಾನೂನು ದಾಖಲೆ ಮುಳ್ಪಾ ಪಾಡ್ಲೇ', browse: 'ಫೈಲ್ ಆಯ್ಕೆ ಮಲ್ಪುಲೆ', loadDemo: '⚡ ಮಾದರಿ ಒಪ್ಪಂದ ಡೆಮೊ', pasteTitle: '... ಇಜ್ಜಿoಡ  ಕಾನೂನು ಪಠ್ಯ ಅಂಟಿಸುಲೆ', analyzePasted: 'ಅಂಟಿಯಿನ  ಪಠ್ಯ ವಿಶ್ಲೇಷಿಸುಲೆ' },
    ta: { language: 'மொழி', demo: 'ஒரே கிளிக்கில் மாதிரி ஒப்பந்தம்', aiActive: 'பொறுப்பான AI செயல்பாட்டில் உள்ளது', exit: 'வெளியேறு', activeDocument: 'செயலில் உள்ள ஆவணம்', uploadTitle: 'சட்ட ஆவணத்தைப் பதிவேற்றவும்', dropTitle: 'சட்ட ஆவணத்தை இங்கே இழுத்து விடவும்', browse: 'கோப்புகளைத் தேர்ந்தெடுக்கவும்', loadDemo: '⚡ மாதிரி ஒப்பந்த டெமோ', pasteTitle: '...அல்லது சட்ட உரையை ஒட்டவும்', analyzePasted: 'ஒட்டிய உரையைப் பகுப்பாய்வு செய்யவும்' }
};

function applyAppLanguage(language) {
    const translations = { ...APP_TRANSLATIONS.en, ...(APP_TRANSLATIONS[language] || {}) };
    document.querySelectorAll('[data-i18n]').forEach((element) => {
        const value = translations[element.dataset.i18n];
        if (value) element.textContent = value;
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
        const value = translations[element.dataset.i18nPlaceholder];
        if (value) element.placeholder = value;
    });
    document.documentElement.lang = language === 'tulu' ? 'tcy' : language;
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
            const res = await apiFetch('/api/sample-demo');
            const data = await readApiJson(res);
            if (data.error) {
                showNotification(data.error, true);
                return;
            }
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

// Helper to process file upload via API
async function handleFileUpload(file) {
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    showNotification(`Uploading and extracting text from ${file.name}...`);
    try {
        const res = await apiFetch('/api/upload', {
            method: 'POST',
            body: formData
        });
        const data = await readApiJson(res);
        if (data.error) {
            showNotification(data.error, true);
        } else {
            updateActiveDocSession(data);
            runDocumentAnalysis(data.doc_id, data.doc_type, true);
        }
    } catch (err) {
        showNotification("Upload failed. Make sure LawBuddy API server (python app.py) is running. Error: " + err, true);
    }
}

// Document Upload & Extraction Handlers
function initUploadHandlers() {
    const fileInput = document.getElementById('fileInput');
    const dropZone = document.getElementById('dropZone');
    const analyzePastedBtn = document.getElementById('analyzePastedTextBtn');
    const analyzeWebsiteLinkBtn = document.getElementById('analyzeWebsiteLinkBtn');
    const startAnalysisBtn = document.getElementById('startAnalysisBtn');

    // Drag & Drop support
    if (dropZone) {
        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.add('drag-over');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dropZone.classList.remove('drag-over');
            }, false);
        });

        dropZone.addEventListener('drop', async (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            if (files && files.length > 0) {
                await handleFileUpload(files[0]);
            }
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                await handleFileUpload(file);
            }
            fileInput.value = '';
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
                const res = await apiFetch('/api/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ text: pastedText, filename: "Pasted_Legal_Text.txt" })
                });
                const data = await readApiJson(res);
                if (data.error) {
                    showNotification(data.error, true);
                } else {
                    updateActiveDocSession(data);
                    runDocumentAnalysis(data.doc_id, data.doc_type, true);
                }
            } catch (err) {
                showNotification("Pasted text upload failed: " + err, true);
            }
        });
    }

    if (analyzeWebsiteLinkBtn) {
        analyzeWebsiteLinkBtn.addEventListener('click', async () => {
            const url = document.getElementById('websiteLinkInput').value.trim();
            if (!url) {
                showNotification("Please enter a public website link first!", true);
                return;
            }

            showNotification("Fetching website text for AI analysis...");
            try {
                const res = await apiFetch('/api/upload-link', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                });
                const data = await readApiJson(res);
                if (data.error) {
                    showNotification(data.error, true);
                } else {
                    updateActiveDocSession(data);
                    runDocumentAnalysis(data.doc_id, data.doc_type, true);
                }
            } catch (err) {
                showNotification("Website link analysis failed: " + err, true);
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
    
    const docALabel = document.getElementById('docANameLabel');
    if (docALabel) {
        docALabel.innerText = `Active Doc A: ${data.filename} (${data.doc_type})`;
    }

    document.getElementById('docMetadataPanel').classList.remove('hidden');
    document.getElementById('metaFileName').innerText = data.filename;
    const docTypeSelect = document.getElementById('docTypeSelect');
    if ([...docTypeSelect.options].some(option => option.value === data.doc_type)) {
        docTypeSelect.value = data.doc_type;
    } else if (data.doc_type) {
        const newOpt = document.createElement('option');
        newOpt.value = data.doc_type;
        newOpt.textContent = data.doc_type;
        newOpt.selected = true;
        docTypeSelect.appendChild(newOpt);
    }
    document.getElementById('textPreviewContent').innerText = data.preview_text;
    window.appState.analysisData = null;
}

// Run Document Analysis via API
async function runDocumentAnalysis(docId, overrideDocType = null, showOverview = true) {
    const language = window.appState.selectedLanguage;
    const docType = overrideDocType || window.appState.activeDocType;

    showNotification(`Running AI analysis in ${language.toUpperCase()}...`);
    if (showOverview) switchTab('clarityMapTab');
    setOverviewLoading(true);

    try {
        const res = await apiFetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                doc_id: docId,
                doc_type: docType,
                language: language
            })
        });

        const data = await readApiJson(res);
        if (data.error) {
            showNotification(data.error, true);
            showOverviewError(data.error);
            return;
        }

        window.appState.analysisData = data;
        renderClarityActionMap(data.action_map, data.summary);
        renderClauseRisks(data.clauses_and_risks);
        renderFactsAndTimeline(data);
        fetchAndRenderEvidenceMatrix(docId);
        showNotification("Document analysis completed successfully!");
    } catch (err) {
        const message = "Analysis failed: " + err;
        showNotification(message, true);
        showOverviewError(message);
    } finally {
        setOverviewLoading(false);
    }
}

function setOverviewLoading(isLoading) {
    const loading = document.getElementById('clarityMapLoading');
    const content = document.getElementById('clarityMapContent');
    const error = document.getElementById('clarityMapError');
    if (loading) loading.classList.toggle('hidden', !isLoading);
    if (content) content.classList.toggle('hidden', isLoading);
    if (error && isLoading) error.classList.add('hidden');
}

function showOverviewError(message) {
    const error = document.getElementById('clarityMapError');
    const content = document.getElementById('clarityMapContent');
    if (error) {
        error.textContent = `We could not create the document overview. ${message}`;
        error.classList.remove('hidden');
    }
    if (content) content.classList.add('hidden');
}

// Render Facts Grid and Event Timeline
function renderFactsAndTimeline(data) {
    if (!data) return;

    const keyDatesEl = document.getElementById('factKeyDates');
    const amountsEl = document.getElementById('factAmounts');
    const partiesEl = document.getElementById('factParties');
    const mandateEl = document.getElementById('factMandate');
    const timelineEl = document.getElementById('timelineEventsContainer');

    const datesAmounts = data.important_dates_and_amounts || [];
    const parties = data.parties || [];
    const obligations = data.key_obligations || [];

    const formatItem = (item) => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (typeof item === 'object') {
            const title = item.item || item.name || item.key || item.label || '';
            const details = item.details || item.value || item.amount || item.text || '';
            if (title && details) return `<strong>${title}:</strong> ${details}`;
            return title || details || JSON.stringify(item);
        }
        return String(item);
    };

    if (keyDatesEl) {
        if (datesAmounts.length > 0) {
            const datesList = datesAmounts
                .map(formatItem)
                .filter(txt => /date|deadline|due|period|month|day|year|time|lock-in|probation|notice|term|valid|oct|nov|dec|jan|feb|mar|apr|may|jun|jul|aug|sep/i.test(txt));
            const displayDates = datesList.length > 0 ? datesList : datesAmounts.slice(0, 3).map(formatItem);
            keyDatesEl.innerHTML = displayDates.join('<br>') || 'No specific dates extracted.';
        } else {
            keyDatesEl.innerHTML = 'No dates found in document.';
        }
    }

    if (amountsEl) {
        if (datesAmounts.length > 0) {
            const amountsList = datesAmounts
                .map(formatItem)
                .filter(txt => /₹|\$|rs|rupees|rent|amount|fee|deposit|claim|ctc|salary|value|cost|total|penalty|arrears/i.test(txt));
            const displayAmounts = amountsList.length > 0 ? amountsList : datesAmounts.slice(0, 3).map(formatItem);
            amountsEl.innerHTML = displayAmounts.join('<br>') || 'No specific amounts extracted.';
        } else {
            amountsEl.innerHTML = 'No financial amounts found in document.';
        }
    }

    if (partiesEl) {
        if (parties.length > 0) {
            partiesEl.innerHTML = parties.map(p => {
                if (typeof p === 'string') return `• ${p}`;
                if (typeof p === 'object') {
                    const role = p.role || p.title || p.type || 'Party';
                    const name = p.name || p.party || p.value || 'Unspecified';
                    return `• <strong>${role}:</strong> ${name}`;
                }
                return `• ${p}`;
            }).join('<br>');
        } else {
            partiesEl.innerHTML = 'No parties extracted.';
        }
    }

    if (mandateEl) {
        if (obligations.length > 0) {
            mandateEl.innerHTML = typeof obligations[0] === 'string' ? obligations[0] : (obligations[0].details || JSON.stringify(obligations[0]));
        } else {
            mandateEl.innerHTML = 'Review standard terms and obligations.';
        }
    }

    if (timelineEl) {
        if (obligations.length > 0) {
            timelineEl.innerHTML = obligations.map((ob, idx) => {
                const obText = typeof ob === 'string' ? ob : (ob.details || ob.text || JSON.stringify(ob));
                const colors = ['#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6'];
                const borderCol = colors[idx % colors.length];
                return `
                    <div style="border-left: 3px solid ${borderCol}; padding-left: 16px; margin-bottom: 16px;">
                        <strong>Timeline Event ${idx + 1}:</strong> ${obText}
                    </div>
                `;
            }).join('');
        } else {
            timelineEl.innerHTML = '<p style="color:#64748b;">No timeline events extracted for this document.</p>';
        }
    }
}

// Render Hackathon Differentiator: Legal Clarity & Action Map
function renderClarityActionMap(actionMap, summary = '') {
    const summaryEl = document.getElementById('docOverviewSummary');
    if (summaryEl) {
        summaryEl.innerText = summary || 'Document analysis overview completed.';
    }

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
            const res = await apiFetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    doc_id: window.appState.activeDocId,
                    question: question,
                    language: window.appState.selectedLanguage
                })
            });

            const data = await readApiJson(res);
            if (data.error) {
                throw new Error(data.error);
            }
            
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
                const res = await apiFetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await readApiJson(res);
                if (data.error) {
                    showNotification(data.error, true);
                    return;
                }
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
            const res = await apiFetch('/api/compare', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        doc_id_a: window.appState.activeDocId,
                        doc_id_b: window.appState.compareDocIdB,
                        language: window.appState.selectedLanguage
                    })
                });

                const data = await readApiJson(res);
                if (data.error) {
                    showNotification(data.error, true);
                    return;
                }
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
                const res = await apiFetch('/api/export-brief', {
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
        const res = await apiFetch('/api/official-sources');
        const sources = await readApiJson(res);
        if (sources.error) throw new Error(sources.error);
        const container = document.getElementById('actionMapSources') || document.getElementById('sourcesContainer');
        if (container && sources && Array.isArray(sources)) {
            container.innerHTML = sources.map(s => `
                <a href="${s.url}" target="_blank" class="source-chip" title="${s.description || ''}">🏛️ ${s.name}</a>
            `).join('');
        }
    } catch (err) {
        console.warn("Could not load official sources:", err);
    }
}

// --- EVIDENCE-TO-CLAUSE MAPPING & VERIFICATION MATRIX ---
async function fetchAndRenderEvidenceMatrix(docId) {
    const activeId = docId || window.appState.activeDocId;
    if (!activeId) return;

    const container = document.getElementById('evidenceMatrixContainer');
    const loading = document.getElementById('evidenceMatrixLoading');
    if (loading) loading.classList.remove('hidden');

    try {
        const res = await apiFetch(`/api/evidence/${activeId}`);
        const data = await readApiJson(res);
        if (data.error) throw new Error(data.error);
        renderEvidenceMatrix(data);
    } catch (err) {
        console.warn("Could not fetch evidence map:", err);
        if (container) {
            container.innerHTML = `<div class="empty-state"><p>Could not load evidence matrix: ${err.message}</p></div>`;
        }
    } finally {
        if (loading) loading.classList.add('hidden');
    }
}

function renderEvidenceMatrix(data) {
    const container = document.getElementById('evidenceMatrixContainer');
    if (!container) return;

    if (!data || !data.issues || data.issues.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>No evidence mapping extracted yet. Upload a document to generate.</p></div>`;
        return;
    }

    container.innerHTML = data.issues.map(issue => {
        const items = issue.items || [];
        
        // Categorize items by status for neutral display
        const availableItems = items.filter(i => i.status === 'Evidence found' || i.status === 'Requires verification');
        const missingItems = items.filter(i => i.status === 'Evidence missing' || i.status === 'Evidence suggested');

        const availableHtml = availableItems.length > 0 ? availableItems.map(item => `
            <div style="background: #f0fdf4; border: 1px solid #86efac; padding: 8px 12px; border-radius: 8px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>📄 ${escapeHtml(item.name)}</strong>
                    <div style="font-size: 11px; color: #166534; margin-top: 2px;">
                        Status: <span class="badge-pill ${item.status === 'Evidence found' ? 'bg-success' : 'bg-warning'}">${escapeHtml(item.status)}</span>
                        ${item.notes ? `• <em>${escapeHtml(item.notes)}</em>` : ''}
                    </div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="btn btn-secondary" style="padding: 2px 6px; font-size: 11px;" onclick="toggleEvidenceStatus('${item.item_id}', '${item.status}')">🔄 Toggle Status</button>
                    <button class="btn btn-secondary" style="padding: 2px 6px; font-size: 11px; color: #dc2626;" onclick="deleteEvidenceItem('${item.item_id}')">🗑️</button>
                </div>
            </div>
        `).join('') : '<p style="font-size: 12px; color: #64748b; italic;">No evidence currently uploaded/linked for this clause.</p>';

        const missingHtml = missingItems.length > 0 ? missingItems.map(item => `
            <div style="background: #fef2f2; border: 1px solid #fca5a5; padding: 8px 12px; border-radius: 8px; margin-bottom: 6px; display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <strong>❓ ${escapeHtml(item.name)}</strong>
                    <div style="font-size: 11px; color: #991b1b; margin-top: 2px;">
                        Status: <span class="badge-pill bg-urgent">${escapeHtml(item.status)}</span>
                    </div>
                </div>
                <div style="display: flex; gap: 4px;">
                    <button class="btn btn-secondary" style="padding: 2px 6px; font-size: 11px;" onclick="toggleEvidenceStatus('${item.item_id}', '${item.status}')">🔄 Mark Found</button>
                    <button class="btn btn-secondary" style="padding: 2px 6px; font-size: 11px; color: #dc2626;" onclick="deleteEvidenceItem('${item.item_id}')">🗑️</button>
                </div>
            </div>
        `).join('') : '<p style="font-size: 12px; color: #166534;">All suggested evidence categories accounted for!</p>';

        const suggestedList = (issue.suggested_evidence || []).map(s => `<li>${escapeHtml(s)}</li>`).join('');

        return `
            <div class="card-box" style="margin-bottom: 20px; border-left: 5px solid #2563eb;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <div>
                        <span class="badge-pill bg-info">ISSUE / FACTUAL CLAIM</span>
                        <h3 style="margin-top: 4px; color: #1e293b;">${escapeHtml(issue.issue)}</h3>
                    </div>
                    <span style="font-size: 12px; background: #e2e8f0; padding: 4px 10px; border-radius: 12px; color: #475569;">📍 ${escapeHtml(issue.location || 'Document Clause')}</span>
                </div>

                <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 12px; border-radius: 8px; margin: 12px 0;">
                    <strong style="color: #334155; font-size: 12px;">RELEVANT CLAUSE TEXT:</strong>
                    <p style="margin: 4px 0 0 0; font-size: 13px; color: #1e293b; font-style: italic;">"${escapeHtml(issue.clause)}"</p>
                </div>

                <div class="grid-2" style="margin-top: 14px;">
                    <div>
                        <h4 style="font-size: 13px; color: #166534; margin-bottom: 8px;">✅ Evidence Available / Linked</h4>
                        ${availableHtml}
                    </div>
                    <div>
                        <h4 style="font-size: 13px; color: #991b1b; margin-bottom: 8px;">🚨 Evidence Needed / Missing</h4>
                        ${missingHtml}
                    </div>
                </div>

                ${suggestedList ? `
                <div style="margin-top: 12px; border-top: 1px dashed #cbd5e1; padding-top: 8px;">
                    <small style="color: #64748b;"><strong>Potential Evidence Categories to Collect:</strong></small>
                    <ul style="margin: 4px 0 0 0; padding-left: 20px; font-size: 12px; color: #475569;">${suggestedList}</ul>
                </div>` : ''}
            </div>
        `;
    }).join('');
}

async function addManualEvidenceItem() {
    const nameInput = document.getElementById('manualEvidenceName');
    const statusSelect = document.getElementById('manualEvidenceStatus');
    const name = nameInput ? nameInput.value.trim() : '';
    const status = statusSelect ? statusSelect.value : 'Evidence missing';

    if (!name) {
        showNotification("Please enter an evidence item name!", true);
        return;
    }
    if (!window.appState.activeDocId) {
        showNotification("Upload a document first to add evidence items!", true);
        return;
    }

    try {
        const res = await apiFetch('/api/evidence/item', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                doc_id: window.appState.activeDocId,
                issue_id: "ev_issue_custom",
                name: name,
                status: status
            })
        });
        const data = await readApiJson(res);
        if (data.error) throw new Error(data.error);

        nameInput.value = '';
        showNotification(`Added evidence item: "${name}"`);
        await fetchAndRenderEvidenceMatrix(window.appState.activeDocId);
    } catch (err) {
        showNotification("Failed to add evidence item: " + err.message, true);
    }
}

async function toggleEvidenceStatus(itemId, currentStatus) {
    if (!window.appState.activeDocId) return;

    let nextStatus = 'Evidence found';
    if (currentStatus === 'Evidence found') nextStatus = 'Requires verification';
    else if (currentStatus === 'Requires verification') nextStatus = 'Evidence missing';
    else if (currentStatus === 'Evidence missing') nextStatus = 'Evidence suggested';

    try {
        const res = await apiFetch(`/api/evidence/item/${itemId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                doc_id: window.appState.activeDocId,
                status: nextStatus
            })
        });
        const data = await readApiJson(res);
        if (data.error) throw new Error(data.error);

        showNotification(`Updated status to: "${nextStatus}"`);
        await fetchAndRenderEvidenceMatrix(window.appState.activeDocId);
    } catch (err) {
        showNotification("Failed to update status: " + err.message, true);
    }
}

async function deleteEvidenceItem(itemId) {
    if (!window.appState.activeDocId) return;

    try {
        const res = await apiFetch(`/api/evidence/item/${itemId}?doc_id=${window.appState.activeDocId}`, {
            method: 'DELETE'
        });
        const data = await readApiJson(res);
        if (data.error) throw new Error(data.error);

        showNotification("Evidence item deleted.");
        await fetchAndRenderEvidenceMatrix(window.appState.activeDocId);
    } catch (err) {
        showNotification("Failed to delete item: " + err.message, true);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

