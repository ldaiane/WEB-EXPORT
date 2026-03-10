let db;
let allMessages = [];
let mediaCache = new Map();

// Abre o banco com versão alta para garantir reset de bugs
const request = indexedDB.open("WhatsAppHistoryDB", 40);

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

request.onsuccess = e => { db = e.target.result; loadHistory(); };

async function loadHistory() {
    if (!db) return;
    const tx = db.transaction(["messages", "media"], "readonly");
    const msgsReq = tx.objectStore("messages").getAll();
    const mediaReq = tx.objectStore("media").getAll();

    msgsReq.onsuccess = () => {
        allMessages = msgsReq.result.sort((a, b) => a.ts - b.ts);
        document.getElementById("stats").innerText = `(${allMessages.length} msgs)`;
        mediaReq.onsuccess = () => {
            mediaCache.clear();
            mediaReq.result.forEach(m => mediaCache.set(m.name, URL.createObjectURL(m.data)));
            renderMessages(allMessages.slice(-300));
        };
    };
}

// O NOVO MOTOR DE PROCESSAMENTO
const processFiles = async (files) => {
    if (!files.length) return;
    
    const overlay = document.getElementById("loadingOverlay");
    const label = document.getElementById("statusLabel");
    const bar = document.getElementById("progressBar");
    
    overlay.style.display = "flex";

    for (let file of files) {
        try {
            if (file.name.endsWith(".zip")) {
                const zip = await JSZip.loadAsync(file);
                const entries = Object.keys(zip.files).filter(name => !zip.files[name].dir);
                
                for (let i = 0; i < entries.length; i++) {
                    const name = entries[i];
                    const entry = zip.files[name];
                    const shortName = name.split('/').pop();
                    
                    label.innerText = `Extraindo: ${shortName}`;
                    bar.style.width = `${((i + 1) / entries.length) * 100}%`;

                    if (name.endsWith(".txt")) {
                        const content = await entry.async("string");
                        await syncSave("messages", content);
                    } else {
                        const blob = await entry.async("blob");
                        await syncSave("media", { name: shortName, data: blob });
                    }
                    // Pequena pausa de 5ms para evitar que a transação trave
                    await new Promise(r => setTimeout(r, 5));
                }
            } else {
                label.innerText = `Processando: ${file.name}`;
                if (file.name.endsWith(".txt")) await syncSave("messages", await file.text());
                else await syncSave("media", { name: file.name, data: file });
            }
        } catch (err) {
            console.error("Erro no arquivo:", file.name, err);
            document.getElementById("errorLabel").innerText = "Erro: " + err.message;
            document.getElementById("errorLabel").style.display = "block";
        }
    }
    
    label.innerText = "Concluído! Atualizando...";
    setTimeout(() => {
        overlay.style.display = "none";
        loadHistory();
    }, 1500);
};

// SALVAMENTO SINCRONIZADO (Garante que a transação só abra quando houver dado pronto)
function syncSave(type, payload) {
    return new Promise((resolve, reject) => {
        // Abrimos a transação EXATAMENTE na hora de salvar
        const tx = db.transaction([type], "readwrite");
        const store = tx.objectStore(type);

        if (type === "messages") {
            const linhas = payload.replace(/[\u200B-\u200D\uFEFF]/g, "").split("\n");
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
        } else {
            store.put(payload);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Renderização, Filtros e Clear (mantenha os mesmos das versões anteriores)
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

document.getElementById("fileInput").addEventListener("change", e => processFiles(e.target.files));

function filterMessages() {
    const term = document.getElementById("searchInput").value.toLowerCase();
    const filtered = allMessages.filter(m => m.text.toLowerCase().includes(term) || m.sender.toLowerCase().includes(term));
    renderMessages(filtered.slice(-500));
}

function clearHistory() {
    if (confirm("Apagar tudo?")) {
        indexedDB.deleteDatabase("WhatsAppHistoryDB");
        location.reload();
    }
}
