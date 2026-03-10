let db;
let allMessages = [];
let mediaCache = new Map();

// Abre o banco
const request = indexedDB.open("WhatsAppHistoryDB", 60);
request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
    if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "name" });
};
request.onsuccess = e => { db = e.target.result; loadHistory(); };

async function loadHistory() {
    if (!db) return;
    const tx = db.transaction(["messages", "media"], "readonly");
    tx.objectStore("messages").getAll().onsuccess = (e) => {
        allMessages = e.target.result.sort((a, b) => a.ts - b.ts);
        document.getElementById("stats").innerText = `(${allMessages.length})`;
        renderMessages(allMessages.slice(-200));
    };
}

function renderMessages(list) {
    const container = document.getElementById("messages");
    container.innerHTML = "";
    list.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg";
        div.innerHTML = `<div class="sender">${m.sender}</div><div>${m.text}</div><div class="time">${new Date(m.ts).toLocaleString()}</div>`;
        container.appendChild(div);
    });
}

// Processamento Blindado
document.getElementById("fileInput").onchange = async (e) => {
    const files = e.target.files;
    if (!files.length) return;

    const overlay = document.getElementById("loadingOverlay");
    const bar = document.getElementById("progressBar");
    const label = document.getElementById("statusLabel");

    overlay.style.display = "flex";

    for (let file of files) {
        try {
            if (file.name.endsWith(".zip")) {
                const zip = await JSZip.loadAsync(file);
                const entries = Object.keys(zip.files).filter(n => !zip.files[n].dir);
                
                for (let i = 0; i < entries.length; i++) {
                    const name = entries[i];
                    label.innerText = `Lendo: ${name.split('/').pop()}`;
                    bar.style.width = `${((i + 1) / entries.length) * 100}%`;

                    if (name.endsWith(".txt")) {
                        const content = await zip.files[name].async("string");
                        await saveToDB("messages", parseText(content));
                    }
                }
            }
        } catch (err) {
            console.error(err);
            document.getElementById("errorLabel").style.display = "block";
            document.getElementById("errorLabel").innerText = "Erro: " + err.message;
        }
    }
    overlay.style.display = "none";
    loadHistory();
};

function parseText(content) {
    const lines = content.split("\n");
    const regex = /^\[?(\d{2}[\/\-]\d{2}[\/\-]\d{2,4}).*?\]?\s?([^:]+):\s(.+)$/;
    return lines.map(l => {
        const m = l.match(regex);
        return m ? { sender: m[2], text: m[3], ts: Date.now() } : null;
    }).filter(x => x);
}

function saveToDB(storeName, data) {
    return new Promise(resolve => {
        const tx = db.transaction([storeName], "readwrite");
        const store = tx.objectStore(storeName);
        data.forEach(d => store.put(d));
        tx.oncomplete = () => resolve();
    });
}

function clearHistory() {
    indexedDB.deleteDatabase("WhatsAppHistoryDB");
    location.reload();
}
