let db;
let allMessages = [];
let mediaCache = new Map();

// Solicita persistência de dados
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

const request = indexedDB.open("WhatsAppHistoryDB", 100);
request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
    if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "name" });
};

request.onsuccess = e => { db = e.target.result; loadHistory(); };

async function loadHistory() {
    if (!db) return;
    const tx = db.transaction(["messages", "media"], "readonly");
    
    // Pegar nomes das mídias disponíveis
    const mediaNames = [];
    tx.objectStore("media").getAllKeys().onsuccess = (e) => {
        const keys = e.target.result;
        tx.objectStore("messages").getAll().onsuccess = (ev) => {
            allMessages = ev.target.result.sort((a, b) => a.ts - b.ts);
            document.getElementById("stats").innerText = `(${allMessages.length})`;
            renderMessages(allMessages.slice(-300), keys); 
        };
    };
}

async function renderMessages(list, availableMedia) {
    const container = document.getElementById("messages");
    container.innerHTML = "";
    const fragment = document.createDocumentFragment();

    for (let m of list) {
        const div = document.createElement("div");
        div.className = "msg";
        const fileName = m.text.trim();
        let mediaTag = "";

        // Se o arquivo existe no banco, busca o Blob e cria URL
        if (availableMedia.includes(fileName)) {
            const blob = await getMediaBlob(fileName);
            if (blob) {
                const url = URL.createObjectURL(blob);
                if (fileName.match(/\.(jpg|jpeg|png|webp)$/i)) mediaTag = `<img src="${url}">`;
                else if (fileName.match(/\.(mp4|webm)$/i)) mediaTag = `<video src="${url}" controls></video>`;
                else if (fileName.match(/\.(opus|mp3|m4a)$/i)) mediaTag = `<audio src="${url}" controls></audio>`;
            }
        }

        div.innerHTML = `<div class="sender">${m.sender}</div><div class="text">${m.text}</div>${mediaTag}<div class="time">${m.dataStr || ''}</div>`;
        fragment.appendChild(div);
    }
    container.appendChild(fragment);
    container.parentElement.scrollTop = container.parentElement.scrollHeight;
}

function getMediaBlob(name) {
    return new Promise(resolve => {
        const tx = db.transaction("media", "readonly");
        tx.objectStore("media").get(name).onsuccess = e => resolve(e.target.result ? e.target.result.data : null);
    });
}

document.getElementById("fileInput").onchange = async (e) => {
    const files = e.target.files;
    if (!files.length) return;
    const overlay = document.getElementById("loadingOverlay");
    overlay.style.display = "flex";

    for (let file of files) {
        try {
            const zip = await JSZip.loadAsync(file);
            const entries = Object.keys(zip.files).filter(n => !zip.files[n].dir);
            const total = entries.length;

            for (let i = 0; i < total; i++) {
                const name = entries[i];
                const shortName = name.split('/').pop();
                document.getElementById("statusLabel").innerText = `Salvando: ${shortName}`;
                document.getElementById("progress").style.width = `${((i+1)/total)*100}%`;

                if (name.endsWith(".txt")) {
                    const content = await zip.files[name].async("string");
                    await saveBatch("messages", parseText(content));
                } else {
                    const blob = await zip.files[name].async("blob");
                    await saveMedia(shortName, blob);
                }
                // Pausa para o celular não fritar
                if (i % 50 === 0) await new Promise(r => setTimeout(r, 10));
            }
        } catch (err) { alert("Erro: " + err.message); }
    }
    location.reload();
};

function parseText(content) {
    const lines = content.split("\n");
    const regex = /(\d{2}\/\d{2}\/\d{2,4}).*?-\s([^:]+):\s(.+)/;
    return lines.map(l => {
        const m = l.match(regex);
        if (m) return { dataStr: m[1], sender: m[2], text: m[3].replace("<Arquivo anexado: ", "").replace(">", ""), ts: Date.now() };
        return null;
    }).filter(x => x);
}

function saveBatch(storeName, data) {
    return new Promise(resolve => {
        const tx = db.transaction(storeName, "readwrite");
        data.forEach(d => tx.objectStore(storeName).put(d));
        tx.oncomplete = () => resolve();
    });
}

function saveMedia(name, blob) {
    return new Promise(resolve => {
        const tx = db.transaction("media", "readwrite");
        tx.objectStore("media").put({ name, data: blob });
        tx.oncomplete = () => resolve();
    });
}

async function exportBackup() {
    const tx = db.transaction("messages", "readonly");
    tx.objectStore("messages").getAll().onsuccess = e => {
        const blob = new Blob([JSON.stringify(e.target.result)], {type: "application/json"});
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "backup_whatsapp.json";
        a.click();
    };
}

function clearHistory() {
    if(confirm("Apagar tudo?")) {
        indexedDB.deleteDatabase("WhatsAppHistoryDB");
        location.reload();
    }
}
