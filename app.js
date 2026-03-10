let db;
let allMessages = [];
let mediaCache = new Map();

const request = indexedDB.open("WhatsAppHistoryDB", 80);
request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("messages")) db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
    if (!db.objectStoreNames.contains("media")) db.createObjectStore("media", { keyPath: "name" });
};
request.onsuccess = e => { db = e.target.result; loadHistory(); };

async function loadHistory() {
    if (!db) return;
    const tx = db.transaction(["messages", "media"], "readonly");
    
    // Carrega mídias primeiro para o cache
    tx.objectStore("media").getAll().onsuccess = (e) => {
        mediaCache.clear();
        e.target.result.forEach(m => {
            mediaCache.set(m.name, URL.createObjectURL(m.data));
        });

        // Depois carrega as mensagens
        tx.objectStore("messages").getAll().onsuccess = (e) => {
            allMessages = e.target.result.sort((a, b) => a.ts - b.ts);
            document.getElementById("stats").innerText = `(${allMessages.length} mensagens)`;
            renderMessages(allMessages.slice(-500)); 
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
        const fileName = m.text.trim(); // O WhatsApp coloca o nome do arquivo no texto da msg

        if (mediaCache.has(fileName)) {
            const url = mediaCache.get(fileName);
            if (fileName.match(/\.(jpg|jpeg|png|webp|gif)$/i)) {
                mediaHtml = `<img src="${url}" loading="lazy">`;
            } else if (fileName.match(/\.(mp4|webm)$/i)) {
                mediaHtml = `<video src="${url}" controls></video>`;
            } else if (fileName.match(/\.(opus|mp3|m4a|ogg|wav)$/i)) {
                mediaHtml = `<audio src="${url}" controls></audio>`;
            }
        }

        div.innerHTML = `
            <div class="sender">${m.sender}</div>
            <div>${m.text}</div>
            ${mediaHtml}
            <div class="time">${m.dataStr || ''}</div>
        `;
        fragment.appendChild(div);
    });
    container.appendChild(fragment);
}

document.getElementById("fileInput").onchange = async (e) => {
    const files = e.target.files;
    if (!files.length) return;

    document.getElementById("loadingOverlay").style.display = "flex";
    const label = document.getElementById("statusLabel");

    for (let file of files) {
        try {
            if (file.name.endsWith(".zip")) {
                const zip = await JSZip.loadAsync(file);
                const entries = Object.keys(zip.files).filter(n => !zip.files[n].dir);

                for (let i = 0; i < entries.length; i++) {
                    const name = entries[i];
                    const shortName = name.split('/').pop();
                    label.innerText = `Processando: ${shortName}`;

                    if (name.endsWith(".txt")) {
                        const content = await zip.files[name].async("string");
                        await saveBatch("messages", parseText(content));
                    } else {
                        // Salva imagens e áudios no banco
                        const blob = await zip.files[name].async("blob");
                        await saveMedia(shortName, blob);
                    }
                }
            }
        } catch (err) {
            console.error(err);
        }
    }
    document.getElementById("loadingOverlay").style.display = "none";
    location.reload(); // Recarrega para ativar os URLs das mídias
};

function parseText(content) {
    const lines = content.split("\n");
    // Regex ajustada para pegar nomes de arquivos anexados
    const regex = /(\d{2}\/\d{2}\/\d{2,4}).*?-\s([^:]+):\s(.+)/;
    return lines.map(l => {
        const m = l.match(regex);
        if (m) {
            return { dataStr: m[1], sender: m[2], text: m[3].replace("<Arquivo anexado: ", "").replace(">", ""), ts: Date.now() };
        }
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
