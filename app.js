let db;
let allMessages = [];

// Garante que o navegador não apague os dados por falta de espaço
if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist();
}

const request = indexedDB.open("WhatsAppHistoryDB", 6);

request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("messages")) {
        const msgStore = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
        msgStore.createIndex("hash", "hash", { unique: true });
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
    const transaction = db.transaction(["messages"], "readonly");
    const store = transaction.objectStore("messages");
    const req = store.getAll();

    req.onsuccess = () => {
        allMessages = req.result.sort((a, b) => a.ts - b.ts);
        document.getElementById("stats").innerText = `(${allMessages.length} mensagens)`;
        renderMessages(allMessages.slice(-500)); // Mostra as 500 mais recentes por padrão
    };
}

function renderMessages(list) {
    const container = document.getElementById("messages");
    container.innerHTML = "";
    if (list.length === 0) return;

    const fragment = document.createDocumentFragment();
    list.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg";
        
        let mediaPlaceholder = "";
        // Detecta se a mensagem é um nome de arquivo de mídia
        if (m.text.match(/\.(jpg|jpeg|png|webp|gif|mp4|opus|mp3|m4a|ogg)$/i)) {
            mediaPlaceholder = `<div id="media-container-${m.id}">
                <button class="media-btn" onclick="loadMedia('${m.text.trim()}', ${m.id})">📁 Carregar Mídia</button>
            </div>`;
        }

        div.innerHTML = `
            <div class="sender">${m.sender}</div>
            <div>${m.text}</div>
            ${mediaPlaceholder}
            <div class="time">${new Date(m.ts).toLocaleString()}</div>
        `;
        fragment.appendChild(div);
    });
    container.appendChild(fragment);
    container.scrollTop = container.scrollHeight;
}

async function loadMedia(fileName, msgId) {
    const tx = db.transaction("media", "readonly");
    const req = tx.objectStore("media").get(fileName);
    const container = document.getElementById(`media-container-${msgId}`);

    req.onsuccess = () => {
        if (req.result) {
            const url = URL.createObjectURL(req.result.data);
            if (fileName.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
                container.innerHTML = `<div class="media-content"><img src="${url}"></div>`;
            } else if (fileName.match(/\.(mp4|webm)$/i)) {
                container.innerHTML = `<div class="media-content"><video src="${url}" controls></video></div>`;
            } else {
                container.innerHTML = `<audio src="${url}" controls></audio>`;
            }
        } else {
            container.innerHTML = `<small style="color:red">Arquivo não encontrado no histórico.</small>`;
        }
    };
}

const processFiles = async (files) => {
    document.getElementById("loadingBarContainer").style.display = "block";
    const bar = document.getElementById("loadingBar");
    
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        bar.style.width = `${((i + 1) / files.length) * 100}%`;

        const tx = db.transaction(["messages", "media"], "readwrite");
        const msgStore = tx.objectStore("messages");
        const mediaStore = tx.objectStore("media");

        if (file.name.endsWith(".zip")) {
            const zip = await JSZip.loadAsync(file);
            for (let name in zip.files) {
                const entry = zip.files[name];
                if (entry.dir) continue;
                const fileName = name.split('/').pop();
                if (name.endsWith(".txt")) {
                    parseLines(await entry.async("string"), msgStore);
                } else {
                    const blob = await entry.async("blob");
                    mediaStore.put({ name: fileName, data: blob });
                }
            }
        } else if (file.name.endsWith(".txt")) {
            parseLines(await file.text(), msgStore);
        } else {
            mediaStore.put({ name: file.name, data: file });
        }
        await new Promise(res => tx.oncomplete = res);
    }
    
    document.getElementById("loadingBarContainer").style.display = "none";
    loadHistory();
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

function filterMessages() {
    const term = document.getElementById("searchInput").value.toLowerCase();
    if (term.length < 2) { loadHistory(); return; }
    const filtered = allMessages.filter(m => m.text.toLowerCase().includes(term) || m.sender.toLowerCase().includes(term));
    renderMessages(filtered);
}

function filterByDate() {
    const val = document.getElementById("dateFilter").value;
    if (!val) return;
    const start = new Date(val + "T00:00:00").getTime();
    const end = start + 86400000;
    const filtered = allMessages.filter(m => m.ts >= start && m.ts < end);
    renderMessages(filtered);
}

function clearHistory() {
    if (confirm("Apagar todos os dados permanentemente?")) {
        const tx = db.transaction(["messages", "media"], "readwrite");
        tx.objectStore("messages").clear();
        tx.objectStore("media").clear();
        tx.oncomplete = () => location.reload();
    }
}

document.getElementById("fileInput").addEventListener("change", e => processFiles(e.target.files));
document.getElementById("folderInput").addEventListener("change", e => processFiles(e.target.files));
