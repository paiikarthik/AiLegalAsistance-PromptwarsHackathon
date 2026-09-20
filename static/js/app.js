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
    switchTab('storyTab');
    if (action === 'voice') startVoiceInput('storyInput');
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
        tagline: 'Legal Access & Case Preparation Platform', demo: '1-Click Rental Agreement Demo', language: 'Language', deleteAccount: 'Delete Account', exit: 'Exit', activeDocument: 'Active Document', noDocLoaded: 'No document loaded', pendingUpload: 'Pending Upload', navHome: 'Home', navMyCase: 'My Case', legalInfoNoticeTitle: '⚠️ Legal Information Notice', legalInfoNoticeDesc: 'LawBuddy AI provides preparation assistance, not legal advice or representation. Verify critical claims with legal aid or an advocate.', privacyBanner: '🔒 Privacy Guarantee: Uploaded documents are processed securely in memory and automatically deleted within 3 hours. We do not store any document permanently.', homeHeader: 'What do you need help with?', homeSub: 'Legal documents can be difficult to understand. Let me explain them simply.', cardExplainDoc: 'Explain my document', cardExplainDocSub: 'Upload a file, paste text, or add a link', cardLegalQuestion: 'I have a legal question', cardLegalQuestionSub: 'Tell me what happened in your own words', cardPhotoNotice: 'Take a photo of a notice', cardPhotoNoticeSub: 'We will read it and explain it', cardSpeak: 'Speak to LawBuddy', cardSpeakSub: 'Say what happened in your preferred language', btnMyCase: '📁 My Case', btnBackHome: '← Home', storyTitle: 'What happened?', storySub: 'Use everyday words. You do not need to know legal terms.', storyPlaceholder: 'For example: My landlord gave me a notice and I don\'t understand it.', btnSpeakInstead: '🎤 Speak instead', btnContinue: 'Continue', listeningText: 'Listening… speak naturally, then pause.', uploadTitle: 'Upload Legal Document', uploadDescription: 'Supports Legal Notices, Rental Agreements, Employment Contracts, Consumer Complaints, NDAs, Service Contracts, and more.', uploadStep1: '1. Upload Document', fileSupport: 'Supports PDF, DOCX, TXT, PNG, JPG (Scanned Notice & Document OCR Supported)', browse: 'Browse Files', loadDemo: '⚡ Load Sample Rental Agreement Demo', uploadStep2: '2. Upload Text', pastePlaceholder: 'Paste legal notice text, agreement clauses, employment contract text, or communication here...', analyzePasted: 'Analyze Pasted Text', uploadStep3: '3. Enter or Paste a Link', linkSub: 'Paste a public webpage link and LawBuddy will extract its text for AI analysis.', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'Analyze Website Link', docSource: 'Document Source:', docTypeLabel: 'Document type:', btnAnalyzeDoc: '🚀 Analyze Document & Map Facts', textFoundLabel: 'Text we found:', evidenceTitle: '📋 Evidence-to-Clause Mapping & Verification Matrix', evidenceSub: 'Keep your important documents, dates, and questions in one simple place.', evidenceAddPlaceholder: 'Add something you have, such as a payment receipt or message...', btnAddEvidence: '➕ Add Evidence Item', statusFound: 'Evidence found', statusMissing: 'Evidence missing', statusSuggested: 'Evidence suggested', statusVerification: 'Requires verification', clarityTitle: 'Legal Clarity & Document Overview Action Map', claritySub: 'Based on the document or information you shared. This is general information, not legal advice.', showLabel: 'Show:', lvlSimple: '🙂 Simple', lvlVerySimple: '👶 Very Simple', lvlDetails: '⚖️ Legal Details', btnReadAloud: '🔊 Read this aloud', execSummaryTitle: '📄 Executive Document Summary', execSummaryPlaceholder: 'Upload a document and click \'Analyze Document & Map Facts\' to generate an instant plain-language summary.', actionUnderstand: '💡 Understand', actionUnderstandDesc: 'Plain-language summary of what this document demands', actionIdentify: '⚠️ Identify', actionIdentifyDesc: 'Deadlines, cure periods, monetary claims & obligations', actionPrepare: '📝 Prepare', actionPrepareDesc: 'Questions for a lawyer & evidence collection checklist', actionNavigate: '🧭 Navigate', actionNavigateDesc: 'Step-by-step non-advice plan & official legal resources', difficultWordTitle: 'What does a difficult word mean?', difficultWordSub: 'Type a word from the document, such as “indemnification”.', difficultWordPlaceholder: 'Type a word', btnExplainWord: 'Explain this word', difficultTermModalTitle: 'Difficult Term', simpleMeaningHeader: '💡 Simple Meaning:', everydayExampleHeader: '🌟 Everyday Example:', askLawyerHeader: '🧑‍⚖️ Ask a Lawyer:', btnGotIt: 'Got it!', factsTitle: 'Extracted Facts & Chronological Event Timeline', factsSub: 'Automatic extraction of entities, amounts, obligations, and dispute sequence.', keyDatesLabel: 'KEY DATES & DEADLINES', amountsLabel: 'AMOUNTS & FINANCIALS', partiesLabel: 'PARTIES & ENTITIES', obligationsLabel: 'KEY MANDATE / OBLIGATIONS', timelineTitle: '📅 Chronological Fact & Dispute Timeline'
    },
    kn: {
        tagline: 'ಕಾನೂನು ಲಭ್ಯತೆ ಮತ್ತು ಪ್ರಕರಣ ಸಿದ್ಧತೆಯ ವೇದಿಕೆ', demo: 'ಒಂದು ಕ್ಲಿಕ್ ಬಾಡಿಗೆ ಒಪ್ಪಂದ ಡೆಮೊ', language: 'ಭಾಷೆ', deleteAccount: 'ಖಾತೆ ಅಳಿಸಿ', exit: 'ನಿರ್ಗಮಿಸಿ', activeDocument: 'ಸಕ್ರಿಯ ದಾಖಲೆ', noDocLoaded: 'ಯಾವ ದಾಖಲೆಯೂ ಲೋಡ್ ಆಗಿಲ್ಲ', pendingUpload: 'ಅಪ್‌ಲೋಡ್ ಬಾಕಿ ಇದೆ', navHome: 'ಮುಖಪುಟ', navMyCase: 'ನನ್ನ ಪ್ರಕರಣ', legalInfoNoticeTitle: '⚠️ ಕಾನೂನು ಮಾಹಿತಿ ಸೂಚನೆ', legalInfoNoticeDesc: 'LawBuddy AI ಸಿದ್ಧತೆಗೆ ಸಹಾಯ ಮಾಡುತ್ತದೆ, ಕಾನೂನು ಸಲಹೆ ನೀಡಲ್ಲ. ವಕೀಲರಿಂದ ಪರಿಶೀಲಿಸಿ.', privacyBanner: '🔒 ಗೌಪ್ಯತೆ ಭರವಸೆ: ಅಪ್‌ಲೋಡ್ ಮಾಡಿದ ದಾಖಲೆಗಳನ್ನು ಸುರಕ್ಷಿತವಾಗಿ ಸಂಸ್ಕರಿಸಲಾಗುತ್ತದೆ ಮತ್ತು 3 ಗಂಟೆಗಳಲ್ಲಿ ಸ್ವಯಂಚಾಲಿತವಾಗಿ ಅಳಿಸಲಾಗುತ್ತದೆ.', homeHeader: 'ನಿಮಗೆ ಉಚಿತ ಕಾನೂನು ನೆರವು ಬೇಕೇ?', homeSub: 'ಕಾನೂನು ದಾಖಲೆಗಳನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳುವುದು ಕಷ್ಟ. ನಾನು ಸರಳವಾಗಿ ವಿವರಿಸುತ್ತೇನೆ.', cardExplainDoc: 'ನನ್ನ ದಾಖಲೆಯನ್ನು ವಿವರಿಸಿ', cardExplainDocSub: 'ಫೈಲ್ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ, ಪಠ್ಯ ಅಂಟಿಸಿ ಅಥವಾ ಲಿಂಕ್ ಸೇರಿಸಿ', cardLegalQuestion: 'ನನಗೆ ಕಾನೂನು ಪ್ರಶ್ನೆ ಇದೆ', cardLegalQuestionSub: 'ಏನಾಯಿತು ಎಂದು ನಿಮ್ಮ ಮಾತಿನಲ್ಲಿ ಹೇಳಿ', cardPhotoNotice: 'ನೋಟಿಸ್‌ನ ಫೋಟೋ ತೆಗೆಯಿರಿ', cardPhotoNoticeSub: 'ನಾವು ಅದನ್ನು ಓದಿ ವಿವರಿಸುತ್ತೇವೆ', cardSpeak: 'LawBuddy ಯೊಂದಿಗೆ ಮಾತನಾಡಿ', cardSpeakSub: 'ನಿಮ್ಮ ಆಯ್ಕೆಯ ಭಾಷೆಯಲ್ಲಿ ಮಾತನಾಡಿ', btnMyCase: '📁 ನನ್ನ ಪ್ರಕರಣ', btnBackHome: '← ಮುಖಪುಟ', storyTitle: 'ಏನಾಯಿತು?', storySub: 'ಸಾಮಾನ್ಯ ಮಾತುಗಳನ್ನು ಬಳಸಿ. ಕಾನೂನು ಪದಗಳು ಬೇಕಾಗಿಲ್ಲ.', storyPlaceholder: 'ಉದಾಹರಣೆಗೆ: ನನ್ನ ಮನೆಮಾಲೀಕರು ನೋಟಿಸ್ ನೀಡಿದ್ದಾರೆ, ನನಗೆ ಅರ್ಥವಾಗುತ್ತಿಲ್ಲ.', btnSpeakInstead: '🎤 ಮಾತನಾಡಿ', btnContinue: 'ಮುಂದುವರಿಸಿ', listeningText: 'ಆಲಿಸುತ್ತಿದೆ… ಸ್ಪಷ್ಟವಾಗಿ ಮಾತನಾಡಿ, ನಂತರ ನಿಲ್ಲಿಸಿ.', uploadTitle: 'ಕಾನೂನು ದಾಖಲೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ', uploadDescription: 'ಕಾನೂನು ನೋಟಿಸ್‌ಗಳು, ಬಾಡಿಗೆ ಒಪ್ಪಂದಗಳು, ಉದ್ಯೋಗ ಒಪ್ಪಂದಗಳು ಮತ್ತು ಇತರೆ ದಾಖಲೆಗಳಿಗೆ ಬೆಂಬಲವಿದೆ.', uploadStep1: '1. ದಾಖಲೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ', fileSupport: 'PDF, DOCX, TXT, PNG, JPG ಬೆಂಬಲಿಸುತ್ತದೆ (OCR ಲಭ್ಯವಿದೆ)', browse: 'ಫೈಲ್‌ಗಳನ್ನು ಆಯ್ಕೆಮಾಡಿ', loadDemo: '⚡ ಮಾದರಿ ಒಪ್ಪಂದ ಡೆಮೊ ಲೋಡ್ ಮಾಡಿ', uploadStep2: '2. ಪಠ್ಯ ಅಂಟಿಸಿ', pastePlaceholder: 'ಕಾನೂನು ನೋಟಿಸ್ ಪಠ್ಯ ಅಥವಾ ಷರತ್ತುಗಳನ್ನು ಇಲ್ಲಿ ಅಂಟಿಸಿ...', analyzePasted: 'ಅಂಟಿಸಿದ ಪಠ್ಯವನ್ನು ವಿಶ್ಲೇಷಿಸಿ', uploadStep3: '3. ಲಿಂಕ್ ನಮೂದಿಸಿ', linkSub: 'ವೆಬ್ ಪುಟದ ಲಿಂಕ್ ಅಂಟಿಸಿ', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'ಲಿಂಕ್ ವಿಶ್ಲೇಷಿಸಿ', docSource: 'ದಾಖಲೆಯ ಮೂಲ:', docTypeLabel: 'ದಾಖಲೆಯ ಪ್ರಕಾರ:', btnAnalyzeDoc: '🚀 ದಾಖಲೆ ವಿಶ್ಲೇಷಿಸಿ ಮತ್ತು ನಕ್ಷೆ ಮಾಡಿ', textFoundLabel: 'ಕಂಡುಬಂದ ಪಠ್ಯ:', evidenceTitle: '📋 ಸಾಕ್ಷ್ಯ ಮತ್ತು ಷರತ್ತುಗಳ ನಕ್ಷೆ', evidenceSub: 'ನಿಮ್ಮ ಪ್ರಮುಖ ದಾಖಲೆಗಳು ಮತ್ತು ದಿನಾಂಕಗಳನ್ನು ಒಂದೇ ಸ್ಥಳದಲ್ಲಿ ಇರಿಸಿ.', evidenceAddPlaceholder: 'ನಿಮ್ಮಲ್ಲಿರುವ ರಶೀದಿ ಅಥವಾ ಸಂದೇಶವನ್ನು ಸೇರಿಸಿ...', btnAddEvidence: '➕ ಸಾಕ್ಷ್ಯ ಅಂಶ ಸೇರಿಸಿ', statusFound: 'ಸಾಕ್ಷ್ಯ ಸಿಕ್ಕಿದೆ', statusMissing: 'ಸಾಕ್ಷ್ಯ ಲಭ್ಯವಿಲ್ಲ', statusSuggested: 'ಸೂಚಿಸಿದ ಸಾಕ್ಷ್ಯ', statusVerification: 'ಪರಿಶೀಲನೆ ಅಗತ್ಯವಿದೆ', clarityTitle: 'ಕಾನೂನು ಸ್ಪಷ್ಟತೆ ಮತ್ತು ಕ್ರಿಯಾ ನಕ್ಷೆ', claritySub: 'ನೀವು ಹಂಚಿಕೊಂಡ ಮಾಹಿತಿಯ ಆಧಾರದ ಮೇಲೆ ಸಾಮಾನ್ಯ ವಿವರಣೆ.', showLabel: 'ತೋರಿಸಿ:', lvlSimple: '🙂 ಸರಳ', lvlVerySimple: '👶 ಅತ್ಯಂತ ಸರಳ', lvlDetails: '⚖️ ಕಾನೂನು ವಿವರಗಳು', btnReadAloud: '🔊 ಗಟ್ಟಿಯಾಗಿ ಓದಿ', execSummaryTitle: '📄 ದಾಖಲೆಯ ಮುಖ್ಯ ಸಾರಾಂಶ', execSummaryPlaceholder: 'ಸಾರಾಂಶವನ್ನು ಪಡೆಯಲು ದಾಖಲೆ ಅಪ್‌ಲೋಡ್ ಮಾಡಿ ವಿಶ್ಲೇಷಿಸಿ.', actionUnderstand: '💡 ಅರ್ಥಮಾಡಿಕೊಳ್ಳಿ', actionUnderstandDesc: 'ದಾಖಲೆಯ ಸರಳ ಸಾರಾಂಶ', actionIdentify: '⚠️ ಗುರುತಿಸಿ', actionIdentifyDesc: 'ಗಡುವುಗಳು, ದಂಡಗಳು ಮತ್ತು ಬಾಧ್ಯತೆಗಳು', actionPrepare: '📝 ಸಿದ್ಧರಾಗಿ', actionPrepareDesc: 'ವಕೀಲರ ಪ್ರಶ್ನೆಗಳು ಮತ್ತು ಸಾಕ್ಷ್ಯಗಳ ಪಟ್ಟಿ', actionNavigate: '🧭 ಮಾರ್ಗದರ್ಶನ', actionNavigateDesc: 'ಹಂತ-ಹಂತದ ಮುಂದಿನ ಕ್ರಮಗಳು', difficultWordTitle: 'ಕಠಿಣ ಪದದ ಅರ್ಥವೇನು?', difficultWordSub: 'ದಾಖಲೆಯಿಂದ ಒಂದು ಪದವನ್ನು ಟೈಪ್ ಮಾಡಿ.', difficultWordPlaceholder: 'ಪದವನ್ನು ಟೈಪ್ ಮಾಡಿ', btnExplainWord: 'ಈ ಪದವನ್ನು ವಿವರಿಸಿ', difficultTermModalTitle: 'ಕಠಿಣ ಪದ', simpleMeaningHeader: '💡 ಸರಳ ಅರ್ಥ:', everydayExampleHeader: '🌟 ದಿನನಿತ್ಯದ ಉದಾಹರಣೆ:', askLawyerHeader: '🧑‍⚖️ ವಕೀಲರನ್ನು ಕೇಳಿ:', btnGotIt: 'ಅರ್ಥವಾಯಿತು!', factsTitle: 'ಪ್ರಮುಖ ಸಂಗತಿಗಳು ಮತ್ತು ಕಾಲಾನುಕ್ರಮ', factsSub: 'ದಿನಾಂಕಗಳು, ಮೊತ್ತಗಳು ಮತ್ತು ಘಟನೆಗಳ ಸ್ವಯಂಚಾಲಿತ ಪಟ್ಟಿ.', keyDatesLabel: 'ಪ್ರಮುಖ ದಿನಾಂಕಗಳು ಮತ್ತು ಗಡುವುಗಳು', amountsLabel: 'ಹಣಕಾಸು ಮತ್ತು ಮೊತ್ತಗಳು', partiesLabel: 'ಸಂಬಂಧಿತ ವ್ಯಕ್ತಿಗಳು/ಸಂಸ್ಥೆಗಳು', obligationsLabel: 'ಪ್ರಮುಖ ಬಾಧ್ಯತೆಗಳು', timelineTitle: '📅 ಘಟನೆಗಳ ಕಾಲಾನುಕ್ರಮ'
    },
    hi: {
        tagline: 'कानूनी पहुंच और मामला तैयारी मंच', demo: 'एक-क्लिक किराया समझौता डेमो', language: 'भाषा', deleteAccount: 'खाता हटाएं', exit: 'बाहर निकलें', activeDocument: 'सक्रिय दस्तावेज़', noDocLoaded: 'कोई दस्तावेज़ लोड नहीं है', pendingUpload: 'अपलोड लंबित', navHome: 'होम', navMyCase: 'मेरा केस', legalInfoNoticeTitle: '⚠️ कानूनी सूचना', legalInfoNoticeDesc: 'LawBuddy AI सहायता प्रदान करता है, यह कानूनी सलाह नहीं है।', privacyBanner: '🔒 गोपनीयता गारंटी: अपलोड किए गए दस्तावेज़ 3 घंटे के भीतर स्वचालित रूप से हटा दिए जाते हैं।', homeHeader: 'आपको किसमें सहायता चाहिए?', homeSub: 'कानूनी दस्तावेज़ों को समझना कठिन हो सकता है। मैं सरलता से समझाऊंगा।', cardExplainDoc: 'मेरा दस्तावेज़ समझाइए', cardExplainDocSub: 'फ़ाइल अपलोड करें, पाठ चिपकाएँ या लिंक जोड़ें', cardLegalQuestion: 'मेरा एक कानूनी प्रश्न है', cardLegalQuestionSub: 'अपने शब्दों में बताएं कि क्या हुआ', cardPhotoNotice: 'नोटिस की फोटो लें', cardPhotoNoticeSub: 'हम इसे पढ़कर समझाएंगे', cardSpeak: 'LawBuddy से बात करें', cardSpeakSub: 'अपनी पसंदीदा भाषा में बोलें', btnMyCase: '📁 मेरा केस', btnBackHome: '← होम', storyTitle: 'क्या हुआ था?', storySub: 'सामान्य शब्दों का प्रयोग करें।', storyPlaceholder: 'उदाहरण के लिए: मेरे मकान मालिक ने मुझे एक नोटिस दिया है।', btnSpeakInstead: '🎤 बोलकर बताएं', btnContinue: 'आगे बढ़ें', listeningText: 'सुन रहे हैं...', uploadTitle: 'कानूनी दस्तावेज़ अपलोड करें', uploadDescription: 'नोटिस, किराया समझौते, रोजगार अनुबंध आदि का समर्थन करता है।', uploadStep1: '1. दस्तावेज़ अपलोड करें', fileSupport: 'PDF, DOCX, TXT, PNG, JPG समर्थित (OCR उपलब्ध)', browse: 'फ़ाइलें चुनें', loadDemo: '⚡ नमूना समझौता डेमो लोड करें', uploadStep2: '2. पाठ चिपकाएँ', pastePlaceholder: 'कानूनी पाठ यहाँ चिपकाएँ...', analyzePasted: 'विश्लेषण करें', uploadStep3: '3. लिंक दर्ज करें', linkSub: 'वेबपेज लिंक चिपकाएँ', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'लिंक का विश्लेषण करें', docSource: 'दस्तावेज़ का स्रोत:', docTypeLabel: 'दस्तावेज़ का प्रकार:', btnAnalyzeDoc: '🚀 विश्लेषण करें और मानचित्रित करें', textFoundLabel: 'प्राप्त पाठ:', evidenceTitle: '📋 साक्ष्य और धारा मैपिंग', evidenceSub: 'अपने दस्तावेज़ों और तिथियों को एक स्थान पर रखें।', evidenceAddPlaceholder: 'कोई रसीद या संदेश जोड़ें...', btnAddEvidence: '➕ साक्ष्य जोड़ें', statusFound: 'साक्ष्य मिला', statusMissing: 'साक्ष्य अनुपलब्ध', statusSuggested: 'सुझाया गया साक्ष्य', statusVerification: 'सत्यापन आवश्यक', clarityTitle: 'कानूनी स्पष्टता और कार्य मानचित्र', claritySub: 'सामान्य विवरण।', showLabel: 'दिखाएं:', lvlSimple: '🙂 सरल', lvlVerySimple: '👶 अत्यंत सरल', lvlDetails: '⚖️ कानूनी विवरण', btnReadAloud: '🔊 बोलकर सुनाएं', execSummaryTitle: '📄 मुख्य दस्तावेज़ सारांश', execSummaryPlaceholder: 'दस्तावेज़ अपलोड करें।', actionUnderstand: '💡 समझें', actionUnderstandDesc: 'सरल सारांश', actionIdentify: '⚠️ पहचानें', actionIdentifyDesc: 'समय-सीमाएं और दायित्व', actionPrepare: '📝 तैयारी करें', actionPrepareDesc: 'वकील के लिए प्रश्न और साक्ष्य सूची', actionNavigate: '🧭 मार्गदर्शन', actionNavigateDesc: 'चरण-दर-चरण कदम', difficultWordTitle: 'कठिन शब्द का क्या अर्थ है?', difficultWordSub: 'कोई शब्द टाइप करें।', difficultWordPlaceholder: 'शब्द टाइप करें', btnExplainWord: 'शब्द समझाइए', difficultTermModalTitle: 'कठिन शब्द', simpleMeaningHeader: '💡 सरल अर्थ:', everydayExampleHeader: '🌟 दैनिक उदाहरण:', askLawyerHeader: '🧑‍⚖️ वकील से पूछें:', btnGotIt: 'समझ गया!', factsTitle: 'निकाले गए तथ्य और समयरेखा', factsSub: 'तारीखों और राशियाँ की सूची।', keyDatesLabel: 'मुख्य तिथियां', amountsLabel: 'वित्तीय राशियाँ', partiesLabel: 'संबंधित पक्ष', obligationsLabel: 'मुख्य दायित्व', timelineTitle: '📅 घटनाओं की समयरेखा'
    },
    ml: {
        tagline: 'നിയമ പ്രവേശനവും കേസ് തയ്യാറാക്കൽ പ്ലാറ്റ്‌ഫോമും', demo: 'ഒറ്റ ക്ലിക്ക് വാടക കരാർ ഡെമോ', language: 'ഭാഷ', deleteAccount: 'അക്കൗണ്ട് ഇല്ലാതാക്കുക', exit: 'പുറത്തുകടക്കുക', activeDocument: 'സജീവ പ്രമാണം', noDocLoaded: 'പ്രമാണമൊന്നും ലോഡ് ചെയ്തിട്ടില്ല', pendingUpload: 'അപ്‌ലോഡ് ബാക്കിയാണ്', navHome: 'ഹോം', navMyCase: 'എന്റെ കേസ്', legalInfoNoticeTitle: '⚠️ നിയമ വിവര മുന്നറിയിപ്പ്', legalInfoNoticeDesc: 'LawBuddy AI തയ്യാറെടുപ്പ് സഹായം നൽകുന്നു.', privacyBanner: '🔒 സ്വകാര്യതാ ഉറപ്പ്: അപ്‌ലോഡ് ചെയ്ത പ്രമാണങ്ങൾ 3 മണിക്കൂറിനുള്ളിൽ സ്വയമേവ ഇല്ലാതാക്കുന്നു.', homeHeader: 'നിങ്ങൾക്ക് എന്തിലാണ് സഹായം വേണ്ടത്?', homeSub: 'നിയമ രേഖകൾ മനസ്സിലാക്കാൻ ബുദ്ധിമുട്ടാണ്. ഞാൻ ലളിതമായി വിവരിക്കാം.', cardExplainDoc: 'എന്റെ പ്രമാണം വിശദീകരിക്കുക', cardExplainDocSub: 'ഫയൽ അപ്‌ലോഡ് ചെയ്യുക അല്ലെങ്കിൽ ലിങ്ക് ചേർക്കുക', cardLegalQuestion: 'എനിക്ക് ഒരു നിയമപരമായ ചോദ്യമുണ്ട്', cardLegalQuestionSub: 'എന്താണ് സംഭവിച്ചതെന്ന് സ്വന്തം വാക്കുകളിൽ പറയുക', cardPhotoNotice: 'നോട്ടീസിന്റെ ഫോട്ടോ എടുക്കുക', cardPhotoNoticeSub: 'ഞങ്ങൾ അത് വായിച്ച് വിശദീകരിക്കും', cardSpeak: 'LawBuddy-യോട് സംസാരിക്കുക', cardSpeakSub: 'നിങ്ങളുടെ ഭാഷയിൽ സംസാരിക്കുക', btnMyCase: '📁 എന്റെ കേസ്', btnBackHome: '← ഹോം', storyTitle: 'എന്താണ് സംഭവിച്ചത്?', storySub: 'സാധാരണ വാക്കുകൾ ഉപയോഗിക്കുക.', storyPlaceholder: 'ഉദാഹരണത്തിന്: വീട്ടുടമസ്ഥൻ നോട്ടീസ് നൽകി.', btnSpeakInstead: '🎤 സംസാരിക്കുക', btnContinue: 'തുടരുക', listeningText: 'ശ്രദ്ധിക്കുന്നു…', uploadTitle: 'നിയമപരമായ പ്രമാണം അപ്‌ലോഡ് ചെയ്യുക', uploadDescription: 'നോട്ടീസുകൾ, വാടക കരാറുകൾ മുതലായവ പിന്തുണയ്ക്കുന്നു.', uploadStep1: '1. പ്രമാണം അപ്‌ലോഡ് ചെയ്യുക', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR ലഭ്യമാണ്)', browse: 'ഫയലുകൾ തിരഞ്ഞെടുക്കുക', loadDemo: '⚡ മാതൃകാ കരാർ ലോഡ് ചെയ്യുക', uploadStep2: '2. വാചകം ഒട്ടിക്കുക', pastePlaceholder: 'നിയമപരമായ വാചകം ഇവിടെ ഒട്ടിക്കുക...', analyzePasted: 'വിശകലനം ചെയ്യുക', uploadStep3: '3. ലിങ്ക് നൽകുക', linkSub: 'വെബ് ലിങ്ക് ഒട്ടിക്കുക', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'ലിങ്ക് വിശകലനം ചെയ്യുക', docSource: 'പ്രമാണത്തിന്റെ ഉറവിടം:', docTypeLabel: 'പ്രമാണ തരം:', btnAnalyzeDoc: '🚀 വിശകലനം ചെയ്യുക', textFoundLabel: 'കണ്ടെത്തിയ വാചകം:', evidenceTitle: '📋 തെളിവുകളും വിവരങ്ങളും', evidenceSub: 'നിങ്ങളുടെ പ്രമാണങ്ങളും തീയതികളും ഒരു സ്ഥലത്ത് സൂക്ഷിക്കുക.', evidenceAddPlaceholder: 'രസീതോ സന്ദേശമോ ചേർക്കുക...', btnAddEvidence: '➕ തെളിവ് ചേർക്കുക', statusFound: 'തെളിവ് ലഭിച്ചു', statusMissing: 'തെളിവ് ഇല്ല', statusSuggested: 'നിർദ്ദേശിച്ച തെളിവ്', statusVerification: 'പരിശോധന ആവശ്യമാണ്', clarityTitle: 'നിയമ വ്യക്തതയും വിവരങ്ങളും', claritySub: 'സാധാരണ വിവരണം.', showLabel: 'കാണിക്കുക:', lvlSimple: '🙂 ലളിതം', lvlVerySimple: '👶 വളരെ ലളിതം', lvlDetails: '⚖️ നിയമപരമായ വിവരങ്ങൾ', btnReadAloud: '🔊 ഉറക്കെ വായിക്കുക', execSummaryTitle: '📄 പ്രധാന സാരം', execSummaryPlaceholder: 'വിശകലനം ചെയ്യാൻ പ്രമാണം അപ്‌ലോഡ് ചെയ്യുക.', actionUnderstand: '💡 മനസ്സിലാക്കുക', actionUnderstandDesc: 'ലളിതമായ സംഗ്രഹം', actionIdentify: '⚠️ കണ്ടെത്തുക', actionIdentifyDesc: 'തീയതികളും സമയപരിധികളും', actionPrepare: '📝 തയ്യാറെടുക്കുക', actionPrepareDesc: 'വക്കീലിനോട് ചോദിക്കേണ്ട ചോദ്യങ്ങൾ', actionNavigate: '🧭 വഴിനടത്തൽ', actionNavigateDesc: 'അടുത്ത ഘട്ടങ്ങൾ', difficultWordTitle: 'കഠിനമായ വാക്കിന്റെ അർത്ഥമെന്താണ്?', difficultWordSub: 'ഒരു വാക്ക് ടൈപ്പ് ചെയ്യുക.', difficultWordPlaceholder: 'വാക്ക് ടൈപ്പ് ചെയ്യുക', btnExplainWord: 'വിശദീകരിക്കുക', difficultTermModalTitle: 'കഠിനമായ വാക്ക്', simpleMeaningHeader: '💡 ലളിതമായ അർത്ഥം:', everydayExampleHeader: '🌟 ദൈനംദിന ഉദാഹരണം:', askLawyerHeader: '🧑‍⚖️ വക്കീലിനോട് ചോദിക്കുക:', btnGotIt: 'മനസ്സിലായി!', factsTitle: 'പ്രധാന വിവരങ്ങളും തീയതികളും', factsSub: 'തീയതികളുടെയും തുകകളുടെയും പട്ടിക.', keyDatesLabel: 'പ്രധാന തീയതികൾ', amountsLabel: 'സാമ്പത്തിക വിവരങ്ങൾ', partiesLabel: 'ബന്ധപ്പെട്ട വ്യക്തികൾ', obligationsLabel: 'പ്രധാന ചുമതലകൾ', timelineTitle: '📅 സംഭവങ്ങളുടെ സമയരേഖ'
    },
    te: {
        tagline: 'న్యాయ ప్రాప్యత మరియు కేసు తయారీ వేదిక', demo: 'ఒక క్లిక్ అద్దె ఒప్పందం డెమో', language: 'భాష', deleteAccount: 'ఖాతాను తొలగించు', exit: 'నిష్క్రమించు', activeDocument: 'క్రియాశీల పత్రం', noDocLoaded: 'ఏ పత్రం లోడ్ కాలేదు', pendingUpload: 'అప్‌లోడ్ మిగిలి ఉంది', navHome: 'హోమ్', navMyCase: 'నా కేసు', legalInfoNoticeTitle: '⚠️ న్యాయ సమాచార నోటీసు', legalInfoNoticeDesc: 'LawBuddy AI సహాయం అందిస్తుంది.', privacyBanner: '🔒 గోప్యతా హామీ: అప్‌లోడ్ చేసిన పత్రాలు 3 గంటల్లో స్వయంచాలకంగా తొలగించబడతాయి.', homeHeader: 'మీకు దేనిలో సహాయం కావాలి?', homeSub: 'న్యాయ పత్రాలను అర్థం చేసుకోవడం కష్టం. నేను సులభంగా వివరిస్తాను.', cardExplainDoc: 'నా పత్రాన్ని వివరించండి', cardExplainDocSub: 'ఫైల్ అప్‌లోడ్ చేయండి లేదా లింక్ జోడించండి', cardLegalQuestion: 'నాకు న్యాయపరమైన ప్రశ్న ఉంది', cardLegalQuestionSub: 'ఏమి జరిగిందో మీ మాటల్లో చెప్పండి', cardPhotoNotice: 'నోటీసు ఫోటో తీయండి', cardPhotoNoticeSub: 'మేము చదివి వివరిస్తాము', cardSpeak: 'LawBuddyతో మాట్లాడండి', cardSpeakSub: 'మీ భాషలో మాట్లాడండి', btnMyCase: '📁 నా కేసు', btnBackHome: '← హోమ్', storyTitle: 'ఏమి జరిగింది?', storySub: 'సాధారణ పదాలను ఉపయోగించండి.', storyPlaceholder: 'ఉదాహరణకు: యజమాని నోటీసు ఇచ్చారు.', btnSpeakInstead: '🎤 మాట్లాడండి', btnContinue: 'కొనసాగించండి', listeningText: 'వింటోంది…', uploadTitle: 'న్యాయ పత్రాన్ని అప్‌లోడ్ చేయండి', uploadDescription: 'నోటీసులు, అద్దె ఒప్పందాలు మొదలైనవాటికి మద్దతు ఉంది.', uploadStep1: '1. పత్రాన్ని అప్‌లోడ్ చేయండి', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR లభ్యం)', browse: 'ఫైళ్లను ఎంచుకోండి', loadDemo: '⚡ నమూనా ఒప్పందం డెమో', uploadStep2: '2. పాఠ్యాన్ని అతికించండి', pastePlaceholder: 'న్యాయ పాఠ్యాన్ని ఇక్కడ అతికించండి...', analyzePasted: 'విశ్లేషించండి', uploadStep3: '3. లింక్ నమోదు చేయండి', linkSub: 'వెబ్ లింక్ అతికించండి', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'లింక్ విశ్లేషించండి', docSource: 'పత్ర మూలం:', docTypeLabel: 'పత్ర రకం:', btnAnalyzeDoc: '🚀 విశ్లేషించండి', textFoundLabel: 'కనుగొన్న పాఠ్యం:', evidenceTitle: '📋 ఆధారాలు మరియు వివరాలు', evidenceSub: 'మీ పత్రాలు మరియు తేదీలను ఒకే చోట ఉంచండి.', evidenceAddPlaceholder: 'రశీదు లేదా సందేశాన్ని జోడించండి...', btnAddEvidence: '➕ ఆధారాన్ని జోడించు', statusFound: 'ఆధారం లభించింది', statusMissing: 'ఆధారం లేదు', statusSuggested: 'సూచించిన ఆధారం', statusVerification: 'సరిచూడవలసి ఉంది', clarityTitle: 'న్యాయ స్పష్టత మరియు చర్యల పటం', claritySub: 'సాధారణ సమాచారం.', showLabel: 'చూపించు:', lvlSimple: '🙂 సరళం', lvlVerySimple: '👶 చాలా సరళం', lvlDetails: '⚖️ న్యాయ వివరాలు', btnReadAloud: '🔊 బిగ్గరగా చదవండి', execSummaryTitle: '📄 పత్ర ముఖ్యాంశాలు', execSummaryPlaceholder: 'విశ్లేషణ కోసం పత్రాన్ని అప్‌లోడ్ చేయండి.', actionUnderstand: '💡 అర్థం చేసుకోండి', actionUnderstandDesc: 'సరళమైన సారాంశం', actionIdentify: '⚠️ గుర్తించండి', actionIdentifyDesc: 'తేదీలు మరియు గడువులు', actionPrepare: '📝 సిద్ధం కండి', actionPrepareDesc: 'లాయర్‌ను అడగవలసిన ప్రశ్నలు', actionNavigate: '🧭 మార్గదర్శకం', actionNavigateDesc: 'తరువాతి చర్యలు', difficultWordTitle: 'కష్టమైన పదం అర్థం ఏమిటి?', difficultWordSub: 'ఒక పదాన్ని టైప్ చేయండి.', difficultWordPlaceholder: 'పదాన్ని టైప్ చేయండి', btnExplainWord: 'వివరించు', difficultTermModalTitle: 'కష్టమైన పదం', simpleMeaningHeader: '💡 సరళమైన అర్థం:', everydayExampleHeader: '🌟 రోజువారీ ఉదాహరణ:', askLawyerHeader: '🧑‍⚖️ లాయర్‌ను అడగండి:', btnGotIt: 'అర్థమైంది!', factsTitle: 'ముఖ్యాంశాలు మరియు కాలక్రమం', factsSub: 'తేదీలు మరియు వివరాల జాబితా.', keyDatesLabel: 'ముఖ్యమైన తేదీలు', amountsLabel: 'ఆర్థిక వివరాలు', partiesLabel: 'సంబంధిత వ్యక్తులు', obligationsLabel: 'ముఖ్యమైన బాధ్యతలు', timelineTitle: '📅 సంఘటనల కాలక్రమం'
    },
    ta: {
        tagline: 'சட்ட அணுகல் மற்றும் வழக்கு தயாரிப்பு தளம்', demo: 'ஒரு கிளிக் வாடகை ஒப்பந்த டெமோ', language: 'மொழி', deleteAccount: 'கணக்கை நீக்கு', exit: 'வெளியேறு', activeDocument: 'செயலில் உள்ள ஆவணம்', noDocLoaded: 'எந்த ஆவணமும் ஏற்றப்படவில்லை', pendingUpload: 'பதிவேற்றம் நிலுவையில் உள்ளது', navHome: 'முகப்பு', navMyCase: 'என் வழக்கு', legalInfoNoticeTitle: '⚠️ சட்ட தகவல் அறிவிப்பு', legalInfoNoticeDesc: 'LawBuddy AI தயாரிப்பு உதவி வழங்குகிறது.', privacyBanner: '🔒 தனியுரிமை உறுதி: பதிவேற்றப்பட்ட ஆவணங்கள் 3 மணி நேரத்திற்குள் தானாகவே நீக்கப்படும்.', homeHeader: 'உங்களுக்கு என்ன உதவி வேண்டும்?', homeSub: 'சட்ட ஆவணங்களைப் புரிந்துகொள்வது கடினம். நான் எளிமையாக விளக்குகிறேன்.', cardExplainDoc: 'என் ஆவணத்தை விளக்குங்கள்', cardExplainDocSub: 'கோப்பைப் பதிவேற்றவும் அல்லது இணைப்பைச் சேர்க்கவும்', cardLegalQuestion: 'எனக்கு ஒரு சட்டக் கேள்வி உள்ளது', cardLegalQuestionSub: 'என்ன நடந்தது என்று உங்கள் சொந்த வார்த்தைகளில் கூறுங்கள்', cardPhotoNotice: 'நோட்டீஸை படம் எடுங்கள்', cardPhotoNoticeSub: 'நாங்கள் அதைப் படித்து விளக்குவோம்', cardSpeak: 'LawBuddy உடன் பேசுங்கள்', cardSpeakSub: 'உங்கள் மொழியில் பேசுங்கள்', btnMyCase: '📁 என் வழக்கு', btnBackHome: '← முகப்பு', storyTitle: 'என்ன நடந்தது?', storySub: 'சாதாரண வார்த்தைகளைப் பயன்படுத்துங்கள்.', storyPlaceholder: 'உதாரணமாக: வீட்டு உரிமையாளர் நோட்டீஸ் கொடுத்துள்ளார்.', btnSpeakInstead: '🎤 பேசுங்கள்', btnContinue: 'தொடரவும்', listeningText: 'கேட்கிறது…', uploadTitle: 'சட்ட ஆவணத்தைப் பதிவேற்றவும்', uploadDescription: 'நோட்டீஸ்கள், வாடகை ஒப்பந்தங்கள் போன்றவற்றுக்கு ஆதரவு உண்டு.', uploadStep1: '1. ஆவணத்தைப் பதிவேற்றவும்', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR ஆதரவு உண்டு)', browse: 'கோப்புகளைத் தேர்ந்தெடுக்கவும்', loadDemo: '⚡ மாதிரி ஒப்பந்த டெமோ', uploadStep2: '2. உரையை ஒட்டவும்', pastePlaceholder: 'சட்ட உரையை இங்கே ஒட்டவும்...', analyzePasted: 'பகுப்பாய்வு செய்', uploadStep3: '3. இணைப்பை உள்ளிடவும்', linkSub: 'இணைப்பை ஒட்டவும்', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'இணைப்பைப் பகுப்பாய்வு செய்', docSource: 'ஆவண மூலம்:', docTypeLabel: 'ஆவண வகை:', btnAnalyzeDoc: '🚀 பகுப்பாய்வு செய்', textFoundLabel: 'கண்டறியப்பட்ட உரை:', evidenceTitle: '📋 சான்றுகள் மற்றும் விவரங்கள்', evidenceSub: 'உங்கள் ஆவணங்களையும் தேதிகளையும் ஒரே இடத்தில் வைக்கவும்.', evidenceAddPlaceholder: 'ரசீது அல்லது செய்தியைச் சேர்க்கவும்...', btnAddEvidence: '➕ சான்றைச் சேர்', statusFound: 'சான்று கிடைத்தது', statusMissing: 'சான்று இல்லை', statusSuggested: 'பரிந்துரைக்கப்பட்ட சான்று', statusVerification: 'சரிபார்ப்பு தேவை', clarityTitle: 'சட்ட தெளிவு மற்றும் செயல்பாட்டு வரைபடம்', claritySub: 'பொதுவான தகவல்.', showLabel: 'காட்டு:', lvlSimple: '🙂 எளிமையானது', lvlVerySimple: '👶 மிகவும் எளிமையானது', lvlDetails: '⚖️ சட்ட விவரங்கள்', btnReadAloud: '🔊 சத்தமாகப் படி', execSummaryTitle: '📄 ஆவணத்தின் முக்கிய சுருக்கம்', execSummaryPlaceholder: 'பகுப்பாய்வு செய்ய ஆவணத்தைப் பதிவேற்றவும்.', actionUnderstand: '💡 புரிந்துகொள்ளுங்கள்', actionUnderstandDesc: 'எளிமையான சுருக்கம்', actionIdentify: '⚠️ அடையாளம் காணுங்கள்', actionIdentifyDesc: 'கெடு தேதிகள் மற்றும் பொறுப்புகள்', actionPrepare: '📝 தயாராகுங்கள்', actionPrepareDesc: 'வழக்கறிஞரிடம் கேட்க வேண்டிய கேள்விகள்', actionNavigate: '🧭 வழிகாட்டுதல்', actionNavigateDesc: 'அடுத்த கட்ட நடவடிக்கைகள்', difficultWordTitle: 'கடினமான வார்த்தையின் பொருள் என்ன?', difficultWordSub: 'ஒரு வார்த்தையை தட்டச்சு செய்யவும்.', difficultWordPlaceholder: 'வார்த்தையை தட்டச்சு செய்', btnExplainWord: 'விளக்கு', difficultTermModalTitle: 'கடினமான வார்த்தை', simpleMeaningHeader: '💡 எளிய பொருள்:', everydayExampleHeader: '🌟 அன்றாட உதாரணம்:', askLawyerHeader: '🧑‍⚖️ வழக்கறிஞரிடம் கேளுங்கள்:', btnGotIt: 'புரிந்தது!', factsTitle: 'முக்கிய விவரங்கள் மற்றும் காலவரிசை', factsSub: 'தேதிகள் மற்றும் தொகைகளின் பட்டியல்.', keyDatesLabel: 'முக்கிய தேதிகள்', amountsLabel: 'நிதி விவரங்கள்', partiesLabel: 'தொடர்புடைய நபர்கள்', obligationsLabel: 'முக்கிய கடமைகள்', timelineTitle: '📅 நிகழ்வுகளின் காலவரிசை'
    },
    mr: {
        tagline: 'कायदेशीर प्रवेश आणि केस तयारी मंच', demo: 'एक क्लिक नमुना करार डेमो', language: 'भाषा', deleteAccount: 'खाते हटवा', exit: 'बाहेर पडा', activeDocument: 'सक्रिय दस्तऐवज', noDocLoaded: 'कोणताही दस्तऐवज लोड केलेला नाही', pendingUpload: 'अपलोड प्रलंबित', navHome: 'मुख्यपृष्ठ', navMyCase: 'माझी केस', legalInfoNoticeTitle: '⚠️ कायदेशीर माहिती सूचना', legalInfoNoticeDesc: 'LawBuddy AI तयारीसाठी मदत करते.', privacyBanner: '🔒 गोपनीयता हमी: अपलोड केलेले दस्तऐवज 3 तासांच्या आत हटवले जातात.', homeHeader: 'तुम्हाला कशात मदत हवी आहे?', homeSub: 'कायदेशीर कागदपत्रे समजणे कठीण असते. मी समजावून सांगतो.', cardExplainDoc: 'माझे कागदपत्र समजावून सांगा', cardExplainDocSub: 'फाइल अपलोड करा किंवा लिंक जोडा', cardLegalQuestion: 'माझा कायदेशीर प्रश्न आहे', cardLegalQuestionSub: 'काय घडले ते तुमच्या शब्दांत सांगा', cardPhotoNotice: 'नोटीसचा फोटो घ्या', cardPhotoNoticeSub: 'आम्ही वाचून समजावून सांगू', cardSpeak: 'LawBuddy शी बोला', cardSpeakSub: 'तुमच्या भाषेत बोला', btnMyCase: '📁 माझी केस', btnBackHome: '← मुख्यपृष्ठ', storyTitle: 'काय घडले होते?', storySub: 'सामान्य शब्दांचा वापर करा.', storyPlaceholder: 'उदाहरणार्थ: घरमालकाने नोटीस दिली आहे.', btnSpeakInstead: '🎤 बोला', btnContinue: 'पुढे जा', listeningText: 'ऐकत आहे…', uploadTitle: 'कायदेशीर दस्तऐवज अपलोड करा', uploadDescription: 'नोटीस, भाडे करार इत्यादींना पाठिंबा आहे.', uploadStep1: '1. दस्तऐवज अपलोड करा', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR उपलब्ध)', browse: 'फाइली निवडा', loadDemo: '⚡ नमुना करार डेमो', uploadStep2: '2. मजकूर पेस्ट करा', pastePlaceholder: 'कायदेशीर मजकूर येथे पेस्ट करा...', analyzePasted: 'विश्लेषण करा', uploadStep3: '3. लिंक टाका', linkSub: 'वेब लिंक पेस्ट करा', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'विश्लेषण करा', docSource: 'स्रोत:', docTypeLabel: 'प्रकार:', btnAnalyzeDoc: '🚀 विश्लेषण करा', textFoundLabel: 'मजकूर:', evidenceTitle: '📋 पुरावे आणि तपशील', evidenceSub: 'तुमची कागदपत्रे एका ठिकाणी ठेवा.', evidenceAddPlaceholder: 'पावती किंवा संदेश जोडा...', btnAddEvidence: '➕ पुरावा जोडा', statusFound: 'पुरावा मिळाला', statusMissing: 'पुरावा नाही', statusSuggested: 'सुचवलेला पुरावा', statusVerification: 'सत्यापन आवश्यक', clarityTitle: 'कायदेशीर स्पष्टता आणि कृती नकाशा', claritySub: 'सामान्य माहिती.', showLabel: 'दाखवा:', lvlSimple: '🙂 सोपे', lvlVerySimple: '👶 अत्यंत सोपे', lvlDetails: '⚖️ कायदेशीर तपशील', btnReadAloud: '🔊 मोठ्याने वाचा', execSummaryTitle: '📄 मुख्य सारांश', execSummaryPlaceholder: 'दस्तऐवज अपलोड करा.', actionUnderstand: '💡 समजून घ्या', actionUnderstandDesc: 'सोपा सारांश', actionIdentify: '⚠️ ओळखा', actionIdentifyDesc: 'तारखा आणि मुदत', actionPrepare: '📝 तयारी करा', actionPrepareDesc: 'वकिलांना विचारायचे प्रश्न', actionNavigate: '🧭 मार्गदर्शन', actionNavigateDesc: 'पुढील पायऱ्या', difficultWordTitle: 'कठीण शब्दाचा अर्थ काय?', difficultWordSub: 'शब्द टाईप करा.', difficultWordPlaceholder: 'शब्द टाईप करा', btnExplainWord: 'स्पष्टीकरण द्या', difficultTermModalTitle: 'कठीण शब्द', simpleMeaningHeader: '💡 सोपा अर्थ:', everydayExampleHeader: '🌟 दैनंदिन उदाहरण:', askLawyerHeader: '🧑‍⚖️ वकिलांना विचारायचा प्रश्न:', btnGotIt: 'समजले!', factsTitle: 'महत्त्वाचे मुद्दे आणि कालक्रम', factsSub: 'तारखांची यादी.', keyDatesLabel: 'महत्त्वाच्या तारखा', amountsLabel: 'आर्थिक तपशील', partiesLabel: 'संबंधित व्यक्ती', obligationsLabel: 'मुख्य जबाबदाऱ्या', timelineTitle: '📅 घटनांचा कालक्रम'
    },
    gu: {
        tagline: 'કાનૂની ઍક્સેસ અને કેસ તૈયારી પ્લેટફોર્મ', demo: 'એક કાનૂની ભાડા કરાર ડેમો', language: 'ભાષા', deleteAccount: 'એકાઉન્ટ કાઢી નાખો', exit: 'બહાર નીકળો', activeDocument: 'સક્રિય દસ્તાવેજ', noDocLoaded: 'કોઈ દસ્તાવેજ લોડ નથી', pendingUpload: 'અપલોડ બાકી', navHome: 'હોમ', navMyCase: 'મારો કેસ', legalInfoNoticeTitle: '⚠️ કાનૂની માહિતી સૂચના', legalInfoNoticeDesc: 'LawBuddy AI તૈયારી માટે મદદ કરે છે.', privacyBanner: '🔒 ગોપનીયતા ગેરેંટી: અપલોડ કરેલા દસ્તાવેજો 3 કલાકમાં કાઢી નાખવામાં આવે છે.', homeHeader: 'તમને શેમાં મદદ જોઈએ છે?', homeSub: 'કાનૂની દસ્તાવેજો સમજવા મુશ્કેલ હોય છે. હું સરળતાથી સમજાવીશ.', cardExplainDoc: 'મારો દસ્તાવેજ સમજાવો', cardExplainDocSub: 'ફાઇલ અપલોડ કરો અથવા લિંક ઉમેરો', cardLegalQuestion: 'મારો કાનૂની પ્રશ્ન છે', cardLegalQuestionSub: 'શું થયું તે તમારા શબ્દોમાં કહો', cardPhotoNotice: 'નોટિસનો ફોટો લો', cardPhotoNoticeSub: 'અમે વાંચીને સમજાવીશું', cardSpeak: 'LawBuddy સાથે વાત કરો', cardSpeakSub: 'તમારી ભાષામાં બોલો', btnMyCase: '📁 મારો કેસ', btnBackHome: '← હોમ', storyTitle: 'શું થયું હતું?', storySub: 'સામાન્ય શબ્દોનો ઉપયોગ કરો.', storyPlaceholder: 'ઉદાહરણ તરીકે: મકાનમાલિકે નોટિસ આપી છે.', btnSpeakInstead: '🎤 બોલો', btnContinue: 'આગળ વધો', listeningText: 'સાંભળી રહ્યા છીએ…', uploadTitle: 'કાનૂની દસ્તાવેજ અપલોડ કરો', uploadDescription: 'નોટિસ, કરાર વગેરેને સપોર્ટ કરે છે.', uploadStep1: '1. દસ્તાવેજ અપલોડ કરો', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR ઉપલબ્ધ)', browse: 'ફાઇલો પસંદ કરો', loadDemo: '⚡ નમૂના કરાર ડેમો', uploadStep2: '2. લખાણ પેસ્ટ કરો', pastePlaceholder: 'કાનૂની લખાણ અહીં પેસ્ટ કરો...', analyzePasted: 'વિશ્લેષણ કરો', uploadStep3: '3. લિંક દાખલ કરો', linkSub: 'વેબ લિંક પેસ્ટ કરો', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'વિશ્લેષણ કરો', docSource: 'સ્ત્રોત:', docTypeLabel: 'પ્રકાર:', btnAnalyzeDoc: '🚀 વિશ્લેષણ કરો', textFoundLabel: 'મળે લખાણ:', evidenceTitle: '📋 પુરાવા અને વિગતો', evidenceSub: 'તમારા દસ્તાવેજો એક જગ્યાએ રાખો.', evidenceAddPlaceholder: 'રસીદ અથવા સંદેશ ઉમેરો...', btnAddEvidence: '➕ પુરાવો ઉમેરો', statusFound: 'પુરાવો મળ્યો', statusMissing: 'પુરાવો નથી', statusSuggested: 'સૂચવેલ પુરાવો', statusVerification: 'ચકાસણી જરૂરી', clarityTitle: 'કાનૂની સ્પષ્ટતા અને નકશો', claritySub: 'સામાન્ય માહિતી.', showLabel: 'બતાવો:', lvlSimple: '🙂 સરળ', lvlVerySimple: '👶 ખૂબ સરળ', lvlDetails: '⚖️ કાનૂની વિગતો', btnReadAloud: '🔊 મોટેથી વાંચો', execSummaryTitle: '📄 મુખ્ય સારાંશ', execSummaryPlaceholder: 'દસ્તાવેજ અપલોડ કરો.', actionUnderstand: '💡 સમજો', actionUnderstandDesc: 'સરળ સારાંશ', actionIdentify: '⚠️ ઓળખો', actionIdentifyDesc: 'તારીખો અને મુદત', actionPrepare: '📝 તૈયારી કરો', actionPrepareDesc: 'વકીલને પૂછવાના પ્રશ્નો', actionNavigate: '🧭 માર્ગદર્શન', actionNavigateDesc: 'આગળના પગલાં', difficultWordTitle: 'અઘરા શબ્દનો અર્થ શું છે?', difficultWordSub: 'શબ્દ ટાઇપ કરો.', difficultWordPlaceholder: 'શબ્દ ટાઇપ કરો', btnExplainWord: 'સ્પષ્ટતા કરો', difficultTermModalTitle: 'અઘરો શબ્દ', simpleMeaningHeader: '💡 સરળ અર્થ:', everydayExampleHeader: '🌟 દૈનિક ઉદાહરણ:', askLawyerHeader: '🧑‍⚖️ વકીલને પૂછો:', btnGotIt: 'સમજાઈ ગયું!', factsTitle: 'મુખ્ય તથ્યો અને સમયરેખા', factsSub: 'તારીખોની યાદી.', keyDatesLabel: 'મુખ્ય તારીખો', amountsLabel: 'નાણાકીય વિગતો', partiesLabel: 'સંબંધિત વ્યક્તિઓ', obligationsLabel: 'મુખ્ય જવાબદારીઓ', timelineTitle: '📅 ઘટનાઓની સમયરેખા'
    },
    bn: {
        tagline: 'আইনি প্রবেশাধিকার ও মামলা প্রস্তুতির প্ল্যাটফর্ম', demo: 'এক ক্লিকে চুক্তি ডেমো', language: 'ভাষা', deleteAccount: 'অ্যাকাউন্ট মুছুন', exit: 'প্রস্থান', activeDocument: 'সক্রিয় নথি', noDocLoaded: 'কোনো নথি লোড করা হয়নি', pendingUpload: 'আপলোড মুলতুবি', navHome: 'হোম', navMyCase: 'আমার কেস', legalInfoNoticeTitle: '⚠️ আইনি তথ্যের বিজ্ঞপ্তি', legalInfoNoticeDesc: 'LawBuddy AI প্রস্তুতিতে সাহায্য করে।', privacyBanner: '🔒 গোপনীয়তার নিশ্চয়তা: আপলোড করা নথি ৩ ঘণ্টার মধ্যে মুছে ফেলা হয়।', homeHeader: 'আপনার কিসে সাহায্য প্রয়োজন?', homeSub: 'আইনি নথি বোঝা কঠিন হতে পারে। আমি সহজভাবে বুঝিয়ে দেব।', cardExplainDoc: 'আমার নথি ব্যাখ্যা করুন', cardExplainDocSub: 'ফাইল আপলোড করুন বা লিংক যোগ করুন', cardLegalQuestion: 'আমার একটি আইনি প্রশ্ন আছে', cardLegalQuestionSub: 'কী ঘটেছে তা নিজের ভাষায় বলুন', cardPhotoNotice: 'নোটিশের ছবি তুলুন', cardPhotoNoticeSub: 'আমরা পড়ে বুঝিয়ে দেব', cardSpeak: 'LawBuddy-র সাথে কথা বলুন', cardSpeakSub: 'আপনার ভাষায় কথা বলুন', btnMyCase: '📁 আমার কেস', btnBackHome: '← হোম', storyTitle: 'কী ঘটেছিল?', storySub: 'সাধারণ শব্দ ব্যবহার করুন।', storyPlaceholder: 'উদাহরণস্বরূপ: বাড়িওয়ালা নোটিশ দিয়েছেন।', btnSpeakInstead: '🎤 কথা বলুন', btnContinue: 'এগিয়ে যান', listeningText: 'শুনছি…', uploadTitle: 'আইনি নথি আপলোড করুন', uploadDescription: 'নোটিশ, চুক্তি ইত্যাদিতে সমর্থন করে।', uploadStep1: '1. নথি আপলোড করুন', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR সমর্থিত)', browse: 'ফাইল নির্বাচন করুন', loadDemo: '⚡ নমুনা চুক্তি লোড করুন', uploadStep2: '2. লেখা পেস্ট করুন', pastePlaceholder: 'আইনি লেখা এখানে পেস্ট করুন...', analyzePasted: 'বিশ্লেষণ করুন', uploadStep3: '3. লিংক দিন', linkSub: 'ওয়েব লিংক পেস্ট করুন', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'বিশ্লেষণ করুন', docSource: 'উৎস:', docTypeLabel: 'প্রকার:', btnAnalyzeDoc: '🚀 বিশ্লেষণ করুন', textFoundLabel: 'প্রাপ্ত লেখা:', evidenceTitle: '📋 প্রমাণ ও বিস্তারিত', evidenceSub: 'আপনার নথি এক জায়গায় রাখুন।', evidenceAddPlaceholder: 'রসিদ বা বার্তা যোগ করুন...', btnAddEvidence: '➕ প্রমাণ যোগ করুন', statusFound: 'প্রমাণ পাওয়া গেছে', statusMissing: 'প্রমাণ নেই', statusSuggested: 'প্রস্তাবিত প্রমাণ', statusVerification: 'যাচাই প্রয়োজন', clarityTitle: 'আইনি স্পষ্টতা ও অ্যাকশন ম্যাপ', claritySub: 'সাধারণ তথ্য।', showLabel: 'দেখান:', lvlSimple: '🙂 সহজ', lvlVerySimple: '👶 অত্যন্ত সহজ', lvlDetails: '⚖️ আইনি বিবরণ', btnReadAloud: '🔊 জোরে পড়ুন', execSummaryTitle: '📄 মূল সারাংশ', execSummaryPlaceholder: 'নথি আপলোড করুন।', actionUnderstand: '💡 বুঝুন', actionUnderstandDesc: 'সহজ সারাংশ', actionIdentify: '⚠️ চিহ্নিত করুন', actionIdentifyDesc: 'তারিখ ও সময়সীমা', actionPrepare: '📝 প্রস্তুত হন', actionPrepareDesc: 'উকিলকে জিজ্ঞাসা করার প্রশ্নাবলী', actionNavigate: '🧭 দিকনির্দেশনা', actionNavigateDesc: 'পরবর্তী পদক্ষেপ', difficultWordTitle: 'কঠিন শব্দের অর্থ কী?', difficultWordSub: 'একটি শব্দ টাইপ করুন।', difficultWordPlaceholder: 'শব্দ টাইপ করুন', btnExplainWord: 'ব্যাখ্যা করুন', difficultTermModalTitle: 'কঠিন শব্দ', simpleMeaningHeader: '💡 সহজ অর্থ:', everydayExampleHeader: '🌟 দৈনিক উদাহরণ:', askLawyerHeader: '🧑‍⚖️ উকিলকে জিজ্ঞাসা করুন:', btnGotIt: 'বুঝেছি!', factsTitle: 'মূল তথ্য ও ঘটনাক্রম', factsSub: 'তারিখের তালিকা।', keyDatesLabel: 'মূল তারিখ', amountsLabel: 'আর্থিক তথ্য', partiesLabel: 'সংশ্লিষ্ট ব্যক্তি', obligationsLabel: 'মূল দায়িত্ব', timelineTitle: '📅 ঘটনাক্রম'
    },
    tulu: {
        tagline: 'ಕಾನೂನು ಸಹಾಯೊ ಬೊಕ್ಕ ಕೇಸ್ ತಯಾರಿ ವೇದಿಕೆ', demo: 'ಒಂಜಿ ಕ್ಲಿಕ್ ಒಪ್ಪಂದ ಡೆಮೊ', language: 'ಬಾಸೆ', deleteAccount: 'ಖಾತೆ ದೆಪ್ಪುಲೆ', exit: 'ಪೊಲೆ', activeDocument: 'ಸಕ್ರಿಯ ದಾಖಲೆ', noDocLoaded: 'ದಾಖಲೆ ಪಾಡ್‌ಯಿಜ್ಜ', pendingUpload: 'ಅಪ್‌ಲೋಡ್ ಬಾಕಿ ಉಂಡು', navHome: 'ಇಲ್ಲ್', navMyCase: 'ಎನ್ನ ಕೇಸ್', legalInfoNoticeTitle: '⚠️ ಕಾನೂನು ಮಾಹಿತಿ', legalInfoNoticeDesc: 'LawBuddy AI ಸಿದ್ಧತೆಗ್ ಸಹಾಯ ಮಲ್ಪುಂಡು.', privacyBanner: '🔒 ಗೌಪ್ಯತೆ ಭರವಸೆ: ದಾಖಲೆಲು 3 ಗಂಟೆಡ್ ಅಳಿಸಾವೊಡು.', homeHeader: 'ಈರೆಗ್ ದಾದ ಸಹಾಯೊ ಬೇಕು?', homeSub: 'ಕಾನೂನು ದಾಖಲೆ ಅರ್ಥ ಮಲ್ಪೆರೆ ಕಷ್ಟ. ಯಾನ್ ಸುಲಭವಾದ್ ಪನ್ಪೆ.', cardExplainDoc: 'ಎನ್ನ ದಾಖಲೆ ಅರ್ಥ ಮಲ್ಪುಲೆ', cardExplainDocSub: 'ಫೈಲ್ ಪಾಡುಲೆ ಅತ್ತ್ಂಡ ಲಿಂಕ್ ಪಾಡುಲೆ', cardLegalQuestion: 'ಎನ್ನ ಕಾನೂನು ಪ್ರಶ್ನೆ ಉಂಡು', cardLegalQuestionSub: 'ದಾದ ಆಂಡ್ ಪನ್ಲೆ', cardPhotoNotice: 'ನೋಟಿಸ್‌ದ ಫೋಟೋ ದೆಪ್ಪುಲೆ', cardPhotoNoticeSub: 'ನಾವು ಓದಿ ಪನ್ಪೆ', cardSpeak: 'LawBuddy ಒಟ್ಟುಗು ಪಾತೆರ್ಲೆ', cardSpeakSub: 'ಈರೆನ ಬಾಸೆಡ್ ಪಾತೆರ್ಲೆ', btnMyCase: '📁 ಎನ್ನ ಕೇಸ್', btnBackHome: '← ಪಿರ ಪೋಲೆ', storyTitle: 'ದಾದ ಆಂಡ್?', storySub: 'ಸಾಮಾನ್ಯ ಪಠ್ಯ ಪಾಡುಲೆ.', storyPlaceholder: 'ಉದಾಹರಣೆಗೆ: ಮನೆಮಾಲೀಕೆರ್ ನೋಟಿಸ್ ಕೊರ್ತೆರ್.', btnSpeakInstead: '🎤 ಪಾತೆರ್ಲೆ', btnContinue: 'ಮುಂದುವರಿಲೆ', listeningText: 'ಕೇನೊಂದು ಉಂಡು…', uploadTitle: 'ಕಾನೂನು ದಾಖಲೆ ಪಾಡುಲೆ', uploadDescription: 'ನೋಟಿಸ್, ಒಪ್ಪಂದ ಮಾತಾ ಪಾಡೊಲಿ.', uploadStep1: '1. ದಾಖಲೆ ಪಾಡುಲೆ', fileSupport: 'PDF, DOCX, TXT, PNG, JPG (OCR ಉಂಡು)', browse: 'ಫೈಲ್ ಆಯ್ಕೆ ಮಲ್ಪುಲೆ', loadDemo: '⚡ ಮಾದರಿ ಒಪ್ಪಂದ ಡೆಮೊ', uploadStep2: '2. ಪಠ್ಯ ಅಂಟಿಸುಲೆ', pastePlaceholder: 'ಪಠ್ಯ ಮುಲ್ಪ ಪಾಡುಲೆ...', analyzePasted: 'ವಿಶ್ಲೇಷಣೆ ಮಲ್ಪುಲೆ', uploadStep3: '3. ಲಿಂಕ್ ಪಾಡುಲೆ', linkSub: 'ಲಿಂಕ್ ಮುಲ್ಪ ಪಾಡುಲೆ', linkPlaceholder: 'https://example.com/legal-notice', btnAnalyzeLink: 'ಲಿಂಕ್ ವಿಶ್ಲೇಷಣೆ ಮಲ್ಪುಲೆ', docSource: 'ಮೂಲ:', docTypeLabel: 'ವಿಧ:', btnAnalyzeDoc: '🚀 ವಿಶ್ಲೇಷಣೆ ಮಲ್ಪುಲೆ', textFoundLabel: 'ತಿಕ್ಕಿನ ಪಠ್ಯ:', evidenceTitle: '📋 ಸಾಕ್ಷಿ ಬೊಕ್ಕ ಮಾಹಿತಿ', evidenceSub: 'ಈರೆನ ದಾಖಲೆಲೆನ್ ಒಂಜೆ ಕೋಡಿಡ್ ದೀಲೆ.', evidenceAddPlaceholder: 'ರಶೀದಿ ಅಥವಾ ಮೆಸೇಜ್ ಪಾಡುಲೆ...', btnAddEvidence: '➕ ಸಾಕ್ಷಿ ಸೇರಿಸುಲೆ', statusFound: 'ಸಾಕ್ಷಿ ಸಿಕ್ಕಿಂಡ್', statusMissing: 'ಸಾಕ್ಷಿ ಇಜ್ಜಿ', statusSuggested: 'ಸೂಚಿಸಿನ ಸಾಕ್ಷಿ', statusVerification: 'ಪರಿಶೀಲನೆ ಬೋಡು', clarityTitle: 'ಕಾನೂನು ಮಾಹಿತಿ ಬೊಕ್ಕ ಸಾರಾಂಶ', claritySub: 'ಸಾಮಾನ್ಯ ಮಾಹಿತಿ.', showLabel: 'ತೋjour:', lvlSimple: '🙂 ಸುಲಭ', lvlVerySimple: '👶 ಮಸ್ತ್ ಸುಲಭ', lvlDetails: '⚖️ ಕಾನೂನು ವಿವರ', btnReadAloud: '🔊 ಜೋರು ಓದುಲೆ', execSummaryTitle: '📄 ಸಾರಾಂಶ', execSummaryPlaceholder: 'ದಾಖಲೆ ಪಾಡ್‌ದ್ ವಿಶ್ಲೇಷಣೆ ಮಲ್ಪುಲೆ.', actionUnderstand: '💡 ಅರ್ಥ ಮಲ್ಪುಲೆ', actionUnderstandDesc: 'ಸುಲಭ ಸಾರಾಂಶ', actionIdentify: '⚠️ ಗುರುತು ಮಲ್ಪುಲೆ', actionIdentifyDesc: 'ದಿನಾಂಕ ಬೊಕ್ಕ ಗಡುವು', actionPrepare: '📝 ಸಿದ್ಧ ಆಲೆ', actionPrepareDesc: 'ವಕೀಲಡ ಕೇನೊಡಾಯಿನ ಪ್ರಶ್ನೆಲು', actionNavigate: '🧭 ಮುಂದುವರಿಲೆ', actionNavigateDesc: 'ದುಂಬುದ ಹೆಜ್ಜೆ', difficultWordTitle: 'ಕಷ್ಟದ ಶಬ್ದದ ಅರ್ಥ ದಾದ?', difficultWordSub: 'ಒಂಜಿ ಶಬ್ದ ಟೈಪ್ ಮಲ್ಪುಲೆ.', difficultWordPlaceholder: 'ಶಬ್ದ ಟೈಪ್ ಮಲ್ಪುಲೆ', btnExplainWord: 'ಅರ್ಥ ಪನ್ಲೆ', difficultTermModalTitle: 'ಕಷ್ಟದ ಶಬ್ದ', simpleMeaningHeader: '💡 ಸುಲಭ ಅರ್ಥ:', everydayExampleHeader: '🌟 ಉದಾಹರಣೆ:', askLawyerHeader: '🧑‍⚖️ ವಕೀಲಡ ಕೇನ್ಲೆ:', btnGotIt: 'ಅರ್ಥ ಆಂಡ್!', factsTitle: 'ಮುಖ್ಯ ಸಂಗತಿಲು', factsSub: 'ದಿನಾಂಕ ಬೊಕ್ಕ ದುಡ್ಡಿನ ಪಟ್ಟಿ.', keyDatesLabel: 'ಮುಖ್ಯ ದಿನಾಂಕ', amountsLabel: 'ದುಡ್ಡಿನ ವಿವರ', partiesLabel: 'ಜನಕುಲು', obligationsLabel: 'ಮುಖ್ಯ ಕೆಲಸ', timelineTitle: '📅 ಘಟನೆ ಪಟ್ಟಿ'
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
    document.documentElement.lang = language === 'tulu' ? 'tcy' : language;

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
    container.innerHTML = `
        <h3>Are you prepared?</h3>
        <p>You're almost ready for a lawyer consultation. Here is what to keep in one place.</p>
        <div class="readiness-grid">
            <div><strong>📄 Documents</strong><span>${checklist.length ? 'Ready to check' : 'Missing'}</span></div>
            <div><strong>🕐 Important dates</strong><span>${dates.length ? 'Ready to check' : 'Missing'}</span></div>
            <div><strong>📋 Things to keep ready</strong><span>${checklist.length ? 'Ready to check' : 'Missing'}</span></div>
            <div><strong>❓ Questions for lawyer</strong><span>${questions.length ? 'Ready' : 'Missing'}</span></div>
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
    alert("Your account session and all temporary document data have been permanently deleted.");
    window.location.href = "login.html";
}
window.deleteAccount = deleteAccount;

