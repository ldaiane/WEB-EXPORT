let db;
const messagesContainer = document.getElementById("messages");
const fileInput = document.getElementById("fileInput");
const folderInput = document.getElementById("folderInput");

// Inicializa IndexedDB
const request = indexedDB.open("WhatsAppHistory", 1);
request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("messages")) {
        db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
    }
};
request.onsuccess = e => { db = e.target.result; loadHistory(); };

// Carrega e renderiza histórico
function loadHistory() {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");
    const getAll = store.getAll();
    getAll.onsuccess = () => renderMessages(getAll.result);
}

function renderMessages(list) {
    if (list.length === 0) return;
    messagesContainer.innerHTML = "";
    list.sort((a, b) => a.ts - b.ts); // Ordem Cronológica Automática

    list.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg";
        div.innerHTML = `
            <div class="sender">${m.sender}</div>
            <div>${m.text}</div>
            <div class="time">${new Date(m.ts).toLocaleString()}</div>
        `;
        messagesContainer.appendChild(div);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Lida com Arquivos e ZIPs
fileInput.addEventListener("change", async e => processFiles(e.target.files));

// Lida com Pastas Extraídas
folderInput.addEventListener("change", async e => processFiles(e.target.files));

async function processFiles(files) {
    for (let file of files) {
        if (file.name.endsWith(".zip")) {
            const zip = await JSZip.loadAsync(file);
            for (let name in zip.files) {
                if (name.endsWith(".txt")) {
                    parseAndSave(await zip.files[name].async("string"));
                }
            }
        } else if (file.name.endsWith(".txt")) {
            parseAndSave(await file.text());
        }
    }
}

function parseAndSave(t) {
    const cleanText = t.replace(/[\u200B-\u200D\uFEFF]/g, "");
    const linhas = cleanText.split("\n");
    const transaction = db.transaction("messages", "readwrite");
    const store = transaction.objectStore("messages");

    linhas.forEach(l => {
        const m = l.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),?\s?(\d{1,2}[:\.]\d{2}).*?-\s(.*?):\s(.*)$/);
        if (m) {
            const [_, data, hora, remetente, texto] = m;
            const dParts = data.split(/[\/\-]/);
            const ano = dParts[2].length === 2 ? "20" + dParts[2] : dParts[2];
            const ts = new Date(ano, dParts[1] - 1, dParts[0], hora.split(/[:\.]/)[0], hora.split(/[:\.]/)[1]).getTime();
            
            store.add({ sender: remetente.trim(), text: texto.trim(), ts: ts });
        }
    });
    transaction.oncomplete = () => loadHistory();
}

function clearHistory() {
    if (confirm("Apagar permanentemente todo o histórico salvo?")) {
        const transaction = db.transaction("messages", "readwrite");
        transaction.objectStore("messages").clear();
        transaction.oncomplete = () => location.reload();
    }
}
