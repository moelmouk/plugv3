/* popup.js */

// State
let currentScenario = null;
let savedScenarios = [];
let isRecording = false;

// Elements
const startBtn = document.getElementById('start-record-btn');
const stopBtn = document.getElementById('stop-record-btn');
const counterBadge = document.getElementById('action-counter');
const scenarioList = document.getElementById('scenario-list');

// Modals
const saveModal = document.getElementById('save-modal');
const scenarioNameInput = document.getElementById('scenario-name-input');
const cancelSaveBtn = document.getElementById('cancel-save');
const confirmSaveBtn = document.getElementById('confirm-save');

const editModal = document.getElementById('edit-modal');
const editNameInput = document.getElementById('edit-name-input');
const editActionsList = document.getElementById('edit-actions-list');
const closeEditBtn = document.getElementById('close-edit');
const saveEditBtn = document.getElementById('save-edit');

// Import/Export
const importBtn = document.getElementById('import-btn');
const exportBtn = document.getElementById('export-btn');
const fileInput = document.getElementById('file-input');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadScenarios();
    checkRecordingState();
});

/* ==================
   Event Listeners
   ================== */

startBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    if (!isRecordableUrl(tab.url)) {
        alert("Impossible d'enregistrer sur cette page (Page système ou protégée).");
        return;
    }

    const response = await sendMessageSafe(tab.id, { command: "START_RECORDING" });
    if (response) {
        isRecording = true;
        updateUIState();
    } else {
        alert("Erreur de connexion avec la page. Essayez de la rafraîchir.");
    }
});

stopBtn.addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    try {
        const response = await chrome.tabs.sendMessage(tab.id, { command: "STOP_RECORDING" });
        if (response && response.actions) {
            currentScenario = {
                id: Date.now(),
                name: "Nouveau Scénario",
                createdAt: new Date().toISOString(),
                actions: response.actions
            };
            isRecording = false;
            updateUIState();
            openSaveModal();
        }
    } catch (err) {
        console.error(err);
    }
});

confirmSaveBtn.addEventListener('click', () => {
    const name = scenarioNameInput.value.trim() || `Scenario ${new Date().toLocaleTimeString()}`;
    currentScenario.name = name;

    savedScenarios.push(currentScenario);
    saveToStorage();
    renderScenarios();
    closeModal(saveModal);
    currentScenario = null;
    scenarioNameInput.value = "";
});

cancelSaveBtn.addEventListener('click', () => {
    closeModal(saveModal);
    currentScenario = null;
});

/* Edit Modal */
saveEditBtn.addEventListener('click', () => {
    // If we're editing an existing one
    const id = parseInt(editModal.dataset.editingId);
    const scen = savedScenarios.find(s => s.id === id);
    if (scen) {
        scen.name = editNameInput.value;
        // logic to save modified actions would go here if we implemented full action editor
        saveToStorage();
        renderScenarios();
    }
    closeModal(editModal);
});

closeEditBtn.addEventListener('click', () => closeModal(editModal));

/* Import/Export */
exportBtn.addEventListener('click', () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(savedScenarios));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "scenarios_" + Date.now() + ".json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
});

importBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const imported = JSON.parse(ev.target.result);
            if (Array.isArray(imported)) {
                savedScenarios = [...savedScenarios, ...imported];
                saveToStorage();
                renderScenarios();
                alert("Import réussi!");
            }
        } catch (err) {
            alert("Fichier invalide");
        }
    };
    reader.readAsText(file);
    // Reset val
    fileInput.value = '';
});

/* ==================
   Functions
   ================== */

function updateUIState() {
    if (isRecording) {
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        counterBadge.classList.remove('hidden');
        counterBadge.innerText = "Enregistrement...";
    } else {
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
        counterBadge.classList.add('hidden');
    }
}

function openSaveModal() {
    saveModal.classList.remove('hidden');
}

function closeModal(modal) {
    modal.classList.add('hidden');
}

function saveToStorage() {
    chrome.storage.local.set({ 'scenarios': savedScenarios });
}

function loadScenarios() {
    chrome.storage.local.get(['scenarios'], (result) => {
        if (result.scenarios) {
            savedScenarios = result.scenarios;
            renderScenarios();
        }
    });
}

function renderScenarios() {
    scenarioList.innerHTML = '';
    if (savedScenarios.length === 0) {
        scenarioList.innerHTML = '<div class="empty-state">Aucun scénario. Commencez par enregistrer!</div>';
        return;
    }

    savedScenarios.slice().reverse().forEach(scen => {
        const card = document.createElement('div');
        card.className = 'scenario-card';

        card.innerHTML = `
            <div class="card-header">
                <div>
                    <div class="card-title">${escapeHtml(scen.name)}</div>
                    <div class="card-meta">${scen.actions.length} actions • ${new Date(scen.createdAt).toLocaleDateString()}</div>
                </div>
            </div>
            <div class="card-actions">
                <button class="icon-btn play-btn" data-id="${scen.id}" title="Jouer">▶️ Play</button>
                <button class="icon-btn edit-btn" data-id="${scen.id}" title="Éditer">✏️</button>
                <button class="icon-btn delete-btn" data-id="${scen.id}" title="Supprimer">🗑️</button>
            </div>
        `;

        // Handlers
        card.querySelector('.play-btn').addEventListener('click', () => playScenario(scen.id));
        card.querySelector('.delete-btn').addEventListener('click', () => deleteScenario(scen.id));
        card.querySelector('.edit-btn').addEventListener('click', () => openEditModal(scen.id));

        scenarioList.appendChild(card);
    });
}

async function playScenario(id) {
    const scen = savedScenarios.find(s => s.id === id);
    if (!scen) return;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    // Use safe message to avoid uncaught promise errors if content script missing
    await sendMessageSafe(tab.id, { command: "PLAY_SCENARIO", scenario: scen });
}

function deleteScenario(id) {
    if (confirm("Supprimer ce scénario ?")) {
        savedScenarios = savedScenarios.filter(s => s.id !== id);
        saveToStorage();
        renderScenarios();
    }
}

function openEditModal(id) {
    const scen = savedScenarios.find(s => s.id === id);
    if (!scen) return;

    editNameInput.value = scen.name;
    editModal.dataset.editingId = id;

    // Simple render of actions
    editActionsList.innerHTML = scen.actions.map((a, i) =>
        `<div class="action-row">
            <strong>#${i + 1}</strong> [${a.type}] <span style="color:#666">${a.xpath.substring(0, 30)}...</span>
            ${a.value ? `"${a.value}"` : ''}
            <small>(${a.delay}ms)</small>
         </div>`
    ).join('');

    editModal.classList.remove('hidden');
}

/* Helpers */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function (m) { return map[m]; });
}

// Listen for messages from content script (e.g. updating count)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === "ACTION_RECORDED") {
        if (request.count) {
            counterBadge.innerText = `${request.count} Actions`;
        }
    }
});

/* ==================
   Helpers
   ================== */

function isRecordableUrl(url) {
    return url && (url.startsWith('http') || url.startsWith('file'));
}

async function sendMessageSafe(tabId, message) {
    try {
        return await chrome.tabs.sendMessage(tabId, message);
    } catch (err) {
        // Ignore "Receiving end does not exist" which happens on non-injectable pages
        console.warn("Message sending failed (probably no content script):", err.message);
        return null;
    }
}

async function checkRecordingState() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // Use safe checks
        if (!tab || !isRecordableUrl(tab.url)) {
            // Optional: visual indication that recording is disabled
            return;
        }

        const response = await sendMessageSafe(tab.id, { command: "GET_STATUS" });
        if (response && response.status === "recording") {
            isRecording = true;
            counterBadge.innerText = `${response.count} Actions`;
            updateUIState();
        }
    } catch (e) {
        console.log("Could not check status", e);
    }
}
