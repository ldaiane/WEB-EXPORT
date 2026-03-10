let db;
let allMessages = [];
let mediaCache = new Map();

// Abre o banco de dados - Versão 20 para garantir limpeza de bugs antigos
const request = indexedDB.open("WhatsAppHistoryDB", 20);

request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("messages")) {
        const store = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
        store.createIndex("hash", "hash", { unique: true });
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
    
    const msgsReq = tx.objectStore("messages").getAll();
    const mediaReq = tx.objectStore("media").getAll();

    msgsReq.onsuccess = () => {
        allMessages = msgsReq.result.sort((a, b) => a.ts - b.ts);
        document.getElementById("stats").innerText = `(${allMessages.length})`;
        
        mediaReq.onsuccess = () => {
            mediaCache.clear();
            mediaReq.result.forEach(m => {
                const url = URL.createObjectURL(m.data);
                mediaCache.set(m.name, url);
            });
            renderMessages(allMessages.slice(-300));
        };
    };
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

// O segredo está aqui: Transações individuais para evitar o InvalidStateError
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
                const fileNames = Object.keys(zip.files);

                for (let name of fileNames) {
                    const entry = zip.files[name];
                    if (entry.dir) continue;
                    const shortName = name.split('/').pop();

                    if (name.endsWith(".txt")) {
                        const content = await entry.async("string");
                        await saveMessages(content); // Abre transação própria
                    } else {
                        const blob = await entry.async("blob");
                        await saveMedia(shortName, blob); // Abre transação própria
                    }
                }
            } else if (file.name.endsWith(".txt")) {
                const content = await file.text();
                await saveMessages(content);
            } else {
                await saveMedia(file.name, file);
            }
        } catch (err) {
            console.error("Erro crítico no arquivo:", file.name, err);
        }
    }
    
    document.getElementById("loadingBarContainer").style.display = "none";
    loadHistory();
};

// Salva mensagens em uma transação isolada
function saveMessages(content) {
    return new Promise((resolve) => {
        const tx = db.transaction("messages", "readwrite");
        const store = tx.objectStore("messages");
        const linhas = content.replace(/[\u200B-\u200D\uFEFF]/g, "").split("\n");
        const regex = /^\[?(\d{1,4}[\/\-]\d{1,2}[\/\-]\d{1,4})[,\s]+(\d{1,2}[:\.]\d{2}(?::\d{2})?)\]?\s?[\-]?\s?([^:]+):\s(.+)$/;

        linhas.forEach(l => {
            const match = l.match(regex);
            if (match) {
                const [_, data, hora, remetente, texto] = match;
                const dParts = data.split(/[\/\-]/);
                let ano = dParts[2].length === 2 ? "20" + dParts[2] : dParts[2];
                if (dParts[0].length === 4) ano = dParts[0];
                const dia = dParts[0].length === 4 ? dParts[2] : dParts[0];
                const mes = dParts[1];
                const ts = new Date(ano, mes - 1, dia, hora.split(/[:\.]/)[0], hora.split(/[:\.]/)[1]).getTime();
                const hash = `${ts}_${remetente.trim()}_${texto.trim()}`;
                
                try { store.add({ sender: remetente.trim(), text: texto.trim(), ts: ts || Date.now(), hash: hash }); } catch(e) {}
            }
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

// Salva mídia em uma transação isolada
function saveMedia(name, data) {
    return new Promise((resolve) => {
        const tx = db.transaction("media", "readwrite");
        const store = tx.objectStore("media");
        store.put({ name: name, data: data });
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
    });
}

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
    if (confirm("Apagar todos os dados?")) {
        indexedDB.deleteDatabase("WhatsAppHistoryDB");
        location.reload();
    }
}
