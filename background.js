// background.js

chrome.runtime.onInstalled.addListener(() => {
    console.log("Action Recorder & Player installed.");
});

// We can handle more complex state here if needed, 
// but for now, the popup orchestrates most things.
