let db;
let allMessages = [];

// Inicialização do Banco de Dados
const request = indexedDB.open("WhatsAppHistoryDB", 2);

request.onupgradeneeded = e => {
    db = e.target.result;
    if (!db.objectStoreNames.contains("messages")) {
        db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
    }
};

request.onsuccess = e => {
    db = e.target.result;
    loadHistory();
};

async function loadHistory() {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");
    const getAll = store.getAll();
    getAll.onsuccess = () => {
        allMessages = getAll.result.sort((a, b) => a.ts - b.ts);
        renderMessages(allMessages);
    };
}

function renderMessages(list) {
    const container = document.getElementById("messages");
    if (list.length === 0) return;
    
    container.innerHTML = "";
    list.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg";
        div.innerHTML = `
            <div class="sender">${m.sender}</div>
            <div>${m.text}</div>
            <div class="time">${new Date(m.ts).toLocaleString()}</div>
        `;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
}

// Filtro de Busca
function filterMessages() {
    const term = document.getElementById("searchInput").value.toLowerCase();
    const filtered = allMessages.filter(m => 
        m.text.toLowerCase().includes(term) || m.sender.toLowerCase().includes(term)
    );
    renderMessages(filtered);
}

// Processador de Arquivos (Pasta, ZIP, TXT)
const processFiles = async (files) => {
    for (let file of files) {
        try {
            if (file.name.endsWith(".zip")) {
                const zip = await JSZip.loadAsync(file);
                for (let name in zip.files) {
                    if (name.endsWith(".txt") && !zip.files[name].dir) {
                        const content = await zip.files[name].async("string");
                        await parseAndSave(content);
                    }
                }
            } else if (file.name.endsWith(".txt")) {
                const content = await file.text();
                await parseAndSave(content);
            }
        } catch (err) {
            console.error("Erro no arquivo:", file.name, err);
        }
    }
    loadHistory();
};

document.getElementById("fileInput").addEventListener("change", e => processFiles(e.target.files));
document.getElementById("folderInput").addEventListener("change", e => processFiles(e.target.files));

async function parseAndSave(t) {
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
    return new Promise(res => transaction.oncomplete = res);
}

function clearHistory() {
    if (confirm("Apagar permanentemente todo o histórico salvo?")) {
        const transaction = db.transaction("messages", "readwrite");
        transaction.objectStore("messages").clear();
        transaction.oncomplete = () => location.reload();
    }
}
