let db;
let currentChat = "Backup Geral"; // Centraliza em um histórico único
let mediaStore = {};

// Inicializa o Banco de Dados (IndexedDB)
const request = indexedDB.open("ChatHistoryDB", 1);
request.onupgradeneeded = e => {
    db = e.target.result;
    db.createObjectStore("messages", { keyPath: "id", autoIncrement: true });
};
request.onsuccess = e => {
    db = e.target.result;
    loadHistory(); // Carrega o que já existe ao abrir o site
};

// Elementos do DOM
const messagesContainer = document.getElementById("messages");
const fileInput = document.getElementById("fileInput");

function loadHistory() {
    const transaction = db.transaction("messages", "readonly");
    const store = transaction.objectStore("messages");
    const request = store.getAll();
    request.onsuccess = () => {
        renderMessages(request.result);
    };
}

function renderMessages(list) {
    messagesContainer.innerHTML = "";
    // Organiza AUTOMATICAMENTE por ordem cronológica
    list.sort((a, b) => a.ts - b.ts);

    list.forEach(m => {
        const div = document.createElement("div");
        div.className = "msg";
        div.innerHTML = `
            <div class="sender" style="color: #e91e63">${m.sender}</div>
            <div>${m.text}</div>
            <div class="time">${new Date(m.ts).toLocaleString()}</div>
        `;
        messagesContainer.appendChild(div);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

fileInput.addEventListener("change", async e => {
    for (let file of e.target.files) {
        if (file.name.endsWith(".zip")) {
            let zip = await JSZip.loadAsync(file);
            for (let name in zip.files) {
                if (!zip.files[name].dir && name.endsWith(".txt")) {
                    parseAndSave(await zip.files[name].async("string"));
                }
            }
        } else if (file.name.endsWith(".txt")) {
            parseAndSave(await file.text());
        }
    }
});

function parseAndSave(t) {
    const cleanText = t.replace(/[\u200B-\u200D\uFEFF]/g, "");
    let linhas = cleanText.split("\n");
    const transaction = db.transaction("messages", "readwrite");
    const store = transaction.objectStore("messages");

    linhas.forEach(l => {
        let m = l.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),?\s?(\d{1,2}[:\.]\d{2}).*?-\s(.*?):\s(.*)$/);
        if (m) {
            let [_, data, hora, remetente, texto] = m;
            let dParts = data.split(/[\/\-]/);
            let ano = dParts[2].length == 2 ? "20" + dParts[2] : dParts[2];
            let ts = new Date(ano, dParts[1] - 1, dParts[0], hora.split(/[:\.]/)[0], hora.split(/[:\.]/)[1]).getTime();
            
            store.add({ sender: remetente.trim(), text: texto.trim(), ts: ts });
        }
    });

    transaction.oncomplete = () => loadHistory(); // Recarrega e organiza tudo
}

function clearHistory() {
    if(confirm("Deseja apagar todo o histórico?")) {
        const transaction = db.transaction("messages", "readwrite");
        transaction.objectStore("messages").clear();
        transaction.oncomplete = () => loadHistory();
    }
}
