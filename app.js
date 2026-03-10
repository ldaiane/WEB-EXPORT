let db;
let allMessages = [];
let mediaCache = new Map();

// Abre o banco de dados
const request = indexedDB.open("WhatsAppHistoryDB", 15); // Versão aumentada para forçar atualização

request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("messages")) {
        const store = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
        store.createIndex("hash", "hash", { unique: true });
        store.createIndex("ts", "ts", { unique: false });
    }
    if (!db.objectStoreNames.contains("media")) {
        db.createObjectStore("media", { keyPath: "name" });
    }
};

request.onsuccess = e => {
    db = e.target.result;
    loadHistory();
};

async function loadHistory() {
    if (!db) return;
    const tx = db.transaction(["messages", "media"], "readonly");
    const msgStore = tx.objectStore("messages");
    const mediaStore = tx.objectStore("media");

    const msgs = await new Promise(res => {
        msgStore.getAll().onsuccess = e => res(e.target.result);
    });
    
    const medias = await new Promise(res => {
        mediaStore.getAll().onsuccess = e => res(e.target.result);
    });

    mediaCache.clear();
    medias.forEach(m => {
        const url = URL.createObjectURL(m.data);
        mediaCache.set(m.name, url);
    });

    allMessages = msgs.sort((a, b) => a.ts - b.ts);
    document.getElementById("stats").innerText = `(${allMessages.length})`;
    renderMessages(allMessages.slice(-300));
}

function renderMessages(list) {
    const container = document.getElementById("messages");
    container.innerHTML = "";
    const fragment = document.createDocumentFragment();

    list.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg";
        
        let mediaHtml = "";
        const textTrim = m.text.trim();
        
        // Tenta achar a mídia pelo nome exato no texto
        if (mediaCache.has(textTrim)) {
            const url = mediaCache.get(textTrim);
            if (textTrim.match(/\.(jpg|jpeg|png|webp|gif)$/i)) mediaHtml = `<div class="media-container"><img src="${url}" loading="lazy"></div>`;
            else if (textTrim.match(/\.(mp4|webm)$/i)) mediaHtml = `<div class="media-container"><video src="${url}" controls></video></div>`;
            else if (textTrim.match(/\.(opus|mp3|m4a|ogg|wav)$/i)) mediaHtml = `<audio src="${url}" controls></audio>`;
        }

        div.innerHTML = `<div class="sender">${m.sender}</div><div>${m.text}</div>${mediaHtml}<div class="time">${new Date(m.ts).toLocaleString()}</div>`;
        fragment.appendChild(div);
    });
    
    container.appendChild(fragment);
    container.scrollTop = container.scrollHeight;
}

const processFiles = async (files) => {
    if (!files.length) return;
    document.getElementById("loadingBarContainer").style.display = "block";
    const bar = document.getElementById("loadingBar");

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        bar.style.width = `${((i + 1) / files.length) * 100}%`;

        try {
            if (file.name.endsWith(".zip")) {
                const zip = await JSZip.loadAsync(file);
                const tx = db.transaction(["messages", "media"], "readwrite");
                for (let name in zip.files) {
                    const entry = zip.files[name];
                    if (entry.dir) continue;
                    const shortName = name.split('/').pop();
                    if (name.endsWith(".txt")) {
                        const content = await entry.async("string");
                        parseLines(content, tx.objectStore("messages"));
                    } else {
                        const blob = await entry.async("blob");
                        tx.objectStore("media").put({ name: shortName, data: blob });
                    }
                }
            } else if (file.name.endsWith(".txt")) {
                const content = await file.text();
                const tx = db.transaction("messages", "readwrite");
                parseLines(content, tx.objectStore("messages"));
            } else {
                const tx = db.transaction("media", "readwrite");
                tx.objectStore("media").put({ name: file.name, data: file });
            }
        } catch (err) {
            console.error("Erro ao processar:", file.name, err);
        }
    }
    
    setTimeout(() => {
        document.getElementById("loadingBarContainer").style.display = "none";
        loadHistory();
    }, 500);
};

function parseLines(t, store) {
    const cleanText = t.replace(/[\u200B-\u200D\uFEFF]/g, "");
    const linhas = cleanText.split("\n");
    
    // REGEX UNIVERSAL: Suporta [00/00/00 00:00] ou 00/00/00, 00:00 - Nome: Texto
    const regex = /^\[?(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4})[,\s]+(\d{1,2}[:\.]\d{2}(?::\d{2})?)\]?\s?[\-]?\s?([^:]+):\s(.+)$/;

    linhas.forEach(l => {
        const match = l.match(regex);
        if (match) {
            const [_, data, hora, remetente, texto] = match;
            const dParts = data.split(/[\/\-]/);
            
            // Ajuste de ano (24 -> 2024)
            let ano = dParts[2].length === 2 ? "20" + dParts[2] : dParts[2];
            if (dParts[0].length === 4) ano = dParts[0]; // Caso seja YYYY/MM/DD
            
            const dia = dParts[0].length === 4 ? dParts[2] : dParts[0];
            const mes = dParts[1];

            const ts = new Date(ano, mes - 1, dia, hora.split(/[:\.]/)[0], hora.split(/[:\.]/)[1]).getTime();
            const hash = `${ts}_${remetente.trim()}_${texto.trim()}`;

            try {
                store.add({ 
                    sender: remetente.trim(), 
                    text: texto.trim(), 
                    ts: isNaN(ts) ? Date.now() : ts, 
                    hash: hash 
                });
            } catch(e) {
                // Duplicado, apenas ignora
            }
        }
    });
}

// Listeners
document.getElementById("fileInput").addEventListener("change", e => processFiles(e.target.files));
document.getElementById("folderInput").addEventListener("change", e => processFiles(e.target.files));

function filterMessages() {
    const term = document.getElementById("searchInput").value.toLowerCase();
    const filtered = allMessages.filter(m => m.text.toLowerCase().includes(term) || m.sender.toLowerCase().includes(term));
    renderMessages(filtered.slice(-500));
}

function filterByDate() {
    const val = document.getElementById("dateFilter").value;
    if (!val) return;
    const start = new Date(val + "T00:00:00").getTime();
    const end = start + 86400000;
    renderMessages(allMessages.filter(m => m.ts >= start && m.ts < end));
}

function clearHistory() {
    if (confirm("Isso apagará todos os 20GB de dados. Confirmar?")) {
        const tx = db.transaction(["messages", "media"], "readwrite");
        tx.objectStore("messages").clear();
        tx.objectStore("media").clear();
        tx.oncomplete = () => location.reload();
    }
}
