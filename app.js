let chats = {};
let currentChat = null;
let mediaStore = {};

const chatList = document.getElementById("chatList");
const chatView = document.getElementById("chatView");
const messages = document.getElementById("messages");
const chatTitle = document.getElementById("chatTitle");
const fileInput = document.getElementById("fileInput");

function randomColor(name) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    let color = "#";
    for (let i = 0; i < 3; i++) {
        let value = (hash >>> (i * 8)) & 255;
        color += ("00" + value.toString(16)).substr(-2);
    }
    return color;
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

function renderMessages() {
    messages.innerHTML = "";
    let list = chats[currentChat] || [];
    list.sort((a, b) => a.ts - b.ts);

    list.forEach(m => {
        let div = document.createElement("div");
        div.className = "msg";
        let color = randomColor(m.sender);
        
        let media = "";
        if (m.file && mediaStore[m.file.trim()]) {
            let url = mediaStore[m.file.trim()];
            if (m.file.match(/jpg|png|jpeg|gif|webp/i)) media = `<div class="media"><img src="${url}"></div>`;
            else if (m.file.match(/mp4|webm|mov/i)) media = `<div class="media"><video src="${url}" controls></video></div>`;
            else if (m.file.match(/mp3|ogg|opus|m4a/i)) media = `<audio src="${url}" controls></audio>`;
        }

        div.innerHTML = `
            <div class="sender" style="color:${color}">${m.sender}</div>
            <div>${m.text}</div>
            ${media}
            <div class="time">${new Date(m.ts).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
        `;
        messages.appendChild(div);
    });
    messages.scrollTop = messages.scrollHeight;
}

fileInput.addEventListener("change", async e => {
    for (let file of e.target.files) {
        if (file.name.endsWith(".zip")) {
            let zip = await JSZip.loadAsync(file);
            for (let name in zip.files) {
                let entry = zip.files[name];
                if (entry.dir) continue;
                if (name.endsWith(".txt")) {
                    parseTxt(await entry.async("string"), file.name);
                } else {
                    let blob = await entry.async("blob");
                    mediaStore[name] = URL.createObjectURL(blob);
                }
            }
        } else if (file.name.endsWith(".txt")) {
            parseTxt(await file.text(), file.name);
        }
    }
    renderChats();
});

function parseTxt(t, origin) {
    const cleanText = t.replace(/[\u200B-\u200D\uFEFF]/g, "");
    let linhas = cleanText.split("\n");
    let chatName = origin.replace(".txt", "").replace(".zip", "").replace("Conversa do WhatsApp com ", "");
    if (!chats[chatName]) chats[chatName] = [];

    linhas.forEach(l => {
        let m = l.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}),?\s?(\d{1,2}[:\.]\d{2}).*?-\s(.*?):\s(.*)$/);
        if (m) {
            let [_, data, hora, remetente, texto] = m;
            let dParts = data.split(/[\/\-]/);
            let ano = dParts[2].length == 2 ? "20" + dParts[2] : dParts[2];
            let ts = new Date(ano, dParts[1] - 1, dParts[0], hora.split(/[:\.]/)[0], hora.split(/[:\.]/)[1]).getTime();
            chats[chatName].push({ sender: remetente.trim(), text: texto.trim(), ts: ts, file: texto.trim() });
        }
    });
}
