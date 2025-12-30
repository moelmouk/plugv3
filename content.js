// content.js
// Logic for Action Recorder & Player

/* =========================================
   STATE & VARIABLES
   ========================================= */
let isRecording = false;
let recordedActions = [];
let lastActionTime = 0;
let highlightOverlay = null;

/* =========================================
   XPATH UTILITIES
   ========================================= */
function getXPath(element) {
    if (element.id !== '')
        return `//*[@id="${element.id}"]`;

    if (element === document.body)
        return '/html/body';

    let ix = 0;
    const siblings = element.parentNode ? element.parentNode.childNodes : [];

    for (let i = 0; i < siblings.length; i++) {
        const sibling = siblings[i];
        if (sibling === element) {
            const tagName = element.tagName.toLowerCase();
            const pathIndex = (ix + 1);
            // Try to add meaningful attributes to make it robust
            // e.g., name, class (if simplified), type
            let predicate = '';

            // Optimization: if it has a unique name attribute
            if (element.name && document.getElementsByName(element.name).length === 1) {
                return `//${tagName}[@name="${element.name}"]`;
            }

            return getXPath(element.parentNode) + '/' + tagName + '[' + pathIndex + ']';
        }
        if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
            ix++;
        }
    }
    return '';
}

function getElementByXPath(path) {
    return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
}

/* =========================================
   RECORDING ENGINE
   ========================================= */
function startRecording() {
    console.log("Action Recorder: Started");
    isRecording = true;
    recordedActions = [];
    lastActionTime = Date.now();
    addListeners();
    showNotification("Recording Started ⏺️");
}

function stopRecording() {
    console.log("Action Recorder: Stopped");
    isRecording = false;
    removeListeners();
    showNotification("Recording Stopped ⏹️");
    return recordedActions;
}

function recordAction(actionType, target, extraData = {}) {
    if (!isRecording) return;

    const now = Date.now();
    const delay = recordedActions.length === 0 ? 0 : now - lastActionTime;
    lastActionTime = now;

    const xpath = getXPath(target);
    const action = {
        type: actionType,
        xpath: xpath,
        delay: delay,
        ...extraData
    };

    // De-bounce input recording: update last action if it was also input on same element
    if (actionType === 'input') {
        const last = recordedActions[recordedActions.length - 1];
        if (last && last.type === 'input' && last.xpath === xpath) {
            last.value = extraData.value;
            last.delay += delay; // accumulate time
            lastActionTime = now;
            return;
        }
    }

    recordedActions.push(action);
    // Send message but ignore error if popup is closed (Receiver does not exist)
    chrome.runtime.sendMessage({ type: "ACTION_RECORDED", count: recordedActions.length }, () => {
        const ignored = chrome.runtime.lastError;
    });
    console.log("Recorded:", action);

    // Visual feedback
    highlightElement(target, "rgba(255, 0, 0, 0.3)");
}

/* LISTENERS */
const listeners = {
    click: (e) => {
        // Ignore clicks on plugin UI if we inject any (currently we strictly use popup)
        recordAction('click', e.target);
    },
    input: (e) => {
        recordAction('input', e.target, { value: e.target.value });
    },
    change: (e) => {
        // Useful for Selects, Radio, Checkbox
        if (e.target.tagName === 'SELECT') {
            recordAction('select', e.target, { value: e.target.value });
        } else if (e.target.type === 'checkbox' || e.target.type === 'radio') {
            recordAction('click', e.target); // Usually clicks handle this, but specific state change is good
        }
    },
    keydown: (e) => {
        // Record special keys usually needed for navigation forms
        if (['Enter', 'Tab', 'Escape'].includes(e.key)) {
            recordAction('keydown', e.target, { key: e.key });
        }
    }
};

function addListeners() {
    document.addEventListener('click', listeners.click, true);
    document.addEventListener('input', listeners.input, true);
    document.addEventListener('change', listeners.change, true);
    document.addEventListener('keydown', listeners.keydown, true);
}

function removeListeners() {
    document.removeEventListener('click', listeners.click, true);
    document.removeEventListener('input', listeners.input, true);
    document.removeEventListener('change', listeners.change, true);
    document.removeEventListener('keydown', listeners.keydown, true);
}

/* =========================================
   PLAYBACK ENGINE
   ========================================= */
async function playScenario(scenario) {
    console.log("Action Recorder: Playing scenario", scenario);
    showNotification(`Playing: ${scenario.name} ▶️`);

    for (let i = 0; i < scenario.actions.length; i++) {
        const action = scenario.actions[i];

        // Wait recorded delay
        await new Promise(r => setTimeout(r, action.delay));

        const element = getElementByXPath(action.xpath);
        if (!element) {
            console.warn(`Element not found: ${action.xpath}`);
            showNotification(`⚠️ Element not found step ${i + 1}`);
            continue; // Continue on error as requested
        }

        // Scroll and Highlight
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlightElement(element, "rgba(0, 255, 0, 0.3)");

        try {
            await executeAction(element, action);
        } catch (err) {
            console.error("Error executing action:", err);
        }
    }

    showNotification("Playback Finished ✅");
    removeHighlight();
}

async function executeAction(element, action) {
    switch (action.type) {
        case 'click':
            element.click();
            // Handle native focus for inputs if clicked
            element.focus && element.focus();
            break;

        case 'input':
            const type = element.type;
            // Inputs that must be set atomically to avoid validation errors
            const atomicTypes = ['date', 'datetime-local', 'time', 'month', 'week', 'color', 'range', 'number', 'hidden', 'checkbox', 'radio'];

            if (atomicTypes.includes(type)) {
                element.value = action.value;
                element.dispatchEvent(new Event('input', { bubbles: true }));
                element.dispatchEvent(new Event('change', { bubbles: true }));
            } else if (type === 'file') {
                console.warn("Skipping file input value set (security restriction)");
                // Cannot programmatically set file input value
            } else {
                // Text-like inputs (text, password, email, search, tel, url, etc.): simulate typing
                element.focus();
                element.value = ""; // Clear first
                for (const char of action.value) {
                    element.value += char;
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 10));
                }
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }
            break;

        case 'select':
            element.value = action.value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
            break;

        case 'keydown':
            const keyEvent = new KeyboardEvent('keydown', {
                bubbles: true, cancelable: true, key: action.key, code: action.key
            });
            element.dispatchEvent(keyEvent);
            if (action.key === 'Enter' && element.form) {
                // sometimes explicit submit is needed if enter doesn't trigger it via JS
                // element.form.submit(); // Dangerous if JS handles validation
            }
            break;
    }
}

/* =========================================
   UI HELPERS
   ========================================= */
function showNotification(message) {
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed; top: 20px; right: 20px; 
        background: #333; color: white; padding: 10px 20px; 
        border-radius: 5px; z-index: 999999; font-family: sans-serif;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        animation: fadeInOut 3s ease forwards;
        pointer-events: none;
    `;
    div.textContent = message;

    // Add keyframes if not present
    if (!document.getElementById('ar-anim-style')) {
        const style = document.createElement('style');
        style.id = 'ar-anim-style';
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateY(-10px); }
                10% { opacity: 1; transform: translateY(0); }
                90% { opacity: 1; transform: translateY(0); }
                100% { opacity: 0; transform: translateY(-10px); }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}

function highlightElement(el, color) {
    if (highlightOverlay) highlightOverlay.remove();

    const rect = el.getBoundingClientRect();
    const div = document.createElement('div');
    div.style.cssText = `
        position: fixed;
        left: ${rect.left}px; top: ${rect.top}px;
        width: ${rect.width}px; height: ${rect.height}px;
        background: ${color};
        border: 2px solid ${color.replace('0.3', '1')};
        pointer-events: none;
        z-index: 999998;
        border-radius: 4px;
        transition: all 0.2s;
    `;
    document.body.appendChild(div);
    highlightOverlay = div;
    setTimeout(() => { if (highlightOverlay === div) removeHighlight(); }, 1500); // Auto remove after bit
}

function removeHighlight() {
    if (highlightOverlay) {
        highlightOverlay.remove();
        highlightOverlay = null;
    }
}

/* =========================================
   MESSAGING
   ========================================= */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.command === "START_RECORDING") {
        startRecording();
        sendResponse({ status: "started" });
    } else if (request.command === "STOP_RECORDING") {
        const actions = stopRecording();
        sendResponse({ status: "stopped", actions: actions });
    } else if (request.command === "PLAY_SCENARIO") {
        playScenario(request.scenario);
        sendResponse({ status: "playing" });
    } else if (request.command === "GET_STATUS") {
        sendResponse({
            status: isRecording ? "recording" : "idle",
            count: recordedActions.length
        });
    }
    return true; // async response
});
