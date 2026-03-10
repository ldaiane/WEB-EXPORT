let db;
let allMessages = [];
let mediaCache = new Map();

const request = indexedDB.open("WhatsAppHistoryDB", 10);
request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("messages")) {
        const store = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
        store.createIndex("hash", "hash", { unique: true });
    }
    if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "name" });
};

request.onsuccess = e => { db = e.target.result; loadHistory(); };

async function loadHistory() {
    const tx = db.transaction(["messages", "media"], "readonly");
    const msgs = await new Promise(res => tx.objectStore("messages").getAll().onsuccess = e => res(e.target.result));
    const medias = await new Promise(res => tx.objectStore("media").getAll().onsuccess = e => res(e.target.result));
    
    medias.forEach(m => mediaCache.set(m.name, URL.createObjectURL(m.data)));
    allMessages = msgs.sort((a, b) => a.ts - b.ts);
    document.getElementById("stats").innerText = `(${allMessages.length})`;
    renderMessages(allMessages.slice(-300)); // Renderiza as últimas 300 para ser instantâneo
}

function renderMessages(list) {
    const container = document.getElementById("messages");
    container.innerHTML = "";
    const fragment = document.createDocumentFragment();

    list.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg";
        let mediaHtml = "";
        const fileName = m.text.trim();

        if (mediaCache.has(fileName)) {
            const url = mediaCache.get(fileName);
            if (fileName.match(/\.(jpg|jpeg|png|webp|gif)$/i)) mediaHtml = `<div class="media-container"><img src="${url}" loading="lazy"></div>`;
            else if (fileName.match(/\.(mp4|webm)$/i)) mediaHtml = `<div class="media-container"><video src="${url}" controls></video></div>`;
            else if (fileName.match(/\.(opus|mp3|m4a|ogg)$/i)) mediaHtml = `<audio src="${url}" controls></audio>`;
        }

        div.innerHTML = `<div class="sender">${m.sender}</div><div>${m.text}</div>${mediaHtml}<div class="time">${new Date(m.ts).toLocaleString()}</div>`;
        fragment.appendChild(div);
    });
    container.appendChild(fragment);
    container.scrollTop = container.scrollHeight;
}

const processFiles = async (files) => {
    document.getElementById("loadingBarContainer").style.display = "block";
    const bar = document.getElementById("loadingBar");
    const tx = db.transaction(["messages", "media"], "readwrite");
    const msgStore = tx.objectStore("messages");
    const mediaStore = tx.objectStore("media");

    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        bar.style.width = `${((i + 1) / files.length) * 100}%`;

        if (file.name.endsWith(".zip")) {
            const zip = await JSZip.loadAsync(file);
            for (let name in zip.files) {
                const entry = zip.files[name];
                if (entry.dir) continue;
                const shortName = name.split('/').pop();
                if (name.endsWith(".txt")) parseLines(await entry.async("string"), msgStore);
                else mediaStore.put({ name: shortName, data: await entry.async("blob") });
            }
        } else if (file.name.endsWith(".txt")) {
            parseLines(await file.text(), msgStore);
        } else {
            mediaStore.put({ name: file.name, data: file });
        }
    }
    tx.oncomplete = () => {
        document.getElementById("loadingBarContainer").style.display = "none";
        loadHistory();
    };
};

function parseLines(t, store) {
    const cleanText = t.replace(/[\u200B-\u200D\uFEFF]/g, "");
    const linhas = cleanText.split("\n");
    linhas.forEach(l => {
        const m = l.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),?\s?(\d{1,2}[:\.]\d{2}).*?-\s(.*?):\s(.*)$/);
        if (m) {
            const [_, data, hora, remetente, texto] = m;
            const dParts = data.split(/[\/\-]/);
            const ts = new Date(dParts[2].length === 2 ? "20"+dParts[2] : dParts[2], dParts[1]-1, dParts[0], hora.split(/[:\.]/)[0], hora.split(/[:\.]/)[1]).getTime();
            const hash = `${ts}_${remetente.trim()}_${texto.trim()}`;
            try { store.add({ sender: remetente.trim(), text: texto.trim(), ts: ts, hash: hash }); } catch(e) {}
        }
    });
}

// Eventos
document.getElementById("fileInput").addEventListener("change", e => processFiles(e.target.files));
document.getElementById("folderInput").addEventListener("change", e => processFiles(e.target.files));

function filterMessages() {
    const term = document.getElementById("searchInput").value.toLowerCase();
    const filtered = allMessages.filter(m => m.text.toLowerCase().includes(term));
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
    if (confirm("Apagar tudo?")) {
        indexedDB.deleteDatabase("WhatsAppHistoryDB");
        location.reload();
    }
}
