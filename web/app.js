(() => {
  "use strict";
  const API = String(window.TK_API_URL || "").replace(/\/$/, "");
  const $ = (id) => document.getElementById(id);
  const views = ["setupNotice", "unlockView", "telegramLoginView", "messengerView"];
  let accessToken = "";
  let challengeId = "";
  let activeChatId = "";

  const show = (id) => views.forEach((view) => $(view).classList.toggle("hidden", view !== id));
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
  const setStatus = (text, online = false) => {
    $("connectionStatus").innerHTML = `<i class="${online ? "online" : ""}"></i>${escapeHtml(text)}`;
  };
  async function request(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(`${API}${path}`, {
      credentials: "include", headers, ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Ошибка сервера (${response.status})`);
    return data;
  }
  function showError(id, message) { $(id).textContent = message || ""; }

  async function boot() {
    if (!API || !/^https:\/\//.test(API)) {
      show("setupNotice");
      setStatus("сервер не настроен");
      return;
    }
    $("setupNotice").classList.add("hidden");
    try {
      const status = await request("/api/auth/status");
      $("lockButton").classList.remove("hidden");
      if (status.telegramConnected) {
        setStatus("Telegram подключён", true);
        show("messengerView");
        await loadChats();
      } else {
        setStatus("нужен вход");
        show("telegramLoginView");
      }
    } catch {
      setStatus("ожидает входа");
      show("unlockView");
    }
  }

  $("unlockForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("unlockError", "");
    try {
      const auth = await request("/api/unlock", { method: "POST", body: JSON.stringify({ password: $("appPassword").value }) });
      accessToken = auth.accessToken || "";
      $("appPassword").value = "";
      $("lockButton").classList.remove("hidden");
      await bootUnlocked();
    } catch (error) { showError("unlockError", error.message); }
  });

  async function bootUnlocked() {
    try {
      const status = await request("/api/auth/status");
      if (status.telegramConnected) {
        setStatus("Telegram подключён", true);
        show("messengerView");
        await loadChats();
      } else {
        setStatus("нужен вход");
        show("telegramLoginView");
      }
    } catch (error) {
      show("unlockView");
      showError("unlockError", error.message);
    }
  }

  $("phoneForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("phoneError", "");
    try {
      const result = await request("/api/telegram/start", {
        method: "POST", body: JSON.stringify({ phoneNumber: $("phoneNumber").value })
      });
      challengeId = result.challengeId;
      $("codeForm").classList.remove("hidden");
      $("loginCode").focus();
      showError("phoneError", result.codeType === "app" ? "Код отправлен в Telegram." : "Код отправлен. Проверь SMS или Telegram.");
    } catch (error) { showError("phoneError", error.message); }
  });

  $("codeForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("codeError", "");
    try {
      const result = await request("/api/telegram/verify", {
        method: "POST", body: JSON.stringify({ challengeId, code: $("loginCode").value })
      });
      if (result.needsPassword) {
        $("twoFactorForm").classList.remove("hidden");
        $("twoFactorPassword").focus();
      } else {
        await bootUnlocked();
      }
    } catch (error) { showError("codeError", error.message); }
  });

  $("twoFactorForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("twoFactorError", "");
    try {
      await request("/api/telegram/password", {
        method: "POST", body: JSON.stringify({ challengeId, password: $("twoFactorPassword").value })
      });
      $("twoFactorPassword").value = "";
      await bootUnlocked();
    } catch (error) { showError("twoFactorError", error.message); }
  });

  async function loadChats() {
    $("chatList").innerHTML = '<p class="muted empty-state">Загрузка чатов…</p>';
    try {
      const { chats } = await request("/api/chats");
      if (!chats.length) {
        $("chatList").innerHTML = '<p class="muted empty-state">Пока нет чатов.</p>';
        return;
      }
      $("chatList").innerHTML = chats.map((chat) => `
        <button class="chat-item ${chat.id === activeChatId ? "selected" : ""}" type="button" data-chat-id="${escapeHtml(chat.id)}">
          <span class="chat-avatar">${escapeHtml((chat.title || "T").trim().slice(0, 1).toUpperCase())}</span>
          <span class="chat-copy"><strong>${escapeHtml(chat.title)}</strong><small>${escapeHtml(chat.lastMessage || "Нет сообщений")}</small></span>
          ${chat.unreadCount ? `<span class="unread">${Number(chat.unreadCount)}</span>` : ""}
        </button>`).join("");
      $("chatList").querySelectorAll("[data-chat-id]").forEach((button) => {
        button.addEventListener("click", () => openChat(button.dataset.chatId, button.querySelector("strong").textContent));
      });
    } catch (error) {
      $("chatList").innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
    }
  }

  async function openChat(id, title) {
    activeChatId = id;
    $("activeChatTitle").textContent = title;
    $("emptyConversation").classList.add("hidden");
    $("activeConversation").classList.remove("hidden");
    $("messageList").innerHTML = '<p class="muted empty-state">Загрузка сообщений…</p>';
    $("messengerView").classList.add("chat-open");
    try {
      const { messages } = await request(`/api/chats/${encodeURIComponent(id)}/messages`);
      $("messageList").innerHTML = messages.map((message) => `
        <article class="bubble ${message.outgoing ? "outgoing" : ""}">
          <p>${escapeHtml(message.text || (message.media ? "Медиафайл" : ""))}</p>
          <time>${message.date ? new Date(message.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</time>
        </article>`).join("") || '<p class="muted empty-state">Сообщений пока нет.</p>';
      $("messageList").scrollTop = $("messageList").scrollHeight;
      document.querySelectorAll(".chat-item").forEach((item) => item.classList.toggle("selected", item.dataset.chatId === id));
    } catch (error) {
      $("messageList").innerHTML = `<p class="error-text">${escapeHtml(error.message)}</p>`;
    }
  }

  $("sendForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("messageInput");
    const message = input.value.trim();
    if (!message || !activeChatId) return;
    $("sendError").textContent = "";
    try {
      await request(`/api/chats/${encodeURIComponent(activeChatId)}/messages`, {
        method: "POST", body: JSON.stringify({ message })
      });
      input.value = "";
      await openChat(activeChatId, $("activeChatTitle").textContent);
      await loadChats();
    } catch (error) { $("sendError").textContent = error.message; }
  });

  $("refreshChats").addEventListener("click", loadChats);
  $("backToChats").addEventListener("click", () => $("messengerView").classList.remove("chat-open"));
  $("lockButton").addEventListener("click", async () => {
    try { await request("/api/lock", { method: "POST", body: "{}" }); } catch {}
    accessToken = "";
    activeChatId = "";
    $("lockButton").classList.add("hidden");
    setStatus("заблокировано");
    show("unlockView");
  });

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
  boot();
})();