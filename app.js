let db;
let allMessages = [];

// 1. SOLICITA PERMISSÃO PARA ARMAZENAR GBs SEM APAGAR
if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then(persistent => {
        if (persistent) console.log("Armazenamento persistente garantido!");
    });
}

const request = indexedDB.open("WhatsAppHistoryDB", 5);
request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("messages")) {
        const msgStore = db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
        msgStore.createIndex("hash", "hash", { unique: true });
    }
    if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "name" });
};

request.onsuccess = e => { db = e.target.result; loadHistory(); };

async function loadHistory() {
    const transaction = db.transaction(["messages"], "readonly");
    const store = transaction.objectStore("messages");
    const request = store.getAll();

    request.onsuccess = () => {
        allMessages = request.result.sort((a, b) => a.ts - b.ts);
        document.getElementById("stats").innerText = `(${allMessages.length} msgs)`;
        renderMessages(allMessages);
    };
}

// Renderização otimizada para milhares de itens
async function renderMessages(list) {
    const container = document.getElementById("messages");
    container.innerHTML = "";
    if (list.length === 0) return;

    // Carregamos apenas as últimas 500 mensagens inicialmente para não travar o celular
    // O restante aparece ao pesquisar ou se necessário
    const recentMessages = list.slice(-500); 

    const fragment = document.createDocumentFragment();
    for (const m of recentMessages) {
        const div = document.createElement("div");
        div.className = "msg";
        
        // Carregamento de mídia sob demanda para economizar RAM
        let mediaHtml = "";
        if (m.text.match(/\.(jpg|jpeg|png|webp|gif|mp4|opus|mp3)$/i)) {
            mediaHtml = `<button onclick="loadMedia('${m.text.trim()}', this)" class="btn-import" style="margin-top:5px">Ver Mídia</button>`;
        }

        div.innerHTML = `<div class="sender">${m.sender}</div><div>${m.text}</div><div id="media-${m.id}">${mediaHtml}</div><div class="time">${new Date(m.ts).toLocaleString()}</div>`;
        fragment.appendChild(div);
    }
    container.appendChild(fragment);
    container.scrollTop = container.scrollHeight;
}

// Busca a mídia no DB apenas quando o usuário clica
async function loadMedia(name, btn) {
    const tx = db.transaction("media", "readonly");
    const req = tx.objectStore("media").get(name);
    req.onsuccess = () => {
        if (req.result) {
            const url = URL.createObjectURL(req.result.data);
            const parent = btn.parentElement;
            if (name.match(/\.(jpg|jpeg|png|webp|gif)$/i)) parent.innerHTML = `<img src="${url}" style="max-width:100%">`;
            else if (name.match(/\.(mp4|webm)$/i)) parent.innerHTML = `<video src="${url}" controls style="max-width:100%"></video>`;
            else parent.innerHTML = `<audio src="${url}" controls></audio>`;
        } else {
            btn.innerText = "Arquivo não encontrado";
        }
    };
}

const processFiles = async (files) => {
    const loader = document.getElementById("loadingBar");
    loader.style.display = "block";
    let processed = 0;

    for (let file of files) {
        processed++;
        loader.style.width = `${(processed / files.length) * 100}%`;

        const tx = db.transaction(["messages", "media"], "readwrite");
        const msgStore = tx.objectStore("messages");
        const mediaStore = tx.objectStore("media");

        if (file.name.endsWith(".zip")) {
            const zip = await JSZip.loadAsync(file);
            for (let name in zip.files) {
                if (name.endsWith(".txt") && !zip.files[name].dir) {
                    parseLines(await zip.files[name].async("string"), msgStore);
                } else if (!zip.files[name].dir) {
                    const blob = await entry.async("blob");
                    mediaStore.put({ name: name.split('/').pop(), data: blob });
                }
            }
        } else if (file.name.endsWith(".txt")) {
            parseLines(await file.text(), msgStore);
        } else {
            mediaStore.put({ name: file.name, data: file });
        }
        await new Promise(res => tx.oncomplete = res);
    }
    loader.style.display = "none";
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
    if (term.length < 3) return; // Só busca com 3+ letras para não travar em 20GB
    const filtered = allMessages.filter(m => m.text.toLowerCase().includes(term));
    renderMessages(filtered);
}

function clearHistory() {
    if (confirm("Apagar 20GB de dados?")) {
        indexedDB.deleteDatabase("WhatsAppHistoryDB");
        location.reload();
    }
}

document.getElementById("fileInput").addEventListener("change", e => processFiles(e.target.files));
document.getElementById("folderInput").addEventListener("change", e => processFiles(e.target.files));
