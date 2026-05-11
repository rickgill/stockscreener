const threadEl = document.querySelector("#chat-thread");
const formEl = document.querySelector("#chat-form");
const inputEl = document.querySelector("#chat-input");
const sendButton = document.querySelector("#send-chat-button");
const clearButton = document.querySelector("#clear-chat-button");
const newChatButton = document.querySelector("#new-chat-button");
const suggestionsEl = document.querySelector("#prompt-suggestions");
const historyListEl = document.querySelector("#chat-history-list");
const activeChatTitleEl = document.querySelector("#active-chat-title");

const chatStorageKey = "market-chat-conversations-v2";
const starterPrompts = [
  "What do the next few days look like for NVDA?",
  "Is Apple showing more demand or supply right now?",
  "Does the news support a breakout in Microsoft?",
  "How risky is TSLA over the next few sessions?",
];
const starterAssistantMessage =
  "Ask about a stock ticker or company name, and I’ll summarize the next-few-days setup from price trend, headlines, and supply-demand behavior.";

let conversations = [];
let activeConversationId = null;

function formatPercent(value) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatMoney(value) {
  if (value == null || Number.isNaN(value)) {
    return "N/A";
  }
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
}

function setComposerState(isLoading) {
  sendButton.disabled = isLoading;
  inputEl.disabled = isLoading;
  newChatButton.disabled = isLoading;
  clearButton.disabled = isLoading;
}

function uid() {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildConversationTitle(firstPrompt = "") {
  const cleaned = String(firstPrompt || "").trim();
  if (!cleaned) {
    return "New Chat";
  }
  return cleaned.length > 42 ? `${cleaned.slice(0, 42).trim()}...` : cleaned;
}

function createConversation() {
  return {
    id: uid(),
    title: "New Chat",
    updatedAt: Date.now(),
    entries: [{ type: "text", role: "assistant", text: starterAssistantMessage }],
  };
}

function saveConversations() {
  localStorage.setItem(
    chatStorageKey,
    JSON.stringify({
      activeConversationId,
      conversations,
    })
  );
}

function loadConversations() {
  try {
    const raw = localStorage.getItem(chatStorageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || !Array.isArray(parsed.conversations) || !parsed.conversations.length) {
      const conversation = createConversation();
      return {
        activeConversationId: conversation.id,
        conversations: [conversation],
      };
    }

    return {
      activeConversationId: parsed.activeConversationId || parsed.conversations[0].id,
      conversations: parsed.conversations,
    };
  } catch {
    const conversation = createConversation();
    return {
      activeConversationId: conversation.id,
      conversations: [conversation],
    };
  }
}

function getActiveConversation() {
  return conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0] || null;
}

function touchConversation(conversation) {
  conversation.updatedAt = Date.now();
}

function updateActiveTitle() {
  const activeConversation = getActiveConversation();
  activeChatTitleEl.textContent = activeConversation?.title || "New Chat";
}

function appendTextBubble(role, text) {
  const article = document.createElement("article");
  article.className = `chat-bubble chat-bubble-${role}`;
  article.innerHTML = `
    <span class="field-label">${role === "user" ? "You" : "Market Chat"}</span>
    <p>${text}</p>
  `;
  threadEl.appendChild(article);
  return article;
}

function appendAnalysisBubble(payload) {
  const article = document.createElement("article");
  article.className = "chat-bubble chat-bubble-assistant chat-analysis-bubble";
  article.innerHTML = `
    <div class="analysis-head">
      <div>
        <p class="field-label">${payload.symbol}</p>
        <h2>${payload.shortName || payload.symbol}</h2>
      </div>
      <div class="signal-chip ${payload.shortTermRecommendation?.bias === "Long" ? "positive" : payload.shortTermRecommendation?.bias === "Short" ? "negative" : ""}">
        ${payload.outlook}
      </div>
    </div>
    <div class="metric-strip">
      <span>Short-term ${payload.shortTermRecommendation?.recommendation || "N/A"}</span>
      <span>Setup ${payload.shortTermRecommendation?.setupType || "N/A"}</span>
      <span>News ${payload.newsSentiment}</span>
      <span>Flow ${payload.supplyDemand}</span>
    </div>
    <div class="chat-analysis-copy"></div>
    <div class="setup-metric-grid chat-metric-grid">
      <div class="setup-metric-box">
        <span class="field-label">Price</span>
        <strong>${formatMoney(payload.shortTermRecommendation?.metrics?.price)}</strong>
      </div>
      <div class="setup-metric-box">
        <span class="field-label">Trigger</span>
        <strong>${formatMoney(payload.shortTermRecommendation?.metrics?.triggerPrice)}</strong>
      </div>
      <div class="setup-metric-box">
        <span class="field-label">Stop</span>
        <strong>${formatMoney(payload.shortTermRecommendation?.metrics?.stopPrice)}</strong>
      </div>
      <div class="setup-metric-box">
        <span class="field-label">Target</span>
        <strong>${formatMoney(payload.shortTermRecommendation?.metrics?.targetPrice)}</strong>
      </div>
    </div>
    <div class="metric-strip">
      <span>5D ${formatPercent(payload.shortTermRecommendation?.metrics?.return5dPct)}</span>
      <span>20D ${formatPercent(payload.shortTermRecommendation?.metrics?.return20dPct)}</span>
      <span>RVOL ${payload.shortTermRecommendation?.metrics?.volumeRatio20 == null ? "N/A" : `${payload.shortTermRecommendation.metrics.volumeRatio20.toFixed(1)}x`}</span>
      <span>RSI ${payload.shortTermRecommendation?.metrics?.rsi14 == null ? "N/A" : payload.shortTermRecommendation.metrics.rsi14.toFixed(1)}</span>
    </div>
    <div class="chat-news-block">
      <p class="field-label">Recent headlines</p>
      <div class="chat-news-list"></div>
    </div>
  `;

  const copyEl = article.querySelector(".chat-analysis-copy");
  const newsListEl = article.querySelector(".chat-news-list");

  (payload.paragraphs || []).forEach((text) => {
    const paragraph = document.createElement("p");
    paragraph.className = "chat-analysis-paragraph";
    paragraph.textContent = text;
    copyEl.appendChild(paragraph);
  });

  (payload.headlineNews || []).forEach((item) => {
    const row = document.createElement("div");
    row.className = "chat-news-item";
    const safeHref = item.link || "#";
    row.innerHTML = `
      <a href="${safeHref}" target="_blank" rel="noreferrer">${item.title || "Headline unavailable"}</a>
      <span>${item.publisher || "Source unavailable"}</span>
    `;
    newsListEl.appendChild(row);
  });

  threadEl.appendChild(article);
  renderPromptSuggestions(payload.suggestedPrompts || starterPrompts);
}

function scrollThreadToBottom() {
  threadEl.scrollTop = threadEl.scrollHeight;
}

function renderPromptSuggestions(prompts) {
  suggestionsEl.innerHTML = "";
  prompts.forEach((prompt) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "prompt-pill";
    button.textContent = prompt;
    button.addEventListener("click", () => {
      inputEl.value = prompt;
      inputEl.focus();
    });
    suggestionsEl.appendChild(button);
  });
}

function renderConversationHistory() {
  historyListEl.innerHTML = "";
  const sorted = [...conversations].sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));

  sorted.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "chat-history-item";
    button.classList.toggle("active", conversation.id === activeConversationId);
    button.innerHTML = `
      <strong>${conversation.title || "New Chat"}</strong>
      <span>${new Date(conversation.updatedAt || Date.now()).toLocaleString()}</span>
    `;
    button.addEventListener("click", () => {
      activeConversationId = conversation.id;
      saveConversations();
      renderActiveConversation();
      renderConversationHistory();
    });
    historyListEl.appendChild(button);
  });
}

function renderActiveConversation() {
  threadEl.innerHTML = "";
  const activeConversation = getActiveConversation();
  if (!activeConversation) {
    return;
  }

  activeConversation.entries.forEach((entry) => {
    if (entry.type === "text") {
      appendTextBubble(entry.role, entry.text);
      return;
    }

    if (entry.type === "analysis" && entry.payload) {
      appendAnalysisBubble(entry.payload);
    }
  });

  updateActiveTitle();
  scrollThreadToBottom();
}

function persistEntry(entry) {
  const activeConversation = getActiveConversation();
  if (!activeConversation) {
    return;
  }

  activeConversation.entries.push(entry);
  if (activeConversation.title === "New Chat" && entry.type === "text" && entry.role === "user") {
    activeConversation.title = buildConversationTitle(entry.text);
  }
  touchConversation(activeConversation);
  saveConversations();
  renderConversationHistory();
  updateActiveTitle();
}

function createMessageBubble(role, text, options = {}) {
  const article = appendTextBubble(role, text);
  if (!options.skipPersist) {
    persistEntry({ type: "text", role, text });
  }
  scrollThreadToBottom();
  return article;
}

function createAnalysisBubble(payload, options = {}) {
  appendAnalysisBubble(payload);
  if (!options.skipPersist) {
    persistEntry({ type: "analysis", payload });
  }
  scrollThreadToBottom();
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || "Request failed.");
  }
  return payload;
}

async function submitPrompt(message) {
  createMessageBubble("user", message);
  const loadingBubble = appendTextBubble("assistant", "Reviewing trend, headlines, and supply-demand...");
  scrollThreadToBottom();
  setComposerState(true);

  try {
    const payload = await apiRequest("/api/market-chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    loadingBubble.remove();
    createAnalysisBubble(payload);
  } catch (error) {
    loadingBubble.remove();
    createMessageBubble("assistant", error.message);
  } finally {
    setComposerState(false);
    inputEl.value = "";
    inputEl.focus();
  }
}

function startNewChat() {
  const conversation = createConversation();
  conversations.push(conversation);
  activeConversationId = conversation.id;
  saveConversations();
  renderConversationHistory();
  renderActiveConversation();
  renderPromptSuggestions(starterPrompts);
  inputEl.focus();
}

function clearCurrentChat() {
  const activeConversation = getActiveConversation();
  if (!activeConversation) {
    return;
  }

  activeConversation.entries = [{ type: "text", role: "assistant", text: starterAssistantMessage }];
  activeConversation.title = "New Chat";
  touchConversation(activeConversation);
  saveConversations();
  renderConversationHistory();
  renderActiveConversation();
  renderPromptSuggestions(starterPrompts);
}

formEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const message = inputEl.value.trim();
  if (!message) {
    inputEl.focus();
    return;
  }
  submitPrompt(message);
});

newChatButton.addEventListener("click", () => {
  startNewChat();
});

clearButton.addEventListener("click", () => {
  clearCurrentChat();
});

const storedState = loadConversations();
conversations = storedState.conversations;
activeConversationId = storedState.activeConversationId;
renderPromptSuggestions(starterPrompts);
renderConversationHistory();
renderActiveConversation();
