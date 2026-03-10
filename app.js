// Adicione referências aos elementos do DOM caso ainda não tenha feito
const chatList = document.getElementById('chatList');
const chatView = document.getElementById('chatView');
const chatTitle = document.getElementById('chatTitle');
const messages = document.getElementById('messages');
const fileInput = document.getElementById('fileInput');

let chats = {};
let currentChat = null;
let mediaStore = {};

// Registro do Service Worker para PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(reg => console.log('SW registrado!', reg))
            .catch(err => console.error('Erro ao registrar SW:', err));
    });
}

function randomColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++)
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    let color = "#";
    for (let i = 0; i < 3; i++) {
        let value = (hash >>> (i * 8)) & 255;
        color += ("00" + value.toString(16)).substr(-2);
    }
    return color;
}

function formatDate(ts) {
    let d = new Date(ts);
    return d.toLocaleString();
}

function renderChats() {
    chatList.innerHTML = "";
    Object.keys(chats).forEach(c => {
        let div = document.createElement("div");
        div.className = "chatItem";
        div.innerText = c;
        div.onclick = () => openChat(c);
        chatList.appendChild(div);
    });
}

function openChat(name) {
    currentChat = name;
    chatList.style.display = "none";
    chatView.style.display = "flex";
    chatTitle.innerText = name;
    renderMessages();
}

function closeChat() {
    chatView.style.display = "none";
    chatList.style.display = "block";
}

function renderMessages() {
    messages.innerHTML = "";
    let list = chats[currentChat];
    if (!list) return;

    list.sort((a, b) => a.ts - b.ts);

    list.forEach(m => {
        let div = document.createElement("div");
        div.className = "msg";
        // Aplica a cor do remetente com transparência
        div.style.backgroundColor = randomColor(m.sender) + "33";

        let media = "";
        if (m.file) {
            let url = mediaStore[m.file];
            if (url) {
                if (m.file.match(/\.(jpg|png|jpeg|gif|webp)$/i))
                    media = `<div class="media"><img src="${url}" style="max-width:100%"></div>`;
                else if (m.file.match(/\.(mp4|webm|mov)$/i))
                    media = `<div class="media"><video src="${url}" controls style="max-width:100%"></video></div>`;
                else if (m.file.match(/\.(mp3|ogg|opus|m4a)$/i))
                    media = `<div class="media"><audio src="${url}" controls></audio></div>`;
            }
        }

        div.innerHTML = `
            <div class="sender" style="color:${randomColor(m.sender)}; font-weight:bold;">${m.sender}</div>
            <div>${m.text}</div>
            ${media}
            <div class="origin" style="font-size:0.7em; color:#666;">${m.origin || ""}</div>
            <div class="time" style="font-size:0.7em; text-align:right;">${formatDate(m.ts)}</div>
        `;
        messages.appendChild(div);
    });
    messages.scrollTop = messages.scrollHeight;
}

fileInput.addEventListener("change", async e => {
    for (let file of e.target.files) {
        let origin = file.name;
        if (file.name.endsWith(".zip")) {
            // Certifique-se de que o JSZip está incluído no index.html
            let zip = await JSZip.loadAsync(file);
            for (let name in zip.files) {
                let entry = zip.files[name];
                if (entry.dir) continue;
                if (name.endsWith(".txt")) {
                    let txt = await entry.async("string");
                    parseTxt(txt, origin);
                } else {
                    let blob = await entry.async("blob");
                    let url = URL.createObjectURL(blob);
                    mediaStore[name] = url;
                    addMediaMessage(name, origin);
                }
            }
        } else if (file.name.endsWith(".txt")) {
            let txt = await file.text();
            parseTxt(txt, origin);
        } else {
            let url = URL.createObjectURL(file);
            mediaStore[file.name] = url;
            addMediaMessage(file.name, origin);
        }
    }
    renderChats();
});

function addMediaMessage(name, origin) {
    let chat = "Backup WhatsApp";
    if (!chats[chat]) chats[chat] = [];
    chats[chat].push({
        sender: "Arquivo",
        text: name,
        file: name,
        origin: origin,
        ts: Date.now()
    });
}

function parseTxt(t, origin) {
    let linhas = t.split("\n");
    linhas.forEach(l => {
        // Regex ajustada para capturar formatos comuns de exportação do WhatsApp
        let m = l.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s?(\d{1,2}:\d{2}).*?- (.*?): (.*)$/);
        if (!m) return;

        let d = m[1].split("/");
        let dia = d[0];
        let mes = d[1];
        let ano = d[2].length == 2 ? "20" + d[2] : d[2];
        let h = m[2].split(":");
        let ts = new Date(ano, mes - 1, dia, h[0], h[1]).getTime();

        let chat = "Backup WhatsApp"; // Você pode extrair o nome do chat do nome do arquivo se desejar
        if (!chats[chat]) chats[chat] = [];
        chats[chat].push({
            sender: m[3],
            text: m[4],
            origin: origin,
            ts: ts
        });
    });
}
