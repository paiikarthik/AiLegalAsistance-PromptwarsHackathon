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
    initSimpleLawBuddy();
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
function handleLogout(e) {
    if (e && e.preventDefault) e.preventDefault();
    localStorage.removeItem('lawbuddyUser');
    sessionStorage.clear();
    if (window.appState) {
        window.appState.activeDocId = null;
        window.appState.activeDocName = null;
        window.appState.analysisData = null;
    }
    window.location.replace('login.html');
}
window.handleLogout = handleLogout;

function initUserProfile() {
    const userNameLabel = document.getElementById('userNameLabel');
    if (!userNameLabel) return;

    try {
        const user = JSON.parse(localStorage.getItem('lawbuddyUser') || 'null');
        const name = user && (user.name || (user.email || '').split('@')[0]);
        if (name) {
            userNameLabel.textContent = name;
            userNameLabel.title = user.email || name;
            syncUserDataAndRestoreCase(user);
            loadUserCasesList(user);
        } else {
            handleLogout();
            return;
        }
    } catch (error) {
        // A bad/stale localStorage value must not prevent the app from loading.
        console.warn('Could not read saved user profile:', error);
        handleLogout();
        return;
    }

    const logoutLink = document.querySelector('.logout-link');
    if (logoutLink) {
        logoutLink.addEventListener('click', handleLogout);
    }

    const userCasesDropdown = document.getElementById('userCasesDropdown');
    if (userCasesDropdown) {
        userCasesDropdown.addEventListener('change', (e) => {
            if (e.target.value) switchToUserCase(e.target.value);
        });
    }

    const evidenceCaseFilterSelect = document.getElementById('evidenceCaseFilterSelect');
    if (evidenceCaseFilterSelect) {
        evidenceCaseFilterSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                switchToUserCase(e.target.value);
            } else {
                fetchAndRenderEvidenceMatrix();
            }
        });
    }
}

async function loadUserCasesList(user) {
    const userObj = user || JSON.parse(localStorage.getItem('lawbuddyUser') || 'null');
    if (!userObj || !userObj.uid) return;
    try {
        const res = await apiFetch(`/api/user/cases?user_id=${encodeURIComponent(userObj.uid)}`);
        const data = await readApiJson(res);
        if (data && data.cases) {
            populateUserCaseDropdowns(data.cases);
        }
    } catch (err) {
        console.warn('Could not load user cases list:', err);
    }
}

function populateUserCaseDropdowns(cases) {
    const userCasesDropdown = document.getElementById('userCasesDropdown');
    const evidenceCaseFilterSelect = document.getElementById('evidenceCaseFilterSelect');
    const caseCountBadge = document.getElementById('caseCountBadge');

    if (caseCountBadge) {
        caseCountBadge.textContent = `${cases.length} Case${cases.length === 1 ? '' : 's'} Loaded`;
    }

    const optionsHtml = cases.length > 0
        ? cases.map(c => `<option value="${c.doc_id}">${escapeHtml(c.filename)} (${c.doc_type || 'Case Doc'})</option>`).join('')
        : '<option value="">No cases uploaded yet</option>';

    if (userCasesDropdown) {
        userCasesDropdown.innerHTML = `<option value="">-- Select Saved Case (${cases.length}) --</option>` + optionsHtml;
        if (window.appState.activeDocId) {
            userCasesDropdown.value = window.appState.activeDocId;
        }
    }

    if (evidenceCaseFilterSelect) {
        evidenceCaseFilterSelect.innerHTML = `<option value="">-- All Cases for My Account (${cases.length}) --</option>` + optionsHtml;
        if (window.appState.activeDocId) {
            evidenceCaseFilterSelect.value = window.appState.activeDocId;
        }
    }
}

async function switchToUserCase(docId) {
    if (!docId) return;
    showNotification("Loading selected case details...");
    try {
        const user = JSON.parse(localStorage.getItem('lawbuddyUser') || 'null');
        const uid = user ? user.uid : '';
        const res = await apiFetch(`/api/user/case/${docId}?user_id=${encodeURIComponent(uid)}`);
        const data = await readApiJson(res);
        if (data && data.doc) {
            const doc = data.doc;
            updateActiveDocSession(doc);

            if (doc.analysis) {
                window.appState.analysisData = doc.analysis;
                renderClarityActionMap(doc.analysis.action_map, doc.analysis.summary);
                renderApplicableLaws(doc.analysis.applicable_laws_and_sections);
                renderClauseRisks(doc.analysis.clauses_and_risks);
                renderFactsAndTimeline(doc.analysis);
                renderCaseReadiness(doc.analysis);
            }
            fetchAndRenderEvidenceMatrix(doc.doc_id);

            // Sync dropdown selection values
            const userCasesDropdown = document.getElementById('userCasesDropdown');
            const evidenceCaseFilterSelect = document.getElementById('evidenceCaseFilterSelect');
            if (userCasesDropdown) userCasesDropdown.value = docId;
            if (evidenceCaseFilterSelect) evidenceCaseFilterSelect.value = docId;

            showNotification(`Active case switched to: ${doc.filename}`);
        }
    } catch (err) {
        showNotification(`Could not load selected case: ${err.message}`, true);
    }
}

async function syncUserDataAndRestoreCase(user) {
    if (!user || !user.uid) return;
    try {
        const res = await apiFetch('/api/user/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: user.uid,
                email: user.email,
                name: user.name
            })
        });

        const data = await readApiJson(res);
        if (data && data.latest_doc) {
            const doc = data.latest_doc;
            updateActiveDocSession(doc);

            if (doc.analysis) {
                window.appState.analysisData = doc.analysis;
                renderClarityActionMap(doc.analysis.action_map, doc.analysis.summary);
                renderApplicableLaws(doc.analysis.applicable_laws_and_sections);
                renderClauseRisks(doc.analysis.clauses_and_risks);
                renderFactsAndTimeline(doc.analysis);
                renderCaseReadiness(doc.analysis);
                fetchAndRenderEvidenceMatrix(doc.doc_id);
            }
            showNotification(`Welcome back, ${user.name || 'User'}! Restored your active case data.`);
        }
    } catch (err) {
        console.warn('Sync user data warning:', err);
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

function apiFetch(path, options = {}) {
    try {
        const user = JSON.parse(localStorage.getItem('lawbuddyUser') || 'null');
        if (user && user.uid) {
            options.headers = options.headers || {};
            if (options.headers instanceof Headers) {
                options.headers.set('X-User-ID', user.uid);
            } else {
                options.headers['X-User-ID'] = user.uid;
            }
        }
    } catch (e) {}
    return fetch(apiUrl(path), options);
}

// The familiar services stay behind the scenes; this layer keeps the journey human and simple.
function initSimpleLawBuddy() {
    const headings = [
        ['#evidenceTab .section-header h2', '📁 My Case'],
        ['#clarityMapTab .section-header h2', 'Here is a simple explanation'],
        ['#clarityMapTab .card-box h3', 'What is this?'],
        ['#startAnalysisBtn', 'Explain this']
    ];
    headings.forEach(([selector, label]) => {
        const element = document.querySelector(selector);
        if (element) element.textContent = label;
    });

    document.querySelectorAll('[data-home-action]').forEach(button => {
        button.addEventListener('click', () => startSimpleJourney(button.dataset.homeAction));
    });

    const cameraInput = document.getElementById('cameraFileInput') || document.getElementById('cameraInput');
    if (cameraInput) {
        cameraInput.addEventListener('change', async (event) => {
            if (event.target.files && event.target.files[0]) {
                showNotification("Scanning document notice photo...");
                await handleFileUpload(event.target.files[0]);
            }
            event.target.value = '';
        });
    }

    const continueButton = document.getElementById('storyContinueBtn');
    if (continueButton) continueButton.addEventListener('click', submitStory);
    const speakStoryButton = document.getElementById('storySpeakBtn');
    if (speakStoryButton) speakStoryButton.addEventListener('click', () => startVoiceInput('storyInput'));
    const speakResultButton = document.getElementById('speakResultBtn');
    if (speakResultButton) speakResultButton.addEventListener('click', speakCurrentExplanation);
    const explainWordButton = document.getElementById('explainWordBtn');
    if (explainWordButton) explainWordButton.addEventListener('click', explainDifficultWord);
    document.querySelectorAll('.level-btn').forEach(button => {
        button.addEventListener('click', () => setExplanationLevel(button.dataset.level));
    });
}

function startSimpleJourney(action) {
    if (action === 'document') return switchTab('uploadTab');
    if (action === 'photo') {
        const cam = document.getElementById('cameraFileInput') || document.getElementById('cameraInput');
        if (cam) cam.click();
        return;
    }
    if (action === 'case') return switchTab('evidenceTab');
    if (action === 'question') return switchTab('chatTab');
    if (action === 'voice') {
        switchTab('chatTab');
        startVoiceInput('chatInput');
        return;
    }
    switchTab('storyTab');
}

async function submitStory() {
    const input = document.getElementById('storyInput');
    const story = input?.value.trim();
    if (!story) return showNotification('Please tell me what happened, in your own words.', true);
    showNotification('Thanks. I am preparing a simple explanation…');
    try {
        const res = await apiFetch('/api/upload', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: story, filename: 'What_happened.txt' })
        });
        const data = await readApiJson(res);
        if (data.error) throw new Error(data.error);
        updateActiveDocSession(data);
        runDocumentAnalysis(data.doc_id, data.doc_type, true);
    } catch (error) {
        showNotification(`I could not use that information yet. ${error.message}`, true);
    }
}

function startVoiceInput(targetId) {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
        showNotification('Voice input is not available in this browser. You can type your message instead.', true);
        return;
    }
    const languageMap = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN', ml: 'ml-IN', te: 'te-IN', mr: 'mr-IN', bn: 'bn-IN', gu: 'gu-IN', ta: 'ta-IN' };
    const recognition = new Recognition();
    recognition.lang = languageMap[window.appState.selectedLanguage] || 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    document.getElementById('voiceHelp')?.classList.remove('hidden');
    recognition.onresult = event => {
        const field = document.getElementById(targetId);
        if (field) field.value = `${field.value ? `${field.value} ` : ''}${event.results[0][0].transcript}`;
    };
    recognition.onerror = () => showNotification('I could not hear that clearly. Please try again or type your message.', true);
    recognition.onend = () => document.getElementById('voiceHelp')?.classList.add('hidden');
    recognition.start();
}

function speakCurrentExplanation() {
    if (!window.speechSynthesis) return showNotification('Read-aloud is not available in this browser.', true);
    const text = document.getElementById('docOverviewSummary')?.textContent?.trim();
    if (!text) return showNotification('Add a document first, then I can read the explanation aloud.', true);
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = ({ en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN', ml: 'ml-IN', te: 'te-IN', mr: 'mr-IN', bn: 'bn-IN', gu: 'gu-IN', ta: 'ta-IN' })[window.appState.selectedLanguage] || 'en-IN';
    speechSynthesis.speak(utterance);
}

function setExplanationLevel(level) {
    document.querySelectorAll('.level-btn').forEach(button => button.classList.toggle('active', button.dataset.level === level));
    document.querySelector('.main-content')?.classList.toggle('very-simple-mode', level === 'very-simple');
    document.querySelector('.main-content')?.classList.toggle('details-mode', level === 'details');
}

async function explainDifficultWord() {
    const word = document.getElementById('difficultWordInput')?.value.trim();
    if (!word) return showNotification('Type a word you would like explained.', true);
    if (!window.appState.activeDocId) return showNotification('Add a document first so I can explain the word in context.', true);
    const output = document.getElementById('wordExplanation');
    output.textContent = 'Finding a simple explanation…'; output.classList.remove('hidden');
    try {
        const res = await apiFetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc_id: window.appState.activeDocId, language: window.appState.selectedLanguage, question: `Explain the word "${word}" simply. Give a short everyday example and one useful question to ask a lawyer. If it is not in this document, say so.` }) });
        const data = await readApiJson(res);
        output.textContent = data.error || data.answer;
    } catch (error) { output.textContent = 'I could not explain that word right now. Please try again.'; }
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

    const floatBtn = document.getElementById('floatingChatContainer');
    if (floatBtn) {
        if (targetId === 'chatTab') {
            floatBtn.classList.add('hidden');
        } else {
            floatBtn.classList.remove('hidden');
        }
    }
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
const APP_TRANSLATIONS = {
    en: {
        tagline: 'Legal Access & Case Preparation Platform', demo: '1-Click Rental Agreement Demo', language: 'Language', deleteAccount: 'Delete Account', exit: 'Exit', activeDocument: 'Active Document', noDocLoaded: 'No document loaded', pendingUpload: 'Pending Upload', navHome: 'Home', navMyCase: 'My Case', navChat: 'Case AI ChatBot', floatingChatLabel: 'Ask AI ChatBot', chatTitle: '💬 Case AI ChatBot', chatSub: 'Ask questions about your uploaded housing document or case. Answers are strictly grounded in your case facts in your selected language.', chatPlaceholder: 'Type or speak your question about this case...', chatSend: 'Send 📤', chatSpeak: '🎤 Speak', chatClear: '🗑️ Clear Chat', chatWelcome: 'Hello! Ask me any question about your case or uploaded document in your preferred language.', chatSuggestionsTitle: '💡 Suggested Questions for this Case:', chipNotice: '📌 Notice Period?', chipRent: '📌 Amount / Rent?', chipObligations: '📌 Key Obligations?', chipPenalties: '📌 Penalties & Laws?', legalInfoNoticeTitle: '⚠️ Legal Information Notice', legalInfoNoticeDesc: 'LawBuddy AI provides preparation assistance, not legal advice or representation. Verify critical claims with legal aid or an advocate.', privacyBanner: '🔒 Privacy Guarantee: Uploaded documents are processed securely in memory and automatically deleted within 3 hours. We do not store any document permanently.', homeHeader: 'What do you need help with?', homeSub: 'Legal documents can be difficult to understand. Let me explain them simply.', cardExplainDoc: 'Explain my document', cardExplainDocSub: 'Upload a file, paste text, or add a link', cardLegalQuestion: 'I have a legal question', cardLegalQuestionSub: 'Tell me what happened in your own words', cardPhotoNotice: 'Take a photo of a notice', cardPhotoNoticeSub: 'We will read it and explain it', cardSpeak: 'Speak to LawBuddy', cardSpeakSub: 'Say what happened in your preferred language', btnMyCase: '📁 My Case', btnBackHome: '← Home', storyTitle: 'What happened?', storySub: 'Use everyday words. You do not need to know legal terms.', storyPlaceholder: 'For example: My landlord gave me a notice and I don\'t understand it.', btnSpeakInstead: '🎤 Speak instead', btnContinue: 'Continue', listeningText: 'Listening… speak naturally, then pause.', uploadTitle: 'Upload Legal Document', uploadDescription: 'Supports Legal Notices, Rental Agreements, Employment Contracts, Consumer Complaints, NDAs, Service Contracts, and more.', uploadStep1: '1. Upload Document', fileSupport: 'Supports PDF, DOCX, TXT, PNG, JPG (Scanned Notice & Document OCR Supported)', browse: 'Browse Files', loadDemo: '⚡ Load Sample Rental Agreement Demo', uploadStep2: '2. Upload Text', pastePlaceholder: 'Paste legal notice text, agreement clauses, employment contract text, or communication here...', analyzePasted: 'Analyze Pasted Text', uploadStep3: '3. Enter or Paste a Link', linkSub: 'Paste a public webpage link and LawBuddy will extract its text for AI analysis.', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'Analyze Website Link', docSource: 'Document Source:', docTypeLabel: 'Document type:', btnAnalyzeDoc: '🚀 Analyze Document & Map Facts', textFoundLabel: 'Text we found:', evidenceTitle: '📋 Evidence-to-Clause Mapping & Verification Matrix', evidenceSub: 'Keep your important documents, dates, and questions in one simple place.', evidenceAddPlaceholder: 'Add something you have, such as a payment receipt or message...', btnAddEvidence: '➕ Add Evidence Item', statusFound: 'Evidence found', statusMissing: 'Evidence missing', statusSuggested: 'Evidence suggested', statusVerification: 'Requires verification', clarityTitle: 'Legal Clarity & Document Overview Action Map', claritySub: 'Based on the document or information you shared. This is general information, not legal advice.', showLabel: 'Show:', lvlSimple: '🙂 Simple', lvlVerySimple: '👶 Very Simple', lvlDetails: '⚖️ Legal Details', btnReadAloud: '🔊 Read this aloud', execSummaryTitle: '📄 Executive Document Summary', execSummaryPlaceholder: 'Upload a document and click \'Analyze Document & Map Facts\' to generate an instant plain-language summary.', actionUnderstand: '💡 Understand', actionUnderstandDesc: 'Plain-language summary of what this document demands', actionIdentify: '⚠️ Identify', actionIdentifyDesc: 'Deadlines, cure periods, monetary claims & obligations', actionPrepare: '📝 Prepare', actionPrepareDesc: 'Questions for a lawyer & evidence collection checklist', actionNavigate: '🧭 Navigate', actionNavigateDesc: 'Step-by-step non-advice plan & official legal resources', difficultWordTitle: 'What does a difficult word mean?', difficultWordSub: 'Type a word from the document, such as “indemnification”.', difficultWordPlaceholder: 'Type a word', btnExplainWord: 'Explain this word', difficultTermModalTitle: 'Difficult Term', simpleMeaningHeader: '💡 Simple Meaning:', everydayExampleHeader: '🌟 Everyday Example:', askLawyerHeader: '🧑‍⚖️ Ask a Lawyer:', btnGotIt: 'Got it!', factsTitle: 'Extracted Facts & Chronological Event Timeline', factsSub: 'Automatic extraction of entities, amounts, obligations, and dispute sequence.', keyDatesLabel: 'KEY DATES & DEADLINES', amountsLabel: 'AMOUNTS & FINANCIALS', partiesLabel: 'PARTIES & ENTITIES', obligationsLabel: 'KEY MANDATE / OBLIGATIONS', timelineTitle: '📅 Chronological Fact & Dispute Timeline', applicableLawsTitle: 'Applicable Indian Laws, Statutory Sections, Penalties & Case Handling Procedure', applicableLawsSub: 'Tailored statutory sections (BNS/IPC, Rent Control, Consumer Act, Contract Act), maximum penalties/punishments, step-by-step complaint handling, and official legal portals.'
    },
    kn: {
        tagline: 'ಕಾನೂನು ಲಭ್ಯತೆ ಮತ್ತು ಪ್ರಕರಣ ಸಿದ್ಧತೆಯ ವೇದಿಕೆ', demo: 'ಒಂದು ಕ್ಲಿಕ್ ಬಾಡಿಗೆ ಒಪ್ಪಂದ ಡೆಮೊ', language: 'ಭಾಷೆ', deleteAccount: 'ಖಾತೆ ಅಳಿಸಿ', exit: 'ನಿರ್ಗಮಿಸಿ', activeDocument: 'ಸಕ್ರಿಯ ದಾಖಲೆ', noDocLoaded: 'ಯಾವ ದಾಖಲೆಯೂ ಲೋಡ್ ಆಗಿಲ್ಲ', pendingUpload: 'ಅಪ್‌ಲೋಡ್ ಬಾಕಿ ಇದೆ', navHome: 'ಮುಖಪುಟ', navMyCase: 'ನನ್ನ ಪ್ರಕರಣ', navChat: 'ಪ್ರಕರಣ AI ಚಾಟ್‌ಬಾಟ್', floatingChatLabel: 'AI ಚಾಟ್‌ಬಾಟ್ ಕೇಳಿ', chatTitle: '💬 ಪ್ರಕರಣ AI ಚಾಟ್‌ಬಾಟ್', chatSub: 'ನಿಮ್ಮ ಅಪ್‌ಲೋಡ್ ಮಾಡಿದ ದಾಖಲೆ ಅಥವಾ ಪ್ರಕರಣದ ಬಗ್ಗೆ ಪ್ರಶ್ನೆಗಳನ್ನು ಕೇಳಿ. ಉತ್ತರಗಳು ನಿಮ್ಮ ಆಯ್ಕೆಯ ಭಾಷೆಯಲ್ಲಿರುತ್ತವೆ.', chatPlaceholder: 'ಈ ಪ್ರಕರಣದ ಬಗ್ಗೆ ನಿಮ್ಮ ಪ್ರಶ್ನೆಯನ್ನು ಟೈಪ್ ಮಾಡಿ ಅಥವಾ ಮಾತನಾಡಿ...', chatSend: 'ಕಳುಹಿಸಿ 📤', chatSpeak: '🎤 ಮಾತನಾಡಿ', chatClear: '🗑️ ಚಾಟ್ ಅಳಿಸಿ', chatWelcome: 'ನಮಸ್ಕಾರ! ನಿಮ್ಮ ಪ್ರಕರಣ ಅಥವಾ ದಾಖಲೆಯ ಬಗ್ಗೆ ಯಾವುದೇ ಪ್ರಶ್ನೆಯನ್ನು ನಿಮ್ಮ ಭಾಷೆಯಲ್ಲಿ ಕೇಳಿ.', chatSuggestionsTitle: '💡 ಈ ಪ್ರಕರಣಕ್ಕೆ ಸೂಚಿಸಲಾದ ಪ್ರಶ್ನೆಗಳು:', chipNotice: '📌 ನೋಟಿಸ್ ಅವಧಿ?', chipRent: '📌 ಬಾಡಿಗೆ / ಮೊತ್ತ?', chipObligations: '📌 ಮುಖ್ಯ ಬಾಧ್ಯತೆಗಳು?', chipPenalties: '📌 ದಂಡಗಳು ಮತ್ತು ಕಾನೂನುಗಳು?', legalInfoNoticeTitle: '⚠️ ಕಾನೂನು ಮಾಹಿತಿ ಸೂಚನೆ', legalInfoNoticeDesc: 'LawBuddy AI ಸಿದ್ಧತೆಗೆ ಸಹಾಯ ಮಾಡುತ್ತದೆ, ಕಾನೂನು ಸಲಹೆ ನೀಡಲ್ಲ. ವಕೀಲರಿಂದ ಪರಿಶೀಲಿಸಿ.', privacyBanner: '🔒 ಗೌಪ್ಯತೆ ಭರವಸೆ: ಅಪ್‌ಲೋಡ್ ಮಾಡಿದ ದಾಖಲೆಗಳನ್ನು ಸುರಕ್ಷಿತವಾಗಿ ಸಂಸ್ಕರಿಸಲಾಗುತ್ತದೆ ಮತ್ತು 3 ಗಂಟೆಗಳಲ್ಲಿ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಳಿಸಲಾಗುತ್ತದೆ.', homeHeader: 'ನಿಮಗೆ ಉಚಿತ ಕಾನೂನು ನೆರವು ಬೇಕೇ?', homeSub: 'ಕಾನೂನು ದಾಖಲೆಗಳನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳುವುದು ಕಷ್ಟ. ನಾನು ಸರಳವಾಗಿ ವಿವರಿಸುತ್ತೇನೆ.', cardExplainDoc: 'ನನ್ನ ದಾಖಲೆಯನ್ನು ವಿವರಿಸಿ', cardExplainDocSub: 'ಫೈಲ್ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ, ಪಠ್ಯ ಅಂಟಿಸಿ ಅಥವಾ ಲಿಂಕ್ ಸೇರಿಸಿ', cardLegalQuestion: 'ನನಗೆ ಕಾನೂನು ಪ್ರಶ್ನೆ ಇದೆ', cardLegalQuestionSub: 'ಏನಾಯಿತು ಎಂದು ನಿಮ್ಮ ಮಾತಿನಲ್ಲಿ ಹೇಳಿ', cardPhotoNotice: 'ನೋಟಿಸ್‌ನ ಫೋಟೋ ತೆಗೆಯಿರಿ', cardPhotoNoticeSub: 'ನಾವು ಅದನ್ನು ಓದಿ ವಿವರಿಸುತ್ತೇವೆ', cardSpeak: 'LawBuddy ಯೊಂದಿಗೆ ಮಾತನಾಡಿ', cardSpeakSub: 'ನಿಮ್ಮ ಆಯ್ಕೆಯ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡಿ', btnMyCase: '📁 ನನ್ನ ಪ್ರಕರಣ', btnBackHome: '← ಮುಖಪುಟ', storyTitle: 'ಏನಾಯಿತು?', storySub: 'ಸಾಮಾನ್ಯ ಮಾತುಗಳನ್ನು ಬಳಸಿ. ಕಾನೂನು ಪದಗಳು ಬೇಕಾಗಿಲ್ಲ.', storyPlaceholder: 'ಉದಾಹರಣೆಗೆ: ನನ್ನ ಮನೆಮಾಲೀಕರು ನೋಟಿಸ್ ನೀಡಿದ್ದಾರೆ, ನನಗೆ ಅರ್ಥವಾಗುತ್ತಿಲ್ಲ.', btnSpeakInstead: '🎤 ಮಾತನಾಡಿ', btnContinue: 'ಮುಂದುವರಿಸಿ', listeningText: 'ಆಲಿಸುತ್ತಿದೆ… ಸ್ಪಷ್ಟವಾಗಿ ಮಾತನಾಡಿ, ನಂತರ ನಿಲ್ಲಿಸಿ.', uploadTitle: 'ಕಾನೂನು ದಾಖಲೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ', uploadDescription: 'ಕಾನೂನು ನೋಟಿಸ್‌ಗಳು, ಬಾಡಿಗೆ ಒಪ್ಪಂದಗಳು, ಉದ್ಯೋಗ ಒಪ್ಪಂದಗಳು ಮತ್ತು ಇತರೆ ದಾಖಲೆಗಳಿಗೆ ಬೆಂಬಲವಿದೆ.', uploadStep1: '1. ದಾಖಲೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ', fileSupport: 'PDF, DOCX, TXT, PNG, JPG ಬೆಂಬಲಿಸುತ್ತದೆ (OCR ಲಭ್ಯವಿದೆ)', browse: 'ಫೈಲ್‌ಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ', loadDemo: '⚡ ಮಾದರಿ ಒಪ್ಪಂದ ಡೆಮೊ ಲೋಡ್ ಮಾಡಿ', uploadStep2: '2. ಪಠ್ಯ ಅಂಟಿಸಿ', pastePlaceholder: 'ಕಾನೂನು ನೋಟಿಸ್ ಪಠ್ಯ ಅಥವಾ ಷರತ್ತುಗಳನ್ನು ಇಲ್ಲಿ ಅಂಟಿಸಿ...', analyzePasted: 'ಅಂಟಿಸಿದ ಪಠ್ಯವನ್ನು ವಿಶ್ಲೇಷಿಸಿ', uploadStep3: '3. ಲಿಂಕ್ ನಮೂದಿಸಿ', linkSub: 'ವೆಬ್ ಪುಟದ ಲಿಂಕ್ ಅಂಟಿಸಿ', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'ಲಿಂಕ್ ವಿಶ್ಲೇಷಿಸಿ', docSource: 'ದಾಖಲೆಯ ಮೂಲ:', docTypeLabel: 'ದಾಖಲೆಯ ಪ್ರಕಾರ:', btnAnalyzeDoc: '🚀 ದಾಖಲೆ ವಿಶ್ಲೇಷಿಸಿ ಮತ್ತು ನಕ್ಷೆ ಮಾಡಿ', textFoundLabel: 'ಕಂಡುಬಂದ ಪಠ್ಯ:', evidenceTitle: '📋 ಸಾಕ್ಷ್ಯ ಮತ್ತು ಷರತ್ತುಗಳ ನಕ್ಷೆ', evidenceSub: 'ನಿಮ್ಮ ಪ್ರಮುಖ ದಾಖಲೆಗಳು ಮತ್ತು ದಿನಾಂಕಗಳನ್ನು ಒಂದೇ ಸ್ಥಳದಲ್ಲಿ ಇರಿಸಿ.', evidenceAddPlaceholder: 'ನಿಮ್ಮಲ್ಲಿರುವ ರಶೀದಿ ಅಥವಾ ಸಂದೇಶವನ್ನು ಸೇರಿಸಿ...', btnAddEvidence: '➕ ಸಾಕ್ಷ್ಯ ಅಂಶ ಸೇರಿಸಿ', statusFound: 'ಸಾಕ್ಷ್ಯ ಸಿಕ್ಕಿದೆ', statusMissing: 'ಸಾಕ್ಷ್ಯ ಲಭ್ಯವಿಲ್ಲ', statusSuggested: 'ಸೂಚಿಸಿದ ಸಾಕ್ಷ್ಯ', statusVerification: 'ಪರಿಶೀಲನೆ ಅಗತ್ಯವಿದೆ', clarityTitle: 'ಕಾನೂನು ಸ್ಪಷ್ಟತೆ ಮತ್ತು ಕ್ರಿಯಾ ನಕ್ಷೆ', claritySub: 'ನೀವು ಹಂಚಿಕೊಂಡ ಮಾಹಿತಿಯ ಆಧಾರದ ಮೇಲೆ ಸಾಮಾನ್ಯ ವಿವರಣೆ.', showLabel: 'ತೋರಿಸಿ:', lvlSimple: '🙂 ಸರಳ', lvlVerySimple: '👶 ಅತ್ಯಂತ ಸರಳ', lvlDetails: '⚖️ ಕಾನೂನು ವಿವರಗಳು', btnReadAloud: '🔊 ಗಟ್ಟಿಯಾಗಿ ಓದಿ', execSummaryTitle: '📄 ದಾಖಲೆಯ ಮುಖ್ಯ ಸಾರಾಂಶ', execSummaryPlaceholder: 'ಸಾರಾಂಶವನ್ನು ಪಡೆಯಲು ದಾಖಲೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ ವಿಶ್ಲೇಷಿಸಿ.', actionUnderstand: '💡 ಅರ್ಥಮಾಡಿಕೊಳ್ಳಿ', actionUnderstandDesc: 'ದಾಖಲೆಯ ಸರಳ ಸಾರಾಂಶ', actionIdentify: '⚠️ ಗುರುತಿಸಿ', actionIdentifyDesc: 'ಗಡುವುಗಳು, ದಂಡಗಳು ಮತ್ತು ಬಾಧ್ಯತೆಗಳು', actionPrepare: '📝 ಸಿದ್ಧರಾಗಿ', actionPrepareDesc: 'ವಕೀಲರ ಪ್ರಶ್ನೆಗಳು ಮತ್ತು ಸಾಕ್ಷ್ಯಗಳ ಪಟ್ಟಿ', actionNavigate: '🧭 ಮಾರ್ಗದರ್ಶನ', actionNavigateDesc: 'ಹಂತ-ಹಂತದ ಮುಂದಿನ ಕ್ರಮಗಳು', difficultWordTitle: 'ಕಠಿಣ ಪದದ ಅರ್ಥವೇನು?', difficultWordSub: 'ದಾಖಲೆಯಿಂದ ಒಂದು ಪದವನ್ನು ಟೈಪ್ ಮಾಡಿ.', difficultWordPlaceholder: 'ಪದವನ್ನು ಟೈಪ್ ಮಾಡಿ', btnExplainWord: 'ಈ ಪದವನ್ನು ವಿವರಿಸಿ', difficultTermModalTitle: 'ಕಠಿಣ ಪದ', simpleMeaningHeader: '💡 ಸರಳ ಅರ್ಥ:', everydayExampleHeader: '🌟 ದಿನನಿತ್ಯದ ಉದಾಹರಣೆ:', askLawyerHeader: '🧑‍⚖️ ವಕೀಲರನ್ನು ಕೇಳಿ:', btnGotIt: 'ಅರ್ಥವಾಯಿತು!', factsTitle: 'ಪ್ರಮುಖ ಸಂಗತಿಗಳು ಮತ್ತು ಕಾಲಾನುಕ್ರಮ', factsSub: 'ದಿನಾಂಕಗಳು, ಮೊತ್ತಗಳು ಮತ್ತು ಘಟನೆಗಳ ಸ್ವಯಂಚಾಲಿತ ಪಟ್ಟಿ.', keyDatesLabel: 'ಪ್ರಮುಖ ದಿನಾಂಕಗಳು ಮತ್ತು ಗಡುವುಗಳು', amountsLabel: 'ಹಣಕಾಸು ಮತ್ತು ಮೊತ್ತಗಳು', partiesLabel: 'ಸಂಬಂಧಿತ ವ್ಯಕ್ತಿಗಳು/ಸಂಸ್ಥೆಗಳು', obligationsLabel: 'ಪ್ರಮುಖ ಬಾಧ್ಯತೆಗಳು', timelineTitle: '📅 ಘಟನೆಗಳ ಕಾಲಾನುಕ್ರಮ', applicableLawsTitle: 'ಅನ್ವಯವಾಗುವ ಭಾರತೀಯ ಕಾನೂನುಗಳು, ಶಾಸನಬದ್ಧ ವಿಭಾಗಗಳು, ದಂಡಗಳು ಮತ್ತು ಪ್ರಕರಣ ನಿರ್ವಹಣೆ', applicableLawsSub: 'ಅನ್ವಯವಾಗುವ ಶಾಸನಬದ್ಧ ವಿಭಾಗಗಳು (BNS/IPC, ಬಾಡಿಗೆ ನಿಯಂತ್ರಣ, ಗ್ರಾಹಕ ಕಾಯಿದೆ, ಒಪ್ಪಂದ ಕಾಯಿದೆ), ಗರಿಷ್ಠ ದಂಡಗಳು/ಶಿಕ್ಷೆಗಳು, ಹಂತ-ಹಂತದ ದೂರು ನಿರ್ವಹಣೆ ಮತ್ತು ಅಧಿಕೃತ ಕಾನೂನು ಪೋರ್ಟಲ್‌ಗಳು.'
    },
    hi: {
        tagline: 'कानूनी पहुंच और मामला तैयारी मंच', demo: 'एक-क्लिक किराया समझौता डेमो', language: 'भाषा', deleteAccount: 'खाता हटाएं', exit: 'बाहर निकलें', activeDocument: 'सक्रिय दस्तावेज़', noDocLoaded: 'कोई दस्तावेज़ लोड नहीं है', pendingUpload: 'अपलोड लंबित', navHome: 'होम', navMyCase: 'मेरा केस', navChat: 'केस AI चैटबॉट', floatingChatLabel: 'AI चैटबॉट से पूछें', chatTitle: '💬 केस AI चैटबॉट', chatSub: 'अपने अपलोड किए गए दस्तावेज़ या केस के बारे में प्रश्न पूछें। उत्तर आपकी चुनी गई भाषा में होंगे।', chatPlaceholder: 'इस केस के बारे में अपना प्रश्न टाइप करें या बोलें...', chatSend: 'भेजें 📤', chatSpeak: '🎤 बोलें', chatClear: '🗑️ चैट साफ़ करें', chatWelcome: 'नमस्ते! अपने केस या अपलोड किए गए दस्तावेज़ के बारे में अपनी भाषा में कोई भी प्रश्न पूछें।', chatSuggestionsTitle: '💡 इस केस के लिए सुझाये गए प्रश्न:', chipNotice: '📌 नोटिस अवधि?', chipRent: '📌 किराया / राशि?', chipObligations: '📌 मुख्य दायित्व?', chipPenalties: '📌 दंड और कानून?', legalInfoNoticeTitle: '⚠️ कानूनी सूचना', legalInfoNoticeDesc: 'LawBuddy AI सहायता प्रदान करता है, यह कानूनी सलाह नहीं है।', privacyBanner: '🔒 गोपनीयता गारंटी: अपलोड किए गए दस्तावेज़ 3 घंटे के भीतर स्वचालित रूप से हटा दिए जाते हैं।', homeHeader: 'आपको किसमें सहायता चाहिए?', homeSub: 'कानूनी दस्तावेज़ों को समझना कठिन हो सकता है। मैं सरलता से समझाऊंगा।', cardExplainDoc: 'मेरा दस्तावेज़ समझाइए', cardExplainDocSub: 'फ़ाइल अपलोड करें, पाठ चिपकाएँ या लिंक जोड़ें', cardLegalQuestion: 'मेरा एक कानूनी प्रश्न है', cardLegalQuestionSub: 'अपने शब्दों में बताएं कि क्या हुआ', cardPhotoNotice: 'नोटिस की फोटो लें', cardPhotoNoticeSub: 'हम इसे पढ़कर समझाएंगे', cardSpeak: 'LawBuddy से बात करें', cardSpeakSub: 'अपनी पसंदीदा भाषा में बोलें', btnMyCase: '📁 मेरा केस', btnBackHome: '← होम', storyTitle: 'क्या हुआ था?', storySub: 'सामान्य शब्दों का प्रयोग करें।', storyPlaceholder: 'उदाहरण के लिए: मेरे मकान मालिक ने मुझे एक नोटिस दिया है।', btnSpeakInstead: '🎤 बोलकर बताएं', btnContinue: 'आगे बढ़ें', listeningText: 'सुन रहे हैं...', uploadTitle: 'कानूनी दस्तावेज़ अपलोड करें', uploadDescription: 'नोटिस, किराया समझौते, रोजगार अनुबंध आदि का समर्थन करता है।', uploadStep1: '1. दस्तावेज़ अपलोड करें', fileSupport: 'PDF, DOCX, TXT, PNG, JPG समर्थित (OCR उपलब्ध)', browse: 'फ़ाइलें चुनें', loadDemo: '⚡ नमूना समझौता डेमो लोड करें', uploadStep2: '2. पाठ चिपकाएँ', pastePlaceholder: 'कानूनी पाठ यहाँ चिपकाएँ...', analyzePasted: 'विश्लेषण करें', uploadStep3: '3. लिंक दर्ज करें', linkSub: 'वेबपेज लिंक चिपकाएँ', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'लिंक का विश्लेषण करें', docSource: 'दस्तावेज़ का स्रोत:', docTypeLabel: 'दस्तावेज़ का प्रकार:', btnAnalyzeDoc: '🚀 विश्लेषण करें और मानचित्रित करें', textFoundLabel: 'प्राप्त पाठ:', evidenceTitle: '📋 साक्ष्य और धारा मैपिंग', evidenceSub: 'अपने दस्तावेज़ों और तिथियों को एक स्थान पर रखें।', evidenceAddPlaceholder: 'कोई रसीद या संदेश जोड़ें...', btnAddEvidence: '➕ साक्ष्य जोड़ें', statusFound: 'साक्ष्य मिला', statusMissing: 'साक्ष्य अनुपलब्ध', statusSuggested: 'सुझाया गया साक्ष्य', statusVerification: 'सत्यापन आवश्यक', clarityTitle: 'कानूनी स्पष्टता और कार्य मानचित्र', claritySub: 'सामान्य विवरण।', showLabel: 'दिखाएं:', lvlSimple: '🙂 सरल', lvlVerySimple: '👶 अत्यंत सरल', lvlDetails: '⚖️ कानूनी विवरण', btnReadAloud: '🔊 बोलकर सुनाएं', execSummaryTitle: '📄 मुख्य दस्तावेज़ सारांश', execSummaryPlaceholder: 'दस्तावेज़ अपलोड करें।', actionUnderstand: '💡 समझें', actionUnderstandDesc: 'सरल सारांश', actionIdentify: '⚠️ पहचानें', actionIdentifyDesc: 'समय-सीमाएं और दायित्व', actionPrepare: '📝 तैयारी करें', actionPrepareDesc: 'वकील के लिए प्रश्न और साक्ष्य सूची', actionNavigate: '🧭 मार्गदर्शन', actionNavigateDesc: 'चरण-दर-चरण कदम', difficultWordTitle: 'कठिन शब्द का क्या अर्थ है?', difficultWordSub: 'कोई शब्द टाइप करें।', difficultWordPlaceholder: 'शब्द टाइप करें', btnExplainWord: 'शब्द समझाइए', difficultTermModalTitle: 'कठिन शब्द', simpleMeaningHeader: '💡 सरल अर्थ:', everydayExampleHeader: '🌟 दैनिक उदाहरण:', askLawyerHeader: '🧑‍⚖️ वकील से पूछें:', btnGotIt: 'समझ गया!', factsTitle: 'निकाले गए तथ्य और समयरेखा', factsSub: 'तारीखों और राशियाँ की सूची।', keyDatesLabel: 'मुख्य तिथियां', amountsLabel: 'वित्तीय राशियाँ', partiesLabel: 'संबंधित पक्ष', obligationsLabel: 'मुख्य दायित्व', timelineTitle: '📅 घटनाओं की समयरेखा', applicableLawsTitle: 'लागू भारतीय कानून, वैधानिक धाराएं, दंड और केस हैंडलिंग प्रक्रिया', applicableLawsSub: 'प्रासंगिक वैधानिक धाराएं (BNS/IPC, किराया नियंत्रण, उपभोक्ता अधिनियम, अनुबंध अधिनियम), अधिकतम दंड/सजा, चरण-दर-चरण शिकायत निवारण और आधिकारिक कानूनी पोर्टल।'
    },
    ml: {
        tagline: 'നിയമ പ്രവേശനവും കേസ് തയ്യാറാക്കൽ പ്ലാറ്റ്‌ഫോമും', demo: 'ഒറ്റ ക്ലിക്ക് വാടക കരാർ ഡെമോ', language: 'ഭാഷ', deleteAccount: 'അക്കൗണ്ട് ഇല്ലാതാക്കുക', exit: 'പുറത്തുകടക്കുക', activeDocument: 'സജീവ പ്രമാണം', noDocLoaded: 'പ്രമാണമൊന്നും ലോഡ് ചെയ്തിട്ടില്ല', pendingUpload: 'അപ്‌ലോഡ് ബാക്കിയാണ്', navHome: 'ഹോം', navMyCase: 'എന്റെ കേസ്', navChat: 'കേസ് AI ചാറ്റ് ബോട്ട്', floatingChatLabel: 'AI ചാറ്റ് ബോട്ടിനോട് ചോദിക്കുക', chatTitle: '💬 കേസ് AI ചാറ്റ് ബോട്ട്', chatSub: 'നിങ്ങൾ അപ്‌ലോഡ് ചെയ്ത പ്രമാണത്തെക്കുറിച്ചോ കേസിനെക്കുറിച്ചോ ചോദ്യങ്ങൾ ചോദിക്കുക. ഉത്തരങ്ങൾ നിങ്ങളുടെ ഭാഷയിൽ ലഭ്യമാണ്.', chatPlaceholder: 'ഈ കേസിനെക്കുറിച്ച് നിങ്ങളുടെ ചോദ്യം ടൈപ്പ് ചെയ്യുക അല്ലെങ്കിൽ സംസാരിക്കുക...', chatSend: 'അയക്കുക 📤', chatSpeak: '🎤 സംസാരിക്കുക', chatClear: '🗑️ ചാറ്റ് മായ്ക്കുക', chatWelcome: 'നമസ്കാരം! നിങ്ങളുടെ കേസിനെക്കുറിച്ചോ പ്രമാണത്തെക്കുറിച്ചോ ചോദ്യങ്ങൾ ചോദിക്കുക.', chatSuggestionsTitle: '💡 ഈ കേസിനായി നിർദ്ദേശിച്ച ചോദ്യങ്ങൾ:', chipNotice: '📌 നോട്ടീസ് കാലാവധി?', chipRent: '📌 വാടക / തുക?', chipObligations: '📌 പ്രധാന ബാധ്യതകൾ?', chipPenalties: '📌 പിഴകളും നിയമങ്ങളും?', legalInfoNoticeTitle: '⚠️ നിയമ വിവര മുന്നറിയിപ്പ്', legalInfoNoticeDesc: 'LawBuddy AI തയ്യാറെടുപ്പ് സഹായം നൽകുന്നു.', privacyBanner: '🔒 സ്വകാര്യതാ ഉറപ്പ്: അപ്‌ലോഡ് ചെയ്ത പ്രമാണങ്ങൾ 3 മണിക്കൂറിനുള്ളിൽ സ്വയമേവ ഇല്ലാതാക്കുന്നു.', homeHeader: 'നിങ്ങൾക്ക് എന്തിലാണ് സഹായം വേണ്ടത്?', homeSub: 'നിയമ രേഖകൾ മനസ്സിലാക്കാൻ ബുദ്ധിമുട്ടാണ്. ഞാൻ ലളിതമായി വിവരിക്കാം.', cardExplainDoc: 'എന്റെ പ്രമാണം വിശദീകരിക്കുക', cardExplainDocSub: 'ഫയൽ അപ്‌ലോഡ് ചെയ്യുക അല്ലെങ്കിൽ ലിങ്ക് ചേർക്കുക', cardLegalQuestion: 'എനിക്ക് ഒരു നിയമപരമായ ചോദ്യമുണ്ട്', cardLegalQuestionSub: 'എന്താണ് സംഭവിച്ചതെന്ന് സ്വന്തം വാക്കുകളിൽ പറയുക', cardPhotoNotice: 'നോട്ടീസിന്റെ ഫോട്ടോ എടുക്കുക', cardPhotoNoticeSub: 'ഞങ്ങൾ അത് വായിച്ച് വിശദീകരിക്കും', cardSpeak: 'LawBuddy-യോട് സംസാരിക്കുക', cardSpeakSub: 'നിങ്ങളുടെ ഭാഷയിൽ സംസാരിക്കുക', btnMyCase: '📁 എന്റെ കേസ്', btnBackHome: '← ഹോം', storyTitle: 'എന്താണ് സംഭവിച്ചത്?', storySub: 'സാധാരണ വാക്കുകൾ ഉപയോഗിക്കുക.', storyPlaceholder: 'ഉദാഹരണത്തിന്: വീട്ടുടമസ്ഥൻ നോട്ടീസ് നൽകി.', btnSpeakInstead: '🎤 സംസാരിക്കുക', btnContinue: 'തുടരുക', listeningText: 'ശ്രദ്ധിക്കുന്നു…', uploadTitle: 'നിയമപരമായ പ്രമാണം അപ്‌ലോഡ് ചെയ്യുക', uploadDescription: 'നോട്ടീസുകൾ, വാടക കരാറുകൾ മുതലായവ പിന്തുണയ്ക്കുന്നു.', uploadStep1: '1. പ്രമാണം അപ്‌ലോഡ് ചെയ്യുക', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR ലഭ്യമാണ്)', browse: 'ഫയലുകൾ തിരഞ്ഞെടുക്കുക', loadDemo: '⚡ മാതൃകാ കരാർ ലോഡ് ചെയ്യുക', uploadStep2: '2. വാചകം ഒട്ടിക്കുക', pastePlaceholder: 'നിയമപരമായ വാചകം ഇവിടെ ഒട്ടിക്കുക...', analyzePasted: 'വിശകലനം ചെയ്യുക', uploadStep3: '3. ലിങ്ക് നൽകുക', linkSub: 'വെബ് ലിങ്ക് ഒട്ടിക്കുക', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'ലിങ്ക് വിശകലനം ചെയ്യുക', docSource: 'പ്രമാണത്തിന്റെ ഉറവിടം:', docTypeLabel: 'പ്രമാണ തരം:', btnAnalyzeDoc: '🚀 വിശകലനം ചെയ്യുക', textFoundLabel: 'കണ്ടെത്തിയ വാചകം:', evidenceTitle: '📋 തെളിവുകളും വിവരങ്ങളും', evidenceSub: 'നിങ്ങളുടെ പ്രമാണങ്ങളും തീയതികളും ഒരു സ്ഥലത്ത് സൂക്ഷിക്കുക.', evidenceAddPlaceholder: 'രസീതോ സന്ദേശമോ ചേർക്കുക...', btnAddEvidence: '➕ തെളിവ് ചേർക്കുക', statusFound: 'തെളിവ് ലഭിച്ചു', statusMissing: 'തെളിവ് ഇല്ല', statusSuggested: 'നിർദ്ദേശിച്ച തെളിവ്', statusVerification: 'പരിശോധന ആവശ്യമാണ്', clarityTitle: 'നിയമ വ്യക്തതയും വിവരങ്ങളും', claritySub: 'സാധാരണ വിവരണം.', showLabel: 'കാണിക്കുക:', lvlSimple: '🙂 ലളിതം', lvlVerySimple: '👶 വളരെ ലളിതം', lvlDetails: '⚖️ നിയമപരമായ വിവരങ്ങൾ', btnReadAloud: '🔊 ഉറക്കെ വായിക്കുക', execSummaryTitle: '📄 പ്രധാന സാരം', execSummaryPlaceholder: 'വിശകലനം ചെയ്യാൻ പ്രമാണം അപ്‌ലോഡ് ചെയ്യുക.', actionUnderstand: '💡 മനസ്സിലാക്കുക', actionUnderstandDesc: 'ലളിതമായ സംഗ്രഹം', actionIdentify: '⚠️ കണ്ടെത്തുക', actionIdentifyDesc: 'തീയതികളും സമയപരിധികളും', actionPrepare: '📝 തയ്യാറെടുക്കുക', actionPrepareDesc: 'വക്കീലിനോട് ചോദിക്കേണ്ട ചോദ്യങ്ങൾ', actionNavigate: '🧭 വഴിനടത്തൽ', actionNavigateDesc: 'അടുത്ത ഘട്ടങ്ങൾ', difficultWordTitle: 'കഠിനമായ വാക്കിന്റെ അർത്ഥമെന്താണ്?', difficultWordSub: 'ഒരു വാക്ക് ടൈപ്പ് ചെയ്യുക.', difficultWordPlaceholder: 'വാക്ക് ടൈപ്പ് ചെയ്യുക', btnExplainWord: 'വിശദീകരിക്കുക', difficultTermModalTitle: 'കഠിനമായ വാക്ക്', simpleMeaningHeader: '💡 ലളിതമായ അർത്ഥം:', everydayExampleHeader: '🌟 ദൈനംദിന ഉദാഹരണം:', askLawyerHeader: '🧑‍⚖️ വക്കീലിനോട് ചോദിക്കുക:', btnGotIt: 'മനസ്സിലായി!', factsTitle: 'പ്രധാന വിവരങ്ങളും തീയതികളും', factsSub: 'തീയതികളുടെയും തുകകളുടെയും പട്ടിക.', keyDatesLabel: 'പ്രധാന തീയതികൾ', amountsLabel: 'സാമ്പത്തിക വിവരങ്ങൾ', partiesLabel: 'ബന്ധപ്പെട്ട വ്യക്തികൾ', obligationsLabel: 'പ്രധാന ചുമതലകൾ', timelineTitle: '📅 സംഭവങ്ങളുടെ സമയരേഖ', applicableLawsTitle: 'ബാധകമായ ഇന്ത്യൻ നിയമങ്ങൾ, വകുപ്പുകൾ, പിഴകൾ & കേസ് കൈകാര്യം ചെയ്യൽ രീതി', applicableLawsSub: 'ബാധകമായ നിയമ വകുപ്പുകൾ (BNS/IPC, വാടക നിയമം, ഉപഭോക്തൃ നിയമം, കരാർ നിയമം), പരമാവധി പിഴകൾ/ശിക്ഷകൾ, ഘട്ടം ഘട്ടമായുള്ള പരാതി രീതികൾ, ഔദ്യോഗിക നിയമ പോർട്ടലുകൾ.'
    },
    te: {
        tagline: 'న్యాయ ప్రాప్యత మరియు కేసు తయారీ వేదిక', demo: 'ఒక క్లిక్ అద్దె ఒప్పందం డెమో', language: 'భాష', deleteAccount: 'ఖాతాను తొలగించు', exit: 'నిష్క్రమించు', activeDocument: 'క్రియాశీల పత్రం', noDocLoaded: 'ఏ పత్రం లోడ్ కాలేదు', pendingUpload: 'అప్‌లోడ్ మిగిలి ఉంది', navHome: 'హోమ్', navMyCase: 'నా కేసు', legalInfoNoticeTitle: '⚠️ న్యాయ సమాచార నోటీసు', legalInfoNoticeDesc: 'LawBuddy AI సహాయం అందిస్తుంది.', privacyBanner: '🔒 గోప్యతా హామీ: అప్‌లోడ్ చేసిన పత్రాలు 3 గంటల్లో స్వయంచాలకంగా తొలగించబడతాయి.', homeHeader: 'మీకు దేనిలో సహాయం కావాలి?', homeSub: 'న్యాయ పత్రాలను అర్థం చేసుకోవడం కష్టం. నేను సులభంగా వివరిస్తాను.', cardExplainDoc: 'నా పత్రాన్ని వివరించండి', cardExplainDocSub: 'ఫైల్ అప్‌లోడ్ చేయండి లేదా లింక్ జోడించండి', cardLegalQuestion: 'నాకు న్యాయపరమైన ప్రశ్న ఉంది', cardLegalQuestionSub: 'ఏమి జరిగిందో మీ మాటల్లో చెప్పండి', cardPhotoNotice: 'నోటీసు ఫోటో తీయండి', cardPhotoNoticeSub: 'మేము చదివి వివరిస్తాము', cardSpeak: 'LawBuddyతో మాట్లాడండి', cardSpeakSub: 'మీ భాషలో మాట్లాడండి', btnMyCase: '📁 నా కేసు', btnBackHome: '← హోమ్', storyTitle: 'ఏమి జరిగింది?', storySub: 'సాధారణ పదాలను ఉపయోగించండి.', storyPlaceholder: 'ఉదాహరణకు: యజమాని నోటీసు ఇచ్చారు.', btnSpeakInstead: '🎤 మాట్లాడండి', btnContinue: 'కొనసాగించండి', listeningText: 'వింటోంది…', uploadTitle: 'న్యాయ పత్రాన్ని అప్‌లోడ్ చేయండి', uploadDescription: 'నోటీసులు, అద్దె ఒప్పందాలు మొదలైనవాటికి మద్దతు ఉంది.', uploadStep1: '1. పత్రాన్ని అప్‌లోడ్ చేయండి', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR లభ్యం)', browse: 'ఫైళ్లను ఎంచుకోండి', loadDemo: '⚡ నమూనా ఒప్పందం డెమో', uploadStep2: '2. పాఠ్యాన్ని అతికించండి', pastePlaceholder: 'న్యాయ పాఠ్యాన్ని ఇక్కడ అతికించండి...', analyzePasted: 'విశ్లేషించండి', uploadStep3: '3. లింక్ నమోదు చేయండి', linkSub: 'వెబ్ లింక్ అతికించండి', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'లింక్ విశ్లేషించండి', docSource: 'పత్ర మూలం:', docTypeLabel: 'పత్ర రకం:', btnAnalyzeDoc: '🚀 విశ్లేషించండి', textFoundLabel: 'కనుగొన్న పాఠ్యం:', evidenceTitle: '📋 ఆధారాలు మరియు వివరాలు', evidenceSub: 'మీ పత్రాలు మరియు తేదీలను ఒకే చోట ఉంచండి.', evidenceAddPlaceholder: 'రశీదు లేదా సందేశాన్ని జోడించండి...', btnAddEvidence: '➕ ఆధారాన్ని జోడించు', statusFound: 'ఆధారం లభించింది', statusMissing: 'ఆధారం లేదు', statusSuggested: 'సూచించిన ఆధారం', statusVerification: 'సరిచూడవలసి ఉంది', clarityTitle: 'న్యాయ స్పష్టత మరియు చర్యల పటం', claritySub: 'సాధారణ సమాచారం.', showLabel: 'చూపించు:', lvlSimple: '🙂 సరళం', lvlVerySimple: '👶 చాలా సరళం', lvlDetails: '⚖️ న్యాయ వివరాలు', btnReadAloud: '🔊 బిగ్గరగా చదవండి', execSummaryTitle: '📄 పత్ర ముఖ్యాంశాలు', execSummaryPlaceholder: 'విశ్లేషణ కోసం పత్రాన్ని అప్‌లోడ్ చేయండి.', actionUnderstand: '💡 అర్థం చేసుకోండి', actionUnderstandDesc: 'సరళమైన సారాంశం', actionIdentify: '⚠️ గుర్తించండి', actionIdentifyDesc: 'తేదీలు మరియు గడువులు', actionPrepare: '📝 సిద్ధం కండి', actionPrepareDesc: 'లాయర్‌ను అడగవలసిన ప్రశ్నలు', actionNavigate: '🧭 మార్గదర్శకం', actionNavigateDesc: 'తరువాతి చర్యలు', difficultWordTitle: 'కష్టమైన పదం అర్థం ఏమిటి?', difficultWordSub: 'ఒక పదాన్ని టైప్ చేయండి.', difficultWordPlaceholder: 'పదాన్ని టైప్ చేయండి', btnExplainWord: 'వివరించు', difficultTermModalTitle: 'కష్టమైన పదం', simpleMeaningHeader: '💡 సరళమైన అర్థం:', everydayExampleHeader: '🌟 రోజువారీ ఉదాహరణ:', askLawyerHeader: '🧑‍⚖️ లాయర్‌ను అడగండి:', btnGotIt: 'అర్థమైంది!', factsTitle: 'ముఖ్యాంశాలు మరియు కాలక్రమం', factsSub: 'తేదీలు మరియు వివరాల జాబితా.', keyDatesLabel: 'ముఖ్యమైన తేదీలు', amountsLabel: 'ఆర్థిక వివరాలు', partiesLabel: 'సంబంధిత వ్యక్తులు', obligationsLabel: 'ముఖ్యమైన బాధ్యతలు', timelineTitle: '📅 సంఘటనల కాలక్రమం', applicableLawsTitle: 'వర్తించే భారతీయ చట్టాలు, చట్టబద్ధమైన సెక్షన్లు, జరిమానాలు & కేసు నిర్వహణ విధానం', applicableLawsSub: 'సంబంధిత చట్టబద్ధమైన సెక్షన్లు (BNS/IPC, అద్దె నియంత్రణ, వినియోగదారుల చట్టం, కాంట్రాక్ట్ చట్టం), గరిష్ట జరిమానాలు/శిక్షలు, దశలవారీ ఫిర్యాదు నిర్వహణ మరియు అధికారిక న్యాయ పోర్టల్‌లు.'
    },
    ta: {
        tagline: 'சட்ட அணுகல் மற்றும் வழக்கு தயாரிப்பு தளம்', demo: 'ஒரு கிளிக் வாடகை ஒப்பந்த டெமோ', language: 'மொழி', deleteAccount: 'கணக்கை நீக்கு', exit: 'வெளியேறு', activeDocument: 'செயலில் உள்ள ஆவணம்', noDocLoaded: 'எந்த ஆவணமும் ஏற்றப்படவில்லை', pendingUpload: 'பதிவேற்றம் நிலுவையில் உள்ளது', navHome: 'முகப்பு', navMyCase: 'என் வழக்கு', navChat: 'வழக்கு AI சாட்பாட்', floatingChatLabel: 'AI சாட்பாட்டிடம் கேளுங்கள்', chatTitle: '💬 வழக்கு AI சாட்பாட்', chatSub: 'உங்கள் ஆவணம் அல்லது வழக்கைப் பற்றி கேள்விகளைக் கேட்கவும். பதில்கள் உங்கள் மொழியில் வழங்கப்படும்.', chatPlaceholder: 'இந்த வழக்கைப் பற்றி உங்கள் கேள்வியைத் தட்டச்சு செய்யவும் அல்லது பேசவும்...', chatSend: 'அனுப்பு 📤', chatSpeak: '🎤 பேசுங்கள்', chatClear: '🗑️ உரையாடலை அழி', chatWelcome: 'வணக்கம்! உங்கள் வழக்கு அல்லது ஆவணத்தைப் பற்றி உங்கள் மொழியில் கேள்வி கேட்கவும்.', chatSuggestionsTitle: '💡 இந்த வழக்கிற்கான பரிந்துரைக்கப்பட்ட கேள்விகள்:', chipNotice: '📌 அறிவிப்பு காலம்?', chipRent: '📌 வாடகை / தொகை?', chipObligations: '📌 முக்கிய கடமைகள்?', chipPenalties: '📌 அபராதங்கள் & சட்டங்கள்?', legalInfoNoticeTitle: '⚠️ சட்ட தகவல் அறிவிப்பு', legalInfoNoticeDesc: 'LawBuddy AI தயாரிப்பு உதவி வழங்குகிறது.', privacyBanner: '🔒 தனியுரிமை உறுதி: பதிவேற்றப்பட்ட ஆவணங்கள் 3 மணி நேரத்திற்குள் தானாகவே நீக்கப்படும்.', homeHeader: 'உங்களுக்கு என்ன உதவி வேண்டும்?', homeSub: 'சட்ட ஆவணங்களைப் புரிந்துகொள்வது கடினம். நான் எளிமையாக விளக்குகிறேன்.', cardExplainDoc: 'என் ஆவணத்தை விளக்குங்கள்', cardExplainDocSub: 'கோப்பைப் பதிவேற்றவும் அல்லது இணைப்பைச் சேர்க்கவும்', cardLegalQuestion: 'எனக்கு ஒரு சட்டக் கேள்வி உள்ளது', cardLegalQuestionSub: 'என்ன நடந்தது என்று உங்கள் சொந்த வார்த்தைகளில் கூறுங்கள்', cardPhotoNotice: 'நோட்டீஸை படம் எடுங்கள்', cardPhotoNoticeSub: 'நாங்கள் அதைப் படித்து விளக்குவோம்', cardSpeak: 'LawBuddy உடன் பேசுங்கள்', cardSpeakSub: 'உங்கள் மொழியில் பேசுங்கள்', btnMyCase: '📁 என் வழக்கு', btnBackHome: '← முகப்பு', storyTitle: 'என்ன நடந்தது?', storySub: 'சாதாரண வார்த்தைகளைப் பயன்படுத்துங்கள்.', storyPlaceholder: 'உதாரணமாக: வீட்டு உரிமையாளர் நோட்டீஸ் கொடுத்துள்ளார்.', btnSpeakInstead: '🎤 பேசுங்கள்', btnContinue: 'தொடரவும்', listeningText: 'கேட்கிறது…', uploadTitle: 'சட்ட ஆவணத்தைப் பதிவேற்றவும்', uploadDescription: 'நோட்டீஸ்கள், வாடகை ஒப்பந்தங்கள் போன்றவற்றுக்கு ஆதரவு உண்டு.', uploadStep1: '1. ஆவணத்தைப் பதிவேற்றவும்', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR ஆதரவு உண்டு)', browse: 'கோப்புகளைத் தேர்ந்தெடுக்கவும்', loadDemo: '⚡ மாதிரி ஒப்பந்த டெமோ', uploadStep2: '2. உரையை ஒட்டவும்', pastePlaceholder: 'சட்ட உரையை இங்கே ஒட்டவும்...', analyzePasted: 'பகுப்பாய்வு செய்', uploadStep3: '3. இணைப்பை உள்ளிடவும்', linkSub: 'இணைப்பை ஒட்டவும்', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'இணைப்பைப் பகுப்பாய்வு செய்', docSource: 'ஆவண மூலம்:', docTypeLabel: 'ஆவண வகை:', btnAnalyzeDoc: '🚀 பகுப்பாய்வு செய்', textFoundLabel: 'கண்டறியப்பட்ட உரை:', evidenceTitle: '📋 சான்றுகள் மற்றும் விவரங்கள்', evidenceSub: 'உங்கள் ஆவணங்களையும் தேதிகளையும் ஒரே இடத்தில் வைக்கவும்.', evidenceAddPlaceholder: 'ரசீது அல்லது செய்தியைச் சேர்க்கவும்...', btnAddEvidence: '➕ சான்றைச் சேர்', statusFound: 'சான்று கிடைத்தது', statusMissing: 'சான்று இல்லை', statusSuggested: 'பரிந்துரைக்கப்பட்ட சான்று', statusVerification: 'சரிபார்ப்பு தேவை', clarityTitle: 'சட்ட தெளிவு மற்றும் செயல்பாட்டு வரைபடம்', claritySub: 'பொதுவான தகவல்.', showLabel: 'காட்டு:', lvlSimple: '🙂 எளிமையானது', lvlVerySimple: '👶 மிகவும் எளிமையானது', lvlDetails: '⚖️ சட்ட விவரங்கள்', btnReadAloud: '🔊 சத்தமாகப் படி', execSummaryTitle: '📄 ஆவணத்தின் முக்கிய சுருக்கம்', execSummaryPlaceholder: 'பகுப்பாய்வு செய்ய ஆவணத்தைப் பதிவேற்றவும்.', actionUnderstand: '💡 புரிந்துகொள்ளுங்கள்', actionUnderstandDesc: 'எளிமையான சுருக்கம்', actionIdentify: '⚠️ அடையாளம் காணுங்கள்', actionIdentifyDesc: 'கெடு தேதிகள் மற்றும் பொறுப்புகள்', actionPrepare: '📝 தயாராகுங்கள்', actionPrepareDesc: 'வழக்கறிஞரிடம் கேட்க வேண்டிய கேள்விகள்', actionNavigate: '🧭 வழிகாட்டுதல்', actionNavigateDesc: 'அடுத்த கட்ட நடவடிக்கைகள்', difficultWordTitle: 'கடினமான வார்த்தையின் பொருள் என்ன?', difficultWordSub: 'ஒரு வார்த்தையை தட்டச்சு செய்யவும்.', difficultWordPlaceholder: 'வார்த்தையை தட்டச்சு செய்', btnExplainWord: 'விளக்கு', difficultTermModalTitle: 'கடினமான வார்த்தை', simpleMeaningHeader: '💡 எளிய பொருள்:', everydayExampleHeader: '🌟 அன்றாட உதாரணம்:', askLawyerHeader: '🧑‍⚖️ வழக்கறிஞரிடம் கேளுங்கள்:', btnGotIt: 'புரிந்தது!', factsTitle: 'முக்கிய விவரங்கள் மற்றும் காலவரிசை', factsSub: 'தேதிகள் மற்றும் தொகைகளின் பட்டியல்.', keyDatesLabel: 'முக்கிய தேதிகள்', amountsLabel: 'நிதி விவரங்கள்', partiesLabel: 'தொடர்புடைய நபர்கள்', obligationsLabel: 'முக்கிய கடமைகள்', timelineTitle: '📅 நிகழ்வுகளின் காலவரிசை', applicableLawsTitle: 'பொருந்தக்கூடிய இந்தியச் சட்டங்கள், பிரிவுகள், அபராதங்கள் & வழக்கு கையாளும் நடைமுறை', applicableLawsSub: 'பொருந்தக்கூடிய சட்டப் பிரிவுகள் (BNS/IPC, வாடகை கட்டுப்பாடு, நுகர்வோர் சட்டம், ஒப்பந்தச் சட்டம்), அதிகபட்ச அபராதங்கள்/தண்டனைகள், படி-படியாக புகார் கையாளும் முறை, ಅಧಿಕೃತ சட்ட இணையதளங்கள்.'
    },
    mr: {
        tagline: 'कायदेशीर प्रवेश आणि केस तयारी मंच', demo: 'एक क्लिक नमुना करार डेमो', language: 'भाषा', deleteAccount: 'खाते हटवा', exit: 'बाहेर पडा', activeDocument: 'सक्रिय दस्तऐवज', noDocLoaded: 'कोणताही दस्तऐवज लोड केलेला नाही', pendingUpload: 'अपलोड प्रलंबित', navHome: 'मुख्यपृष्ठ', navMyCase: 'माझी केस', navChat: 'केस AI चॅटबॉट', floatingChatLabel: 'AI चॅटबॉटला विचारा', chatTitle: '💬 केस AI चॅटबॉट', chatSub: 'तुमच्या केसबद्दल किंवा दस्तऐवजाबद्दल प्रश्न विचारा. उत्तरे तुमच्या निवडलेल्या भाषेत असतील.', chatPlaceholder: 'या केसबद्दल तुमचा प्रश्न टाइप करा किंवा बोला...', chatSend: 'पाठवा 📤', chatSpeak: '🎤 बोला', chatClear: '🗑️ चॅट साफ करा', chatWelcome: 'नमस्कार! तुमच्या केसबद्दल किंवा कागदपत्राबद्दल तुमच्या भाषेत कोणताही प्रश्न विचारा.', chatSuggestionsTitle: '💡 या केससाठी सुचवलेले प्रश्न:', chipNotice: '📌 नोटीस कालावधी?', chipRent: '📌 भाडे / रक्कम?', chipObligations: '📌 मुख्य जबाबदाऱ्या?', chipPenalties: '📌 दंड आणि कायदे?', legalInfoNoticeTitle: '⚠️ कायदेशीर माहिती सूचना', legalInfoNoticeDesc: 'LawBuddy AI तयारीसाठी मदत करते.', privacyBanner: '🔒 गोपनीयता हमी: अपलोड केलेले दस्तऐवज 3 तासांच्या आत हटवले जातात.', homeHeader: 'तुम्हाला कशात मदत हवी आहे?', homeSub: 'कायदेशीर कागदपत्रे समजणे कठीण असते. मी समजावून सांगतो.', cardExplainDoc: 'माझे कागदपत्र समजावून सांगा', cardExplainDocSub: 'फाइल अपलोड करा किंवा लिंक जोडा', cardLegalQuestion: 'माझा कायदेशीर प्रश्न आहे', cardLegalQuestionSub: 'काय घडले ते तुमच्या शब्दांत सांगा', cardPhotoNotice: 'नोटीसचा फोटो घ्या', cardPhotoNoticeSub: 'आम्ही वाचून समजावून सांगू', cardSpeak: 'LawBuddy शी बोला', cardSpeakSub: 'तुमच्या भाषेत बोला', btnMyCase: '📁 माझी केस', btnBackHome: '← मुख्यपृष्ठ', storyTitle: 'काय घडले होते?', storySub: 'सामान्य शब्दांचा वापर करा.', storyPlaceholder: 'उदाहरणार्थ: घरमालकाने नोटीस दिली आहे.', btnSpeakInstead: '🎤 बोला', btnContinue: 'पुढे जा', listeningText: 'ऐकत आहे…', uploadTitle: 'कायदेशीर दस्तऐवज अपलोड करा', uploadDescription: 'नोटीस, भाडे करार इत्यादींना पाठिंबा आहे.', uploadStep1: '1. दस्तऐवज अपलोड करा', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR उपलब्ध)', browse: 'फाइली निवडा', loadDemo: '⚡ नमुना करार डेमो', uploadStep2: '2. मजकूर पेस्ट करा', pastePlaceholder: 'कायदेशीर मजकूर येथे पेस्ट करा...', analyzePasted: 'विश्लेषण करा', uploadStep3: '3. लिंक टाका', linkSub: 'वेब लिंक पेस्ट करा', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'विश्लेषण करा', docSource: 'स्रोत:', docTypeLabel: 'प्रकार:', btnAnalyzeDoc: '🚀 विश्लेषण करा', textFoundLabel: 'मजकूर:', evidenceTitle: '📋 पुरावे आणि तपशील', evidenceSub: 'तुमची कागदपत्रे एका ठिकाणी ठेवा.', evidenceAddPlaceholder: 'पावती किंवा संदेश जोडा...', btnAddEvidence: '➕ पुरावा जोडा', statusFound: 'पुरावा मिळाला', statusMissing: 'पुरावा नाही', statusSuggested: 'सुचवलेला पुरावा', statusVerification: 'सत्यापन आवश्यक', clarityTitle: 'कायदेशीर स्पष्टता आणि कृती नकाशा', claritySub: 'सामान्य माहिती.', showLabel: 'दाखवा:', lvlSimple: '🙂 सोपे', lvlVerySimple: '👶 अत्यंत सोपे', lvlDetails: '⚖️ कायदेशीर तपशील', btnReadAloud: '🔊 मोठ्याने वाचा', execSummaryTitle: '📄 मुख्य सारांश', execSummaryPlaceholder: 'दस्तऐवज अपलोड करा.', actionUnderstand: '💡 समजून घ्या', actionUnderstandDesc: 'सोपा सारांश', actionIdentify: '⚠️ ओळखा', actionIdentifyDesc: 'तारखा आणि मुदत', actionPrepare: '📝 तयारी करा', actionPrepareDesc: 'वकिलांना विचारायचे प्रश्न', actionNavigate: '🧭 मार्गदर्शन', actionNavigateDesc: 'पुढील पायऱ्या', difficultWordTitle: 'कठीण शब्दाचा अर्थ काय?', difficultWordSub: 'शब्द टाईप करा.', difficultWordPlaceholder: 'शब्द टाईप करा', btnExplainWord: 'स्पष्टीकरण द्या', difficultTermModalTitle: 'कठीण शब्द', simpleMeaningHeader: '💡 सोपा अर्थ:', everydayExampleHeader: '🌟 दैनंदिन उदाहरण:', askLawyerHeader: '🧑‍⚖️ वकिलांना विचारायचा प्रश्न:', btnGotIt: 'समजले!', factsTitle: 'महत्त्वाचे मुद्दे आणि कालक्रम', factsSub: 'तारखांची यादी.', keyDatesLabel: 'महत्त्वाच्या तारखा', amountsLabel: 'आर्थिक तपशील', partiesLabel: 'संबंधित व्यक्ती', obligationsLabel: 'मुख्य जबाबदाऱ्या', timelineTitle: '📅 घटनांचा कालक्रम', applicableLawsTitle: 'लागू भारतीय कायदे, वैधानिक कलमे, दंड आणि केस हाताळणी प्रक्रिया', applicableLawsSub: 'संबंधित वैधानिक कलमे (BNS/IPC, भाडे नियंत्रण, ग्राहक कायदा, कंत्राट कायदा), कमाल दंड/शिक्षा, टप्प्याटप्प्याने तक्रार हाताळणी आणि अधिकृत कायदेशीर पोर्टल.'
    },
    gu: {
        tagline: 'કાનૂની ઍક્સેસ અને કેસ તૈયારી પ્લેટફોર્મ', demo: 'એક કાનૂની ભાડા કરાર ડેમો', language: 'ભાષા', deleteAccount: 'એકાઉન્ટ કાઢી નાખો', exit: 'બહાર નીકળો', activeDocument: 'સક્રિય દસ્તાવેજ', noDocLoaded: 'કોઈ દસ્તાવેજ લોડ નથી', pendingUpload: 'અપલોડ બાકી', navHome: 'હોમ', navMyCase: 'મારો કેસ', navChat: 'કેસ AI ચેટબોટ', floatingChatLabel: 'AI ચેટબોટને પૂછો', chatTitle: '💬 કેસ AI ચેટબોટ', chatSub: 'તમારા દસ્તાવેજ અથવા કેસ વિશે પ્રશ્નો પૂછો. જવાબો તમારી પસંદ કરેલી ભાષામાં હશે.', chatPlaceholder: 'આ કેસ વિશે તમારો પ્રશ્ન ટાઇપ કરો અથવા બોલો...', chatSend: 'મોકલો 📤', chatSpeak: '🎤 બોલો', chatClear: '🗑️ ચેટ ક્લિયર કરો', chatWelcome: 'નમસ્તે! તમારા કેસ અથવા દસ્તાવેજ વિશે તમારી ભાષામાં કોઈપણ પ્રશ્ન પૂછો.', chatSuggestionsTitle: '💡 આ કેસ માટે સૂચવેલ પ્રશ્નો:', chipNotice: '📌 નોટિસ સમયગાળો?', chipRent: '📌 ભાડું / રકમ?', chipObligations: '📌 મુખ્ય જવાબદારીઓ?', chipPenalties: '📌 દંડ અને કાયદા?', legalInfoNoticeTitle: '⚠️ કાનૂની માહિતી સૂચના', legalInfoNoticeDesc: 'LawBuddy AI તૈયારી માટે મદદ કરે છે.', privacyBanner: '🔒 ગોપનીયતા ગેરેંટી: અપલોડ કરેલા દસ્તાવેજો 3 કલાકમાં કાઢી નાખવામાં આવે છે.', homeHeader: 'તમને શેમાં મદદ જોઈએ છે?', homeSub: 'કાનૂની દસ્તાવેજો સમજવા મુશ્કેલ હોય છે. હું સરળતાથી સમજાવીશ.', cardExplainDoc: 'મારો દસ્તાવેજ સમજાવો', cardExplainDocSub: 'ફાઇલ અપલોড કરો અથવા લિંક ઉમેરો', cardLegalQuestion: 'મારો કાનૂની પ્રશ્ન છે', cardLegalQuestionSub: 'શું થયું તે તમારા શબ્દોમાં કહો', cardPhotoNotice: 'નોટિસનો ફોટો લો', cardPhotoNoticeSub: 'અમે વાંચીને સમજાવીશું', cardSpeak: 'LawBuddy સાથે વાત કરો', cardSpeakSub: 'તમારી ભાષામાં બોલો', btnMyCase: '📁 મારો કેસ', btnBackHome: '← હોમ', storyTitle: 'શું થયું હતું?', storySub: 'સામાન્ય શબ્દોનો ઉપયોગ કરો.', storyPlaceholder: 'ઉદાહરણ તરીકે: મકાનમાલિકે નોટિસ આપી છે.', btnSpeakInstead: '🎤 બોલો', btnContinue: 'આગળ વધો', listeningText: 'સાંભળી રહ્યા છીએ…', uploadTitle: 'કાનૂની દસ્તાવેજ અપલોડ કરો', uploadDescription: 'નોટિસ, કરાર વગેરેને સપોર્ટ કરે છે.', uploadStep1: '1. દસ્તાવેજ અપલોડ કરો', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR ઉપલબ્ધ)', browse: 'ફાઇલો પસંદ કરો', loadDemo: '⚡ નમૂના કરાર ડેમો', uploadStep2: '2. લખાણ પેસ્ટ કરો', pastePlaceholder: 'કાનૂની લખાણ અહીં પેસ્ટ કરો...', analyzePasted: 'વિશ્લેષણ કરો', uploadStep3: '3. લિંક દાખલ કરો', linkSub: 'વેબ લિંક પેસ્ટ કરો', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'વિશ્લેષણ કરો', docSource: 'સ્ત્રોત:', docTypeLabel: 'પ્રકાર:', btnAnalyzeDoc: '🚀 વિશ્લેષણ કરો', textFoundLabel: 'મળે લખાણ:', evidenceTitle: '📋 પુરાવા અને વિગતો', evidenceSub: 'તમારા દસ્તાવેજો એક જગ્યાએ રાખો.', evidenceAddPlaceholder: 'રસીદ અથવા સંદેશ ઉમેરો...', btnAddEvidence: '➕ પુરાવો ઉમેરો', statusFound: 'પુરાવો મળ્યો', statusMissing: 'પુરાવો નથી', statusSuggested: 'સૂચવેલ પુરાવો', statusVerification: 'ચકાસણી જરૂરી', clarityTitle: 'કાનૂની સ્પષ્ટતા અને નકશો', claritySub: 'સામાન્ય માહિતી.', showLabel: 'બતાવો:', lvlSimple: '🙂 સરળ', lvlVerySimple: '👶 ખૂબ સરળ', lvlDetails: '⚖️ કાનૂની વિગતો', btnReadAloud: '🔊 મોટેથી વાંચો', execSummaryTitle: '📄 મુખ્ય સારાંશ', execSummaryPlaceholder: 'દસ્તાવેજ અપલોડ કરો.', actionUnderstand: '💡 સમજો', actionUnderstandDesc: 'સરળ સારાંશ', actionIdentify: '⚠️ ઓળખો', actionIdentifyDesc: 'તારીખો અને મુદત', actionPrepare: '📝 તૈયારી કરો', actionPrepareDesc: 'વકીલને પૂછવાના પ્રશ્નો', actionNavigate: '🧭 માર્ગદર્શન', actionNavigateDesc: 'આગળના પગલાં', difficultWordTitle: 'અઘરા શબ્દનો અર્થ શું છે?', difficultWordSub: 'શબ્દ ટાઇપ કરો.', difficultWordPlaceholder: 'શબ્દ ટાઇપ કરો', btnExplainWord: 'સ્પષ્ટતા કરો', difficultTermModalTitle: 'અઘરો શબ્દ', simpleMeaningHeader: '💡 સરળ અર્થ:', everydayExampleHeader: '🌟 દૈનિક ઉદાહરણ:', askLawyerHeader: '🧑‍⚖️ વકીલને પૂછો:', btnGotIt: 'સમજાઈ ગયું!', factsTitle: 'મુખ્ય તથ્યો અને સમયરેખા', factsSub: 'તારીખોની યાદી.', keyDatesLabel: 'મુખ્ય તારીખો', amountsLabel: 'નાણાકીય વિગતો', partiesLabel: 'સંબંધિત વ્યક્તિઓ', obligationsLabel: 'મુખ્ય જવાબદારીઓ', timelineTitle: '📅 ઘટનાઓની સમયરેખા', applicableLawsTitle: 'લાગુ પડતા ભારતીય કાયદા, વૈધાનિક કલમો, દંડ અને કેસ હેન્ડલિંગ પ્રક્રિયા', applicableLawsSub: 'સંબંધિત વૈધાનિક કલમો (BNS/IPC, ભાડા નિયંત્રણ, ગ્રાહક કાયદો, કરાર કાયદો), મહત્તમ દંડ/સજા, સ્ટેપ-બાય-સ્ટેપ ફરિયાદ પ્રક્રિયા અને સત્તાવાર કાનૂની પોર્ટલ.'
    },
    bn: {
        tagline: 'আইনি প্রবেশাধিকার ও মামলা প্রস্তুতির প্ল্যাটফর্ম', demo: 'এক ক্লিকে চুক্তি ডেমো', language: 'ভাষা', deleteAccount: 'অ্যাকাউন্ট মুছুন', exit: 'প্রস্থান', activeDocument: 'সক্রিয় নথি', noDocLoaded: 'কোনো নথি লোড করা হয়নি', pendingUpload: 'আপলোড মুলতুবি', navHome: 'হোম', navMyCase: 'আমার কেস', navChat: 'কেস AI চ্যাটবট', floatingChatLabel: 'AI চ্যাটবটকে জিজ্ঞাসা করুন', chatTitle: '💬 কেস AI চ্যাটবট', chatSub: 'আপনার আপলোড করা নথি বা কেস সম্পর্কে প্রশ্ন জিজ্ঞাসা করুন। উত্তরগুলি আপনার নির্বাচিত ভাষায় হবে।', chatPlaceholder: 'এই কেস সম্পর্কে আপনার প্রশ্ন টাইপ করুন বা বলুন...', chatSend: 'পাঠান 📤', chatSpeak: '🎤 বলুন', chatClear: '🗑️ চ্যাট মুছে ফেলুন', chatWelcome: 'হ্যালো! আপনার কেস বা আপলোড করা নথি সম্পর্কে যেকোনো প্রশ্ন আপনার পছন্দসই ভাষায় জিজ্ঞাসা করুন।', chatSuggestionsTitle: '💡 এই কেসের জন্য প্রস্তাবিত প্রশ্নাবলী:', chipNotice: '📌 নোটিশের সময়কাল?', chipRent: '📌 ভাড়া / পরিমাণ?', chipObligations: '📌 প্রধান দায়িত্বসমূহ?', chipPenalties: '📌 জরিমানা ও আইন?', legalInfoNoticeTitle: '⚠️ আইনি তথ্যের বিজ্ঞপ্তি', legalInfoNoticeDesc: 'LawBuddy AI প্রস্তুতিতে সাহায্য করে।', privacyBanner: '🔒 গোপনীয়তার নিশ্চয়তা: আপলোড করা নথি ৩ ঘণ্টার মধ্যে মুছে ফেলা হয়।', homeHeader: 'আপনার কিসে সাহায্য প্রয়োজন?', homeSub: 'আইনি নথি বোঝা কঠিন হতে পারে। আমি সহজভাবে বুঝিয়ে দেব।', cardExplainDoc: 'আমার নথি ব্যাখ্যা করুন', cardExplainDocSub: 'ফাইল আপলোড করুন বা লিংক যোগ করুন', cardLegalQuestion: 'আমার একটি আইনি প্রশ্ন আছে', cardLegalQuestionSub: 'কী ঘটেছে তা নিজের ভাষায় বলুন', cardPhotoNotice: 'নোটিশের ছবি তুলুন', cardPhotoNoticeSub: 'আমরা পড়ে বুঝিয়ে দেব', cardSpeak: 'LawBuddy-র সাথে কথা বলুন', cardSpeakSub: 'আপনার ভাষায় কথা বলুন', btnMyCase: '📁 আমার কেস', btnBackHome: '← হোম', storyTitle: 'কী ঘটেছিল?', storySub: 'সাধারণ শব্দ ব্যবহার করুন।', storyPlaceholder: 'উদাহরণস্বরূপ: বাড়িওয়ালা নোটিশ দিয়েছেন।', btnSpeakInstead: '🎤 কথা বলুন', btnContinue: 'এগিয়ে যান', listeningText: 'শুনছি…', uploadTitle: 'আইনি নথি আপলোড করুন', uploadDescription: 'নোটিশ, চুক্তি ইত্যাদিতে সমর্থন করে।', uploadStep1: '1. নথি আপলোড করুন', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR সমর্থিত)', browse: 'ফাইল নির্বাচন করুন', loadDemo: '⚡ নমুনা চুক্তি লোড করুন', uploadStep2: '2. লেখা পেস্ট করুন', pastePlaceholder: 'আইনি লেখা এখানে পেস্ট করুন...', analyzePasted: 'বিশ্লেষণ করুন', uploadStep3: '3. লিংক দিন', linkSub: 'ওয়েব লিংক পেস্ট করুন', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'বিশ্লেষণ করুন', docSource: 'উৎস:', docTypeLabel: 'প্রকার:', btnAnalyzeDoc: '🚀 বিশ্লেষণ করুন', textFoundLabel: 'প্রাপ্ত লেখা:', evidenceTitle: '📋 প্রমাণ ও বিস্তারিত', evidenceSub: 'আপনার নথি এক জায়গায় রাখুন।', evidenceAddPlaceholder: 'রসিদ বা বার্তা যোগ করুন...', btnAddEvidence: '➕ প্রমাণ যোগ করুন', statusFound: 'প্রমাণ পাওয়া গেছে', statusMissing: 'প্রমাণ নেই', statusSuggested: 'প্রস্তাবিত প্রমাণ', statusVerification: 'যাচাই প্রয়োজন', clarityTitle: 'আইনি স্পষ্টতা ও অ্যাকশন ম্যাপ', claritySub: 'সাধারণ তথ্য।', showLabel: 'দেখান:', lvlSimple: '🙂 সহজ', lvlVerySimple: '👶 অত্যন্ত সহজ', lvlDetails: '⚖️ আইনি বিবরণ', btnReadAloud: '🔊 জোরে পড়ুন', execSummaryTitle: '📄 মূল সারাংশ', execSummaryPlaceholder: 'নথি আপলোড করুন।', actionUnderstand: '💡 বুঝুন', actionUnderstandDesc: 'সহজ সারাংশ', actionIdentify: '⚠️ চিহ্নিত করুন', actionIdentifyDesc: 'তারিখ ও সময়সীমা', actionPrepare: '📝 প্রস্তুত হন', actionPrepareDesc: 'উকিলকে জিজ্ঞাসা করার প্রশ্নাবলী', actionNavigate: '🧭 দিকনির্নির্দেশনা', actionNavigateDesc: 'পরবর্তী পদক্ষেপ', difficultWordTitle: 'কঠিন শব্দের অর্থ কী?', difficultWordSub: 'একটি শব্দ টাইপ করুন।', difficultWordPlaceholder: 'শব্দ টাইপ করুন', btnExplainWord: 'ব্যাখ্যা করুন', difficultTermModalTitle: 'কঠিন শব্দ', simpleMeaningHeader: '💡 সহজ অর্থ:', everydayExampleHeader: '🌟 দৈনিক উদাহরণ:', askLawyerHeader: '🧑‍⚖️ উকিলকে জিজ্ঞাসা করুন:', btnGotIt: 'বুঝেছি!', factsTitle: 'মূল তথ্য ও ঘটনাক্রম', factsSub: 'তারিখের তালিকা।', keyDatesLabel: 'মূল তারিখ', amountsLabel: 'আর্থিক তথ্য', partiesLabel: 'সংশ্লিষ্ট ব্যক্তি', obligationsLabel: 'মূল দায়িত্ব', timelineTitle: '📅 ঘটনাক্রম', applicableLawsTitle: 'প্রযোজ্য ভারতীয় আইন, সংবিধিবদ্ধ ধারা, জরিমানা ও মামলা পরিচালনার পদ্ধতি', applicableLawsSub: 'প্রাসঙ্গিক ধারা (BNS/IPC, ভাড়া নিয়ন্ত্রণ, ভোক্তা আইন, চুক্তি আইন), সর্বোচ্চ জরিমানা/শাস্তি, ধাপে ধাপে অভিযোগ প্রক্রিয়া এবং অফিসিয়াল আইনি পোর্টাল।'
    }
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
    document.documentElement.lang = language;

    if (window.appState.analysisData) {
        renderCaseReadiness(window.appState.analysisData);
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

    loadUserCasesList();
    
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
        renderApplicableLaws(data.applicable_laws_and_sections);
        renderClauseRisks(data.clauses_and_risks);
        renderFactsAndTimeline(data);
        renderCaseReadiness(data);
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

function renderCaseReadiness(data) {
    const container = document.getElementById('caseReadiness');
    if (!container) return;
    const dates = data.important_dates_and_amounts || [];
    const checklist = data.action_map?.prepare?.checklist_to_collect || [];
    const questions = data.action_map?.prepare?.questions_for_lawyer || [];
    const lang = window.appState ? (window.appState.selectedLanguage || 'en') : 'en';

    const READINESS_LABELS = {
        kn: { title: "ನೀವು ಸಿದ್ಧರಾಗಿದ್ದೀರಾ?", desc: "ವಕೀಲರ ಚರ್ಚೆಗೆ ಬೇಕಾದ ಪ್ರಮುಖ ಮಾಹಿತಿಯನ್ನು ಇಲ್ಲಿದೆ.", docs: "📄 ದಾಖಲೆಗಳು", dates: "🕐 ಪ್ರಮುಖ ದಿನಾಂಕಗಳು", items: "📋 ಸಿದ್ಧವಾಗಿಟ್ಟುಕೊಳ್ಳಬೇಕಾದ ಅಂಶಗಳು", q: "❓ ವಕೀಲರ ಪ್ರಶ್ನೆಗಳು", ready: "ಸಿದ್ಧವಾಗಿದೆ", missing: "ಲಭ್ಯವಿಲ್ಲ" },
        hi: { title: "क्या आप तैयार हैं?", desc: "वकील परामर्श के लिए आवश्यक जानकारी यहाँ उपलब्ध है।", docs: "📄 दस्तावेज़", dates: "🕐 महत्वपूर्ण तिथियां", items: "📋 तैयार रखने योग्य वस्तुएं", q: "❓ वकील के प्रश्न", ready: "तैयार है", missing: "अनुपलब्ध" },
        te: { title: "మీరు సిద్ధంగా ఉన్నారా?", desc: "లాయర్ సంప్రదింపులకు అవసరమైన సమాచారం ఇక్కడ ఉంది.", docs: "📄 పత్రాలు", dates: "🕐 ముఖ్యమైన తేదీలు", items: "📋 సిద్ధంగా ఉంచుకోవలసినవి", q: "❓ లాయర్ ప్రశ్నలు", ready: "సిద్ధంగా ఉంది", missing: "లేవు" },
        ta: { title: "நீங்கள் தயாராக இருக்கிறீர்களா?", desc: "வழக்கறிஞர் ஆலோசனைக்கு தேவையான விவரங்கள் இங்கே.", docs: "📄 ஆவணங்கள்", dates: "🕐 முக்கிய தேதிகள்", items: "📋 தயார் செய்ய வேண்டியவை", q: "❓ வழக்கறிஞர் கேள்விகள்", ready: "தயாராக உள்ளது", missing: "இல்லை" },
        ml: { title: "നിങ്ങൾ തയ്യാറാണോ?", desc: "വക്കീൽ കൂടിയാലോചനയ്ക്ക് ആവശ്യമായ വിവരങ്ങൾ ഇവിടെയുണ്ട്.", docs: "📄 പ്രമാണങ്ങൾ", dates: "🕐 പ്രധാന തീയതികൾ", items: "📋 തയ്യാറാക്കി വെക്കേണ്ട കാര്യങ്ങൾ", q: "❓ വക്കീൽ ചോദ്യങ്ങൾ", ready: "സജ്ജമാണ്", missing: "ഇല്ല" },
        mr: { title: "तुम्ही तयार आहात का?", desc: "वकील सल्ल्यासाठी आवश्यक माहिती येथे उपलब्ध आहे.", docs: "📄 दस्तऐवज", dates: "🕐 महत्त्वाच्या तारखा", items: "📋 तयार ठेवण्याच्या गोष्टी", q: "❓ वकिलांचे प्रश्न", ready: "तयार आहे", missing: "नाही" },
        bn: { title: "আপনি কি প্রস্তুত?", desc: "উকিলের সাথে পরামর্শের জন্য প্রয়োজনীয় তথ্য নিচে দেওয়া হলো।", docs: "📄 নথি", dates: "🕐 গুরুত্বপূর্ণ তারিখ", items: "📋 প্রস্তুত রাখার জিনিসপত্র", q: "❓ উকিলের প্রশ্নাবলী", ready: "প্রস্তুত", missing: "অনুপস্থিত" },
        gu: { title: "શું તમે તૈયાર છો?", desc: "વકીલની સલાહ માટે જરૂરી માહિતી અહીં ઉપલબ્ધ છે.", docs: "📄 દસ્તાવેજો", dates: "🕐 મહત્વપૂર્ણ તારીખો", items: "📋 તૈયાર રાખવાની બાબતો", q: "❓ વકીલના પ્રશ્નો", ready: "તૈયાર છે", missing: "અનુપલબ્ધ" },
        en: { title: "Are you prepared?", desc: "You're almost ready for a lawyer consultation. Here is what to keep in one place.", docs: "📄 Documents", dates: "🕐 Important dates", items: "📋 Things to keep ready", q: "❓ Questions for lawyer", ready: "Ready to check", missing: "Missing" }
    };

    const L = READINESS_LABELS[lang] || READINESS_LABELS['en'];

    container.innerHTML = `
        <h3>${L.title}</h3>
        <p>${L.desc}</p>
        <div class="readiness-grid">
            <div><strong>${L.docs}</strong><span>${checklist.length ? L.ready : L.missing}</span></div>
            <div><strong>${L.dates}</strong><span>${dates.length ? L.ready : L.missing}</span></div>
            <div><strong>${L.items}</strong><span>${checklist.length ? L.ready : L.missing}</span></div>
            <div><strong>${L.q}</strong><span>${questions.length ? L.ready : L.missing}</span></div>
        </div>`;
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

// Render Applicable Indian Laws, Statutory Sections, Penalties & Case Procedure
function renderApplicableLaws(laws) {
    const container = document.getElementById('applicableLawsContainer');
    if (!container) return;

    const lang = window.appState ? (window.appState.selectedLanguage || 'en') : 'en';
    const APPLICABLE_LAWS_LABELS = {
        en: { casePortal: "🔗 Case Portal", penaltyLabel: "🚨 Penalty / Imprisonment / Statutory Fine:", handlingLabel: "📋 How to Handle Case & Step-by-Step Procedure:", noLawsExtracted: "No specific statutory laws identified for this document." },
        kn: { casePortal: "🔗 ಪ್ರಕರಣ ಪೋರ್ಟಲ್", penaltyLabel: "🚨 ದಂಡ / ಜೈಲು ಶಿಕ್ಷೆ / ಶಾಸನಬದ್ಧ ದಂಡ:", handlingLabel: "📋 ಪ್ರಕರಣ ನಿರ್ವಹಣೆ ಮತ್ತು ಹಂತ-ಹಂತದ ವಿಧಾನ:", noLawsExtracted: "ಈ ದಾಖಲೆಗೆ ಯಾವುದೇ ನಿರ್ದಿಷ್ಟ ಶಾಸನಬದ್ಧ ಕಾನೂನುಗಳನ್ನು ಗುರುತಿಸಲಾಗಿಲ್ಲ." },
        hi: { casePortal: "🔗 केस पोर्टल", penaltyLabel: "🚨 दंड / कारावास / वैधानिक जुर्माना:", handlingLabel: "📋 केस कैसे संभालें और चरण-दर-चरण प्रक्रिया:", noLawsExtracted: "इस दस्तावेज़ के लिए कोई विशिष्ट वैधानिक कानून नहीं पाए गए।" },
        ml: { casePortal: "🔗 കേസ് പോർട്ടൽ", penaltyLabel: "🚨 പിഴ / തടവുശിക്ഷ / നിയമപരമായ പിഴ:", handlingLabel: "📋 കേസ് കൈകാര്യം ചെയ്യുന്ന വിധം & ഘട്ടം ഘട്ടമായുള്ള രീതി:", noLawsExtracted: "ഈ പ്രമാണത്തിനായി നിർദ്ദിഷ്ട നിയമങ്ങളൊന്നും തിരിച്ചറിഞ്ഞിട്ടില്ല." },
        te: { casePortal: "🔗 కేసు పోర్టల్", penaltyLabel: "🚨 జరిమానా / జైలు శిక్ష / చట్టబద్ధమైన జరిమానా:", handlingLabel: "📋 కేసును ఎలా నిర్వహించాలి & దశలవారీ విధానం:", noLawsExtracted: "ఈ పత్రం కోసం నిర్దిష్ట చట్టబద్ధమైన చట్టాలు ఏవీ గుర్తించబడలేదు." },
        ta: { casePortal: "🔗 வழக்கு இணையதளம்", penaltyLabel: "🚨 அபராதம் / சிறைத்தண்டனை / சட்டப்பூர்வ அபராதம்:", handlingLabel: "📋 வழக்கை கையாளும் முறை & படி-படியான நடைமுறை:", noLawsExtracted: "இந்த ஆவணத்திற்கு குறிப்பிட்ட சட்டங்கள் எதுவும் கண்டறியப்படவில்லை." },
        mr: { casePortal: "🔗 केस पोर्टल", penaltyLabel: "🚨 दंड / कारावास / वैधानिक दंड:", handlingLabel: "📋 केस कसा हाताळावा आणि टप्प्याटप्प्याने प्रक्रिया:", noLawsExtracted: "या दस्तऐवजासाठी कोणतेही विशिष्ट वैधानिक कायदे आढळले नाहीत." },
        gu: { casePortal: "🔗 કેસ પોર્ટલ", penaltyLabel: "🚨 દંડ / જેલની સજા / વૈધાનિક દંડ:", handlingLabel: "📋 કેસ કેવી રીતે હેન્ડલ કરવો અને સ્ટેપ-બાય-સ્ટેપ પ્રક્રિયા:", noLawsExtracted: "આ દસ્તાવેજ માટે કોઈ વિશિષ્ટ કાયદા મળ્યા નથી." },
        bn: { casePortal: "🔗 মামলা পোর্টাল", penaltyLabel: "🚨 জরিমানা / কারাদণ্ড / সংবিধিবদ্ধ জরিমানা:", handlingLabel: "📋 কীভাবে মামলা পরিচালনা করবেন এবং ধাপে ধাপে পদ্ধতি:", noLawsExtracted: "এই নথির জন্য কোনো নির্দিষ্ট আইন পাওয়া যায়নি।" }
    };
    const L = APPLICABLE_LAWS_LABELS[lang] || APPLICABLE_LAWS_LABELS['en'];

    if (!laws || laws.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>${L.noLawsExtracted}</p></div>`;
        return;
    }

    container.innerHTML = laws.map((l, idx) => {
        const actName = l.act_or_law || 'Indian Statute';
        const section = l.section || 'General Section';
        const title = l.title || 'Legal Right / Remedy';
        const penalty = l.penalty_or_punishment || 'N/A';
        const handling = (l.how_to_handle_case || '').replace(/\n/g, '<br>');
        const portalUrl = l.portal_url || 'https://www.indiacode.nic.in';

        return `
            <div class="scenario-card" style="border-left: 4px solid #0284c7; background: #ffffff; border-radius: 12px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                    <div>
                        <span class="badge-pill bg-info" style="font-size: 12px;">⚖️ ${actName}</span>
                        <h4 style="margin-top: 8px; color: #0f172a; font-size: 15px; font-weight: 700;">${section}: ${title}</h4>
                    </div>
                    <a href="${portalUrl}" target="_blank" rel="noopener noreferrer" class="source-chip" style="font-size: 11px; font-weight: 700; flex-shrink: 0; background: #e0f2fe; color: #0369a1; text-decoration: none; border: 1px solid #38bdf8;">
                        ${L.casePortal}
                    </a>
                </div>

                <div style="margin-top: 12px; padding: 10px; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; font-size: 13px;">
                    <strong style="color: #9f1239;">${L.penaltyLabel}</strong><br>
                    <span style="color: #881337;">${penalty}</span>
                </div>

                <div style="margin-top: 12px; font-size: 13px; color: #334155; line-height: 1.5;">
                    <strong style="color: #0369a1;">${L.handlingLabel}</strong>
                    <div style="margin-top: 6px; padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px;">
                        ${handling}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

// Render Clause & Risk Explorer Cards
function renderClauseRisks(risks) {
    const container = document.getElementById('riskListContainer');
    const lang = window.appState ? (window.appState.selectedLanguage || 'en') : 'en';
    const CLAUSE_RISK_LABELS = {
        en: { originalClause: "Original Clause", explanation: "Plain Language Explanation", whyDeserves: "Why it deserves attention", suggestedQuestion: "Suggested Question for Lawyer", defaultQuestion: "Review clause with legal counsel.", noRisks: "No specific risk clauses flagged." },
        kn: { originalClause: "ಮೂಲ ಷರತ್ತು", explanation: "ಸರಳ ಭಾಷೆಯ ವಿವರಣೆ", whyDeserves: "ಇದು ಏಕೆ ಗಮನಿಸಬೇಕು", suggestedQuestion: "ವಕೀಲರಿಗೆ ಸೂಚಿಸಿದ ಪ್ರಶ್ನೆ", defaultQuestion: "ಕಾನೂನು ಸಲಹೆಗಾರರೊಂದಿಗೆ ಷರತ್ತನ್ನು ಪರಿಶೀಲಿಸಿ.", noRisks: "ಯಾವುದೇ ನಿರ್ದಿಷ್ಟ ಅಪಾಯಕಾರಿ ಷರತ್ತುಗಳನ್ನು ಗುರುತಿಸಲಾಗಿಲ್ಲ." },
        hi: { originalClause: "मूल खंड", explanation: "सरल भाषा में व्याख्या", whyDeserves: "इस पर ध्यान क्यों देना चाहिए", suggestedQuestion: "वकील के लिए सुझाया गया प्रश्न", defaultQuestion: "कानूनी सलाहकार के साथ खंड की समीक्षा करें।", noRisks: "कोई विशिष्ट जोखिम भरा खंड नहीं मिला।" },
        ml: { originalClause: "യഥാർത്ഥ വ്യവസ്ഥ", explanation: "ലളിതമായ ഭാഷാ വിശദീകരണം", whyDeserves: "എന്തുകൊണ്ട് ഇത് ശ്രദ്ധിക്കണം", suggestedQuestion: "വക്കീലിനോട് ചോദിക്കേണ്ട ചോദ്യം", defaultQuestion: "നിയമ ഉപദേശകനുമായി വ്യവസ്ഥ പരിശോധിക്കുക.", noRisks: "പ്രത്യേക അപകടസാധ്യതയുള്ള വ്യവസ്ഥകളൊന്നും കണ്ടെത്തിയിട്ടില്ല." },
        te: { originalClause: "అసలు నిబంధన", explanation: "సులభమైన భాషా వివరణ", whyDeserves: "దీనిపై ఎందుకు దృష్టి పెట్టాలి", suggestedQuestion: "లాయర్ కోసం సూచించిన ప్రశ్న", defaultQuestion: "న్యాయ సలహాదారుతో నిబంధనను సమీక్షించండి.", noRisks: "ఎటువంటి ప్రమాదకర నిబంధనలు గుర్తించబడలేదు." },
        ta: { originalClause: "அசல் விதி", explanation: "எளிய மொழி விளக்கம்", whyDeserves: "ஏன் இதை கவனிக்க வேண்டும்", suggestedQuestion: "வழக்கறிஞரிடம் கேட்க வேண்டிய கேள்வி", defaultQuestion: "சட்ட ஆலோசகருடன் விதியை சரிபார்க்கவும்.", noRisks: "குறிப்பிட்ட அபாய விதிகள் எதுவும் கண்டறியப்படவில்லை." },
        mr: { originalClause: "मूळ अट", explanation: "সোप्या भाषेतील स्पष्टीकरण", whyDeserves: "याकडे का लक्ष दिले पाहिजे", suggestedQuestion: "वकिलासाठी सुचवलेला प्रश्न", defaultQuestion: "कायदेशीर सल्लागारासह अटीचे पुनरावलोकन करा.", noRisks: "कोणतीही धोकादायक अट आढळली नाही." },
        gu: { originalClause: "મૂળ કલમ", explanation: "સરળ ભાષામાં સ્પષ્ટતા", whyDeserves: "આના પર કેમ ધ્યાન આપવું જરૂરી છે", suggestedQuestion: "વકીલ માટે સૂચવેલ પ્રશ્ન", defaultQuestion: "કાનૂની સલાહકાર સાથે કલમની સમીક્ષા કરો.", noRisks: "કોઈ જોખમી કલમ મળી નથી." },
        bn: { originalClause: "মূল ধারা", explanation: "সহজ ভাষার ব্যাখ্যা", whyDeserves: "কেন এটি মনোযোগ দেওয়া প্রয়োজন", suggestedQuestion: "উকিলের জন্য প্রস্তাবিত প্রশ্ন", defaultQuestion: "আইনি উপদেষ্টার সাথে ধারাটি পর্যালোচনা করুন।", noRisks: "কোনো ঝুঁকিপূর্ণ ধারা পাওয়া যায়নি।" }
    };
    const L = CLAUSE_RISK_LABELS[lang] || CLAUSE_RISK_LABELS['en'];

    if (!risks || risks.length === 0) {
        container.innerHTML = `<div class="empty-state"><p>${L.noRisks}</p></div>`;
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
                📜 <strong>${L.originalClause} (${r.page_ref || 'Reference'}):</strong><br>
                "${r.original_clause || 'Text'}"
            </div>

            <p><strong>${L.explanation}:</strong> ${r.explanation || ''}</p>
            <p style="margin-top: 6px; color: #92400e;"><strong>${L.whyDeserves}:</strong> ${r.why_deserves_attention || ''}</p>
            
            <div style="margin-top: 10px; background: #eff6ff; padding: 10px; border-radius: 8px;">
                <strong>${L.suggestedQuestion}:</strong><br>
                ❓ ${r.suggested_question || L.defaultQuestion}
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


// Helper function to convert AI ChatBot markdown formatting (**bold**, *italic*, [link](url), newlines) to clean HTML
function formatMarkdownChatText(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // Convert bold: **text** -> <strong>text</strong>
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Convert italic: *text* -> <em>text</em>
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');
    // Convert Markdown links: [label](url) -> <a href="url" target="_blank">label</a>
    html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #2563eb; font-weight: 600; text-decoration: underline;">$1</a>');
    // Convert line breaks to <br>
    html = html.replace(/\n/g, '<br>');
    return html;
}

// Grounded AI Chat Handler
function initChatHandler() {
    window.sendChatMessage = async (presetQuestion) => {
        const inputEl = document.getElementById('chatInput');
        const question = presetQuestion || (inputEl ? inputEl.value.trim() : '');
        if (!question) return;

        if (!window.appState || !window.appState.activeDocId) {
            showNotification("Please upload or select a document first before asking questions!", true);
            return;
        }

        const chatBox = document.getElementById('chatMessages');
        if (!chatBox) return;

        // Append User Message
        chatBox.innerHTML += `
            <div class="chat-bubble user" style="background: #2563eb; color: white; padding: 12px 16px; border-radius: 12px; margin-bottom: 12px; align-self: flex-end; max-width: 80%; margin-left: auto;">
                <strong>You:</strong>
                <p style="margin: 4px 0 0 0;">${escapeHtml(question)}</p>
            </div>
        `;
        if (inputEl) inputEl.value = '';
        chatBox.scrollTop = chatBox.scrollHeight;

        // Append Loading / Thinking Indicator Bubble
        const loadingId = 'chatLoading_' + Date.now();
        chatBox.innerHTML += `
            <div id="${loadingId}" class="chat-bubble ai" style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 12px 16px; border-radius: 12px; margin-bottom: 12px; max-width: 85%;">
                <strong>⚖️ LawBuddy Case AI Assistant:</strong>
                <p style="margin: 4px 0 0 0; color: #64748b; font-style: italic;">Thinking & searching document facts... ⏳</p>
            </div>
        `;
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
            const loadingBubble = document.getElementById(loadingId);
            if (loadingBubble) loadingBubble.remove();

            if (data.error) {
                throw new Error(data.error);
            }
            
            let sourcesHtml = '';
            if (data.sources && data.sources.length > 0) {
                sourcesHtml = `<div class="chat-sources-tag" style="margin-top: 8px; font-size: 11px; color: #0369a1; background: #e0f2fe; padding: 4px 8px; border-radius: 6px; display: inline-block;">📌 <strong>Document Grounding:</strong> ${data.sources.map(s => escapeHtml(typeof s === 'object' ? s.ref || JSON.stringify(s) : s)).join(', ')}</div>`;
            }

            const messageId = 'aiMsg_' + Date.now();
            const formattedAnswer = formatMarkdownChatText(data.answer || 'No response generated.');

            chatBox.innerHTML += `
                <div id="${messageId}" class="chat-bubble ai" style="background: #ffffff; border: 1px solid #cbd5e1; padding: 14px 16px; border-radius: 12px; margin-bottom: 12px; max-width: 85%; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <strong style="color: #1e293b;">⚖️ LawBuddy Case AI Assistant:</strong>
                        <button class="btn btn-secondary" style="font-size: 11px; padding: 2px 8px;" onclick="speakChatText(this)" title="Read aloud">🔊 Read Aloud</button>
                    </div>
                    <p style="margin: 4px 0 0 0; color: #334155; line-height: 1.5;" class="chat-answer-text">${formattedAnswer}</p>
                    ${sourcesHtml}
                </div>
            `;
            chatBox.scrollTop = chatBox.scrollHeight;
        } catch (err) {
            const loadingBubble = document.getElementById(loadingId);
            if (loadingBubble) loadingBubble.remove();

            chatBox.innerHTML += `
                <div class="chat-bubble ai" style="background: #fee2e2; border: 1px solid #fca5a5; padding: 12px 16px; border-radius: 12px; margin-bottom: 12px; max-width: 85%;">
                    <strong style="color: #991b1b;">⚠️ Error:</strong>
                    <p style="margin: 4px 0 0 0; color: #7f1d1d;">Could not retrieve answer. ${escapeHtml(err.message || String(err))}</p>
                </div>
            `;
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    };

    window.sendSuggestedQuestion = (presetText) => {
        switchTab('chatTab');
        window.sendChatMessage(presetText);
    };

    window.clearChatMessages = () => {
        const chatBox = document.getElementById('chatMessages');
        if (!chatBox) return;
        const lang = window.appState ? window.appState.selectedLanguage : 'kn';
        const welcomeText = (APP_TRANSLATIONS[lang] && APP_TRANSLATIONS[lang].chatWelcome) || APP_TRANSLATIONS.en.chatWelcome;
        chatBox.innerHTML = `
            <div class="chat-bubble ai" style="background: #ffffff; border: 1px solid #e2e8f0; padding: 14px; border-radius: 12px; margin-bottom: 12px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                <strong style="color: #1e293b;">⚖️ LawBuddy Case AI Assistant:</strong>
                <p data-i18n="chatWelcome" style="margin: 4px 0 0 0; color: #334155;">${escapeHtml(welcomeText)}</p>
            </div>
        `;
    };

    window.speakChatText = (btnElement) => {
        if (!window.speechSynthesis) {
            showNotification('Read-aloud is not available in this browser.', true);
            return;
        }
        const bubble = btnElement.closest('.chat-bubble');
        const textEl = bubble ? bubble.querySelector('.chat-answer-text') : null;
        const text = textEl ? textEl.innerText : '';
        if (!text) return;

        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const voiceMap = { en: 'en-IN', kn: 'kn-IN', hi: 'hi-IN', ml: 'ml-IN', te: 'te-IN', mr: 'mr-IN', bn: 'bn-IN', gu: 'gu-IN', ta: 'ta-IN' };
        utterance.lang = voiceMap[window.appState ? window.appState.selectedLanguage : 'kn'] || 'en-IN';
        speechSynthesis.speak(utterance);
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

async function openWordExplainer(word) {
    if (!word) return;
    const modal = document.getElementById('wordExplainerModal');
    const title = document.getElementById('modalWordTitle');
    const meaning = document.getElementById('modalSimpleMeaning');
    const example = document.getElementById('modalRealExample');
    const question = document.getElementById('modalLawyerQuestion');

    if (title) title.textContent = word;
    if (meaning) meaning.textContent = 'Finding a simple explanation...';
    if (example) example.textContent = '...';
    if (question) question.textContent = '...';

    if (modal) modal.classList.remove('hidden');

    try {
        const res = await apiFetch('/api/explain-word', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ word: word, language: window.appState.selectedLanguage })
        });
        const data = await readApiJson(res);
        if (data.error) throw new Error(data.error);

        if (title) title.textContent = data.word || word;
        if (meaning) meaning.textContent = data.simple_meaning || '';
        if (example) example.textContent = data.real_world_example || '';
        if (question) question.textContent = data.question_for_lawyer || '';
    } catch (err) {
        if (meaning) meaning.textContent = `Could not explain '${word}': ${err.message}`;
    }
}

function closeWordExplainerModal() {
    const modal = document.getElementById('wordExplainerModal');
    if (modal) modal.classList.add('hidden');
}

async function deleteAccount() {
    const confirmDelete = confirm("Are you sure you want to delete your LawBuddy account? All temporary document data and your session will be permanently deleted immediately.");
    if (!confirmDelete) return;

    try {
        await apiFetch('/api/account/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ doc_id: window.appState ? window.appState.activeDocId : null })
        });
    } catch (e) {
        console.warn("Delete account API error:", e);
    }

    localStorage.removeItem('lawbuddyUser');
    sessionStorage.clear();
    alert("Your account session and all temporary document data have been permanently deleted.");
    window.location.replace("login.html");
}
window.deleteAccount = deleteAccount;

