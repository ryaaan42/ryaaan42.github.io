const FUNCTIONS_URL =
  "https://zreedocxrfbpnhapmhzs.supabase.co/functions/v1/admin-api";
const ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpyZWVkb2N4cmZicG5oYXBtaHpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcwNjg2NjIsImV4cCI6MjEwMjY0NDY2Mn0.VUuDsnvDXQQOw4Eri21fFLoxJMTKp4DGpOsagAFY95Q";
const STORAGE_KEY = "declic-admin-session";

const SECTIONS = [
  ["overview", "Vue d’ensemble"],
  ["queue", "Signalements"],
  ["explorer", "Communauté"],
  ["members", "Comptes"],
  ["held", "Retenus"],
  ["suspensions", "Suspendus"],
  ["history", "Journal"],
  ["notice", "Annonce"],
  ["domains", "Domaines"],
];

const ACTION_LABELS = {
  hide: "Masqué",
  restore: "Rétabli",
  suspend: "Suspendu",
  lift_suspension: "Levée",
  dismiss_report: "Laissé en ligne",
  resolve_report: "Clôturé",
  warn: "Avertissement",
  lock_community: "Communauté coupée",
  unlock_community: "Communauté rétablie",
};

const KIND_LABELS = {
  today: "Aujourd’hui",
  craving: "Envie",
  dailyWin: "Victoire",
  afterRelapse: "Après une rechute",
  advice: "Conseil",
  needSupport: "Besoin de soutien",
};

const state = {
  session: loadSession(),
  me: null,
  section: "overview",
  summary: null,
  queue: [],
  includeResolved: false,
  held: [],
  suspensions: [],
  history: [],
  notice: { body: "", updated_at: null },
  domains: [],
  browse: [],
  browseQuery: "",
  browseSince: "",
  browseUntil: "",
  browseSelected: null,
  member: null,
  memberQuery: "",
  query: "",
  selected: null,
  toast: null,
  error: null,
  loading: false,
  dialog: null,
  now: Date.now(),
};

const root = document.getElementById("app");

boot();

async function boot() {
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("input", onInput);
  document.addEventListener("keydown", onKey);
  setInterval(() => {
    state.now = Date.now();
    const node = document.querySelector("[data-session-remaining]");
    if (node) node.textContent = sessionRemaining();
    if (state.session && Date.parse(state.session.expiresAt) <= Date.now()) {
      clearSession();
      state.error = "La session a expiré. Reconnecte-toi avec un nouveau code.";
      render();
    }
  }, 1000);
  if (state.session) {
    try {
      await refreshAll();
    } catch (error) {
      if (isAuthError(error)) {
        clearSession();
      } else {
        state.error = frenchError(error);
      }
    }
  }
  render();
}

function loadSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !parsed?.expiresAt) return null;
    if (Date.parse(parsed.expiresAt) <= Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function saveSession(session) {
  state.session = session;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  state.session = null;
  state.me = null;
  localStorage.removeItem(STORAGE_KEY);
}

async function api(action, body = {}) {
  const headers = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
  };
  if (state.session?.token) {
    headers.Authorization = `Bearer ${state.session.token}`;
  }
  const response = await fetch(FUNCTIONS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && action !== "redeem") {
      clearSession();
    }
    const error = new Error(payload.error || "request_failed");
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function rpc(op, args = {}) {
  const payload = await api("rpc", { op, args });
  return payload.data;
}

function isAuthError(error) {
  return (
    error.status === 401 ||
    error.message === "invalid_or_expired_session" ||
    error.message === "authentication_required"
  );
}

function frenchError(error) {
  const map = {
    invalid_or_expired_code:
      "Ce code n’est pas valable. Génère-en un autre dans l’app.",
    invalid_or_expired_session:
      "La session a expiré. Reconnecte-toi avec un nouveau code.",
    authentication_required:
      "La session a expiré. Reconnecte-toi avec un nouveau code.",
    not_a_moderator: "Ce compte n’est plus modérateur.",
    rate_limit_exceeded: "Trop de tentatives. Attends un moment.",
    reason_required: "Écris un motif d’au moins trois caractères.",
    notice_too_short: "L’annonce est trop courte.",
    invalid_domain: "Ce domaine n’est pas valide.",
    unknown_report: "Ce signalement n’existe plus.",
    unknown_target: "Cette cible n’existe plus.",
    unknown_action: "Cette action n’est pas reconnue.",
    community_locked: "La communauté est coupée pour ce compte.",
  };
  return map[error.message] || "L’action n’a pas abouti. Réessaie.";
}

async function refreshAll() {
  state.loading = true;
  render();
  try {
    const [me, summary, queue, held, suspensions, history, notice, domains] =
      await Promise.all([
        api("me").then((payload) => payload.data),
        rpc("summary"),
        rpc("queue", { include_resolved: state.includeResolved, max_rows: 200 }),
        rpc("held"),
        rpc("suspensions"),
        rpc("history", { max_rows: 200 }),
        rpc("notice"),
        rpc("domains"),
      ]);
    state.me = me;
    state.summary = summary;
    state.queue = queue || [];
    state.held = held || [];
    state.suspensions = suspensions || [];
    state.history = history || [];
    state.notice = notice || { body: "", updated_at: null };
    state.domains = domains || [];
    if (state.section === "explorer") await loadBrowse();
    if (state.section === "members" && (state.member?.username || state.memberQuery)) {
      await loadMember(state.member?.username || state.memberQuery);
    }
    state.error = null;
    if (state.selected) {
      state.selected =
        state.queue.find((row) => row.report_id === state.selected.report_id) ||
        null;
    }
  } finally {
    state.loading = false;
    render();
  }
}

function toast(message) {
  state.toast = message;
  render();
  setTimeout(() => {
    if (state.toast === message) {
      state.toast = null;
      render();
    }
  }, 2800);
}

function onClick(event) {
  const node = event.target.closest("[data-action]");
  if (!node) return;
  event.preventDefault();
  handleAction(node.dataset.action, node);
}

function onSubmit(event) {
  event.preventDefault();
  const form = event.target;
  if (form.id === "login-form") {
    redeem(new FormData(form).get("code"));
  }
  if (form.id === "notice-form") {
    saveNotice(new FormData(form).get("body") || "");
  }
  if (form.id === "domain-form") {
    addDomain(new FormData(form).get("domain") || "");
    form.reset();
  }
  if (form.id === "explorer-form") {
    const data = new FormData(form);
    state.browseQuery = String(data.get("query") || "");
    state.browseSince = String(data.get("since") || "");
    state.browseUntil = String(data.get("until") || "");
    loadBrowse();
  }
  if (form.id === "member-form") {
    loadMember(new FormData(form).get("lookup") || "");
  }
  if (form.id === "dialog-form") {
    confirmDialog(new FormData(form));
  }
}

function onInput(event) {
  if (event.target.name === "code") {
    event.target.value = formatCode(event.target.value);
  }
  if (event.target.name === "query") {
    const start = event.target.selectionStart;
    state.query = event.target.value;
    render();
    const input = document.querySelector('input[name="query"]');
    if (input) {
      input.focus();
      input.setSelectionRange(start, start);
    }
  }
}

function onKey(event) {
  if (event.key === "Escape") {
    state.dialog = null;
    state.selected = null;
    render();
  }
}

async function handleAction(action, node) {
  try {
    if (action === "nav") {
      state.section = node.dataset.section;
      state.selected = null;
      state.browseSelected = null;
      render();
      if (state.section === "explorer") await loadBrowse();
      return;
    }
    if (action === "open-member") {
      await loadMember(node.dataset.username);
      return;
    }
    if (action === "select-browse") {
      state.browseSelected = state.browse.find((row) => row.target_id === node.dataset.id);
      render();
      return;
    }
    if (action === "act") {
      const extra = node.dataset.extra === "suspend";
      const warnings = Number(node.dataset.warnings || 0);
      const isWarn = node.dataset.op === "warn";
      openDialog({
        title: actTitle(node.dataset.op, warnings),
        submit: node.dataset.submit || "Confirmer",
        danger: node.dataset.danger === "true",
        hint: isWarn && warnings >= 1
          ? "Ce compte a déjà un avertissement. La suspension est souvent la suite."
          : "",
        fields: reasonFields(extra),
        payload: {
          op: "act",
          args: {
            target_kind: node.dataset.kind,
            target_id: node.dataset.id,
            action: node.dataset.op,
            suspend_days: extra ? 7 : null,
          },
        },
      });
      return;
    }
    if (action === "logout") {
      try {
        await api("logout");
      } catch {
        // A lost revoke still clears the local session.
      }
      clearSession();
      render();
      return;
    }
    if (action === "refresh") {
      await refreshAll();
      return;
    }
    if (action === "toggle-resolved") {
      state.includeResolved = !state.includeResolved;
      await refreshAll();
      return;
    }
    if (action === "select-report") {
      state.selected = state.queue.find((row) => row.report_id === node.dataset.id);
      render();
      return;
    }
    if (action === "export") {
      exportCsv();
      return;
    }
    if (action === "moderate") {
      const warnings = Number(node.dataset.warnings || 0);
      openDialog({
        title: node.dataset.title,
        submit: node.dataset.submit || "Confirmer",
        danger: node.dataset.danger === "true",
        hint: node.dataset.op === "warn" && warnings >= 1
          ? "Ce compte a déjà un avertissement. La suspension est souvent la suite."
          : "",
        fields: reasonFields(node.dataset.extra === "suspend"),
        payload: {
          op: "moderate",
          args: {
            report_id: node.dataset.id,
            action: node.dataset.op,
            suspend_days: node.dataset.extra === "suspend" ? 7 : null,
          },
        },
      });
      return;
    }
    if (action === "review-held") {
      openDialog({
        title: node.dataset.op === "hide" ? "Masquer ce contenu" : "Autoriser ce contenu",
        submit: "Confirmer",
        danger: node.dataset.op === "hide",
        fields: reasonFields(false),
        payload: {
          op: "review_held",
          args: {
            target_kind: node.dataset.kind,
            target_id: node.dataset.id,
            action: node.dataset.op,
          },
        },
      });
      return;
    }
    if (action === "lift") {
      openDialog({
        title: "Lever la suspension",
        submit: "Lever",
        fields: reasonFields(false),
        payload: {
          op: "lift_suspension",
          args: { user_id: node.dataset.id },
        },
      });
      return;
    }
    if (action === "remove-domain") {
      openDialog({
        title: "Retirer ce domaine bloqué ?",
        submit: "Retirer",
        danger: true,
        fields: [],
        payload: {
          op: "remove_domain",
          args: { domain: node.dataset.domain },
        },
      });
      return;
    }
    if (action === "close-dialog") {
      state.dialog = null;
      render();
    }
  } catch (error) {
    state.error = frenchError(error);
    render();
  }
}

function openDialog(dialog) {
  state.dialog = dialog;
  render();
  document.querySelector("[name='reason']")?.focus();
}

async function confirmDialog(form) {
  const dialog = state.dialog;
  if (!dialog) return;
  const reason = String(form.get("reason") || "").trim();
  if (dialog.fields.some((field) => field.name === "reason") && reason.length < 3) {
    toast("Écris un motif d’au moins trois caractères.");
    return;
  }
  const args = { ...dialog.payload.args };
  if (reason) args.reason = reason;
  const days = form.get("suspend_days");
  if (days) args.suspend_days = Number(days);
  state.dialog = null;
  try {
    await rpc(dialog.payload.op, args);
    toast("C’est enregistré.");
    await refreshAll();
  } catch (error) {
    state.error = frenchError(error);
    render();
  }
}

async function redeem(raw) {
  state.error = null;
  state.loading = true;
  render();
  try {
    const payload = await api("redeem", { code: String(raw || "") });
    saveSession({
      token: payload.session_token,
      expiresAt: payload.expires_at,
      username: payload.username,
    });
    await refreshAll();
  } catch (error) {
    state.error = frenchError(error);
    state.loading = false;
    render();
  }
}

async function saveNotice(body) {
  try {
    await rpc("set_notice", { body: body.trim() });
    toast(body.trim() ? "Annonce publiée." : "Annonce retirée.");
    await refreshAll();
  } catch (error) {
    state.error = frenchError(error);
    render();
  }
}

async function addDomain(domain) {
  try {
    await rpc("add_domain", { domain: domain.trim() });
    toast("Domaine ajouté pour tous les téléphones.");
    await refreshAll();
  } catch (error) {
    state.error = frenchError(error);
    render();
  }
}

function reasonFields(withDays) {
  const fields = [
    {
      name: "reason",
      label: "Motif",
      placeholder: "Pourquoi cette décision",
    },
  ];
  if (withDays) {
    fields.push({
      name: "suspend_days",
      label: "Durée (jours)",
      type: "number",
      value: "7",
    });
  }
  return fields;
}

function formatCode(value) {
  const compact = String(value).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  return compact.length > 4 ? `${compact.slice(0, 4)}-${compact.slice(4)}` : compact;
}

function age(iso) {
  if (!iso) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  const hours = Math.floor(seconds / 3600);
  if (hours >= 24) return `${Math.floor(hours / 24)} j`;
  if (hours >= 1) return `${hours} h`;
  return `${Math.max(1, Math.floor(seconds / 60))} min`;
}

function matchesQuery(text) {
  const query = state.query.trim().toLowerCase();
  if (!query) return true;
  return String(text || "").toLowerCase().includes(query);
}

function sessionRemaining() {
  if (!state.session?.expiresAt) return "";
  const remaining = Date.parse(state.session.expiresAt) - state.now;
  if (remaining <= 0) return "Session expirée";
  const minutes = Math.floor(remaining / 60000);
  const hours = Math.floor(minutes / 60);
  if (hours >= 1) return `${hours} h ${minutes % 60} min`;
  return `${minutes} min`;
}

function exportCsv() {
  const lines = ["acted_at,action,target,reason"];
  for (const entry of state.history) {
    const target = entry.target_username ? `@${entry.target_username}` : entry.target_id || "";
    lines.push([csv(entry.acted_at), csv(entry.action), csv(target), csv(entry.reason)].join(","));
  }
  lines.push("");
  lines.push("user,suspended_until,reason");
  for (const row of state.suspensions) {
    lines.push([
      csv(row.username ? `@${row.username}` : row.user_id),
      csv(row.suspended_until),
      csv(row.reason),
    ].join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "declic-moderation.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csv(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function render() {
  root.innerHTML = state.session ? dashboard() : gate();
}

function gate() {
  return `
    <main class="gate">
      <form class="gate-card" id="login-form">
        <div class="mark" aria-hidden="true">D</div>
        <h1>Admin Déclic</h1>
        <p class="lede">Ouvre l’app, Face ID, puis Admin web. Tape le code ici. Il ne marche qu’une fois, pendant dix minutes.</p>
        <input class="code-input" name="code" inputmode="text" autocomplete="one-time-code" spellcheck="false" maxlength="9" placeholder="K7M2-Q9XP" required />
        <button class="primary" type="submit" ${state.loading ? "disabled" : ""}>${
          state.loading ? "Vérification…" : "Entrer"
        }</button>
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
      </form>
    </main>
  `;
}

function dashboard() {
  const pending = state.summary?.pending_count ?? 0;
  const oldest = state.summary?.oldest_pending_at;
  const breach = oldest && Date.now() - Date.parse(oldest) > 24 * 60 * 60 * 1000;
  return `
    <div class="shell">
      <aside class="side">
        <div class="side-brand"><span class="mark">D</span> Admin</div>
        ${SECTIONS.map(([id, label]) => {
          const count =
            id === "queue" ? pending :
            id === "held" ? state.held.length :
            id === "suspensions" ? state.suspensions.length : 0;
          return `<button class="nav-btn ${state.section === id ? "active" : ""}" data-action="nav" data-section="${id}">${label}${
            count ? `<span class="count">${count}</span>` : ""
          }</button>`;
        }).join("")}
        <div class="side-foot">
          ${escapeHtml(state.me?.username ? `@${state.me.username}` : "Modération")}
          <div data-session-remaining>${escapeHtml(sessionRemaining())}</div>
          <button class="ghost" data-action="logout">Se déconnecter</button>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div>
            <h1>${SECTIONS.find((row) => row[0] === state.section)?.[1] || ""}</h1>
            <p class="lede">Les mêmes outils que dans l’app, sur un vrai écran. Rien de privé : pas d’urgences, pas d’argent, pas de protection.</p>
          </div>
          <div class="toolbar">
            <button class="btn" data-action="refresh">${state.loading ? "Chargement…" : "Actualiser"}</button>
            <button class="btn" data-action="export">Exporter CSV</button>
          </div>
        </div>
        ${state.error ? `<div class="warn">${escapeHtml(state.error)}</div>` : ""}
        ${breach ? `<div class="warn">Le plus ancien signalement attend depuis plus de 24 h (${escapeHtml(age(oldest))}).</div>` : ""}
        ${sectionView()}
      </main>
    </div>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    ${state.dialog ? dialogView() : ""}
  `;
}

function sectionView() {
  switch (state.section) {
    case "overview":
      return overviewView();
    case "queue":
      return queueView();
    case "explorer":
      return explorerView();
    case "members":
      return memberView();
    case "held":
      return heldView();
    case "suspensions":
      return suspensionsView();
    case "history":
      return historyView();
    case "notice":
      return noticeView();
    case "domains":
      return domainsView();
    default:
      return "";
  }
}

function overviewView() {
  const summary = state.summary || {};
  return `
    <div class="stats">
      <div class="stat"><div class="label">En attente</div><div class="value">${summary.pending_count ?? 0}</div></div>
      <div class="stat"><div class="label">Messages aujourd’hui</div><div class="value">${summary.posts_today ?? 0}</div></div>
      <div class="stat"><div class="label">Suspendus</div><div class="value">${summary.suspended_count ?? 0}</div></div>
    </div>
    ${
      summary.oldest_pending_at
        ? `<p class="muted">Le plus ancien signalement attend depuis ${escapeHtml(age(summary.oldest_pending_at))}.</p>`
        : `<p class="empty">Rien en attente. La file est vide.</p>`
    }
    <div class="panel" style="margin-top:18px">
      <h2>Dernières décisions</h2>
      ${
        state.history.slice(0, 8).map((entry) => `
          <div class="row">
            <div>
              <strong>${escapeHtml(ACTION_LABELS[entry.action] || entry.action)}</strong>
              ${entry.target_username ? ` · ${usernameBtn(entry.target_username)}` : ""}
              <div class="meta">${escapeHtml(entry.reason)}</div>
            </div>
            <div class="meta">${escapeHtml(age(entry.acted_at))}</div>
          </div>
        `).join("") || `<p class="empty">Aucune action pour l’instant.</p>`
      }
    </div>
  `;
}

function queueView() {
  const rows = state.queue.filter((row) =>
    matchesQuery(`${row.author_username || ""} ${row.content || ""} ${row.reason || ""}`)
  );
  return `
    <div class="toolbar">
      <input class="search" name="query" placeholder="Rechercher un compte, un message, un motif" value="${escapeHtml(state.query)}" />
      <button class="btn" data-action="toggle-resolved">${
        state.includeResolved ? "Masquer les clos" : "Inclure les clos"
      }</button>
    </div>
    <div class="layout-split">
      <div class="panel">
        ${
          rows.map((row) => `
            <button class="row" data-action="select-report" data-id="${row.report_id}">
              <div>
                <strong>${usernameBtn(row.author_username)}</strong>
                ${row.author_suspended_until && Date.parse(row.author_suspended_until) > Date.now() ? `<span class="tag danger">Suspendu</span>` : ""}
                ${row.content_deleted ? `<span class="tag">Masqué</span>` : ""}
                ${row.author_warning_count ? `<span class="tag">Avertissement ×${row.author_warning_count}</span>` : ""}
                <div class="meta">${escapeHtml(row.content || "Signalement visant un compte")}</div>
                <div class="meta">« ${escapeHtml(row.reason)} » · ${escapeHtml(age(row.reported_at))} · ${row.author_report_count || 0} signalement(s)${
                  row.reporter_username
                    ? ` · signalé par ${usernameBtn(row.reporter_username)}`
                    : ""
                }</div>
              </div>
            </button>
          `).join("") || `<p class="empty">Rien en attente.</p>`
        }
      </div>
      <div class="panel">
        ${state.selected ? reportDetail(state.selected) : `<p class="empty">Choisis un signalement pour décider.</p>`}
      </div>
    </div>
  `;
}

function reportDetail(report) {
  const warnings = report.author_warning_count || 0;
  return `
    <h2>${usernameBtn(report.author_username, "Compte")}</h2>
    <p>${escapeHtml(report.content || "Ce signalement vise un compte, pas un message.")}</p>
    <p class="meta">Motif du signalement : « ${escapeHtml(report.reason)} »</p>
    <p class="meta">${
      report.reporter_username
        ? `Signalé par ${usernameBtn(report.reporter_username)} · `
        : ""
    }${report.author_report_count || 0} signalement(s) · ${report.author_post_count || 0} message(s) encore en ligne${
      warnings ? ` · ${warnings} avertissement(s)` : ""
    }</p>
    ${
      warnings >= 1
        ? `<p class="warn">Déjà averti. Un second avertissement, ou une suspension, est souvent plus clair.</p>`
        : ""
    }
    <div class="actions">
      ${
        report.content_deleted
          ? `<button class="btn" data-action="moderate" data-id="${report.report_id}" data-op="restore" data-title="Rétablir le contenu" data-submit="Rétablir">Rétablir</button>`
          : `<button class="btn danger" data-action="moderate" data-id="${report.report_id}" data-op="hide" data-title="Masquer le contenu" data-submit="Masquer" data-danger="true">Masquer</button>`
      }
      <button class="btn" data-action="moderate" data-id="${report.report_id}" data-op="dismiss_report" data-title="Laisser en ligne" data-submit="Laisser">Laisser en ligne</button>
      <button class="btn" data-action="moderate" data-id="${report.report_id}" data-op="warn" data-warnings="${warnings}" data-title="${
        warnings >= 1 ? "Nouveau avertissement" : "Avertir"
      }" data-submit="Avertir">${warnings >= 1 ? "Avertir encore" : "Avertir"}</button>
      <button class="btn danger" data-action="moderate" data-id="${report.report_id}" data-op="suspend" data-title="Suspendre ce compte" data-submit="Suspendre" data-extra="suspend" data-danger="true">Suspendre</button>
    </div>
  `;
}

function heldView() {
  return `
    <div class="panel">
      ${
        state.held.map((item) => `
          <div class="row">
            <div>
              <strong>${usernameBtn(item.author_username)}</strong>
              <div>${escapeHtml(item.content || "")}</div>
              <div class="meta">${escapeHtml(age(item.held_at))} · ${escapeHtml(item.target_kind)}</div>
              <div class="actions">
                <button class="btn" data-action="review-held" data-id="${item.target_id}" data-kind="${item.target_kind}" data-op="allow">Autoriser</button>
                <button class="btn danger" data-action="review-held" data-id="${item.target_id}" data-kind="${item.target_kind}" data-op="hide">Masquer</button>
              </div>
            </div>
          </div>
        `).join("") || `<p class="empty">Rien en retenue.</p>`
      }
    </div>
  `;
}

function suspensionsView() {
  return `
    <div class="panel">
      ${
        state.suspensions.map((row) => `
          <div class="row">
            <div>
              <strong>${usernameBtn(row.username, row.user_id)}</strong>
              <div class="meta">Jusqu’au ${escapeHtml(new Date(row.suspended_until).toLocaleString("fr-FR"))}</div>
              <div>${escapeHtml(row.reason)}</div>
              <div class="actions">
                <button class="btn" data-action="lift" data-id="${row.user_id}">Lever</button>
              </div>
            </div>
          </div>
        `).join("") || `<p class="empty">Personne n’est suspendu.</p>`
      }
    </div>
  `;
}

function historyView() {
  const rows = state.history.filter((entry) =>
    matchesQuery(`${entry.action} ${entry.target_username || ""} ${entry.reason || ""}`)
  );
  return `
    <div class="toolbar">
      <input class="search" name="query" placeholder="Rechercher dans le journal" value="${escapeHtml(state.query)}" />
    </div>
    <div class="panel">
      ${
        rows.map((entry) => `
          <div class="row">
            <div>
              <strong>${escapeHtml(ACTION_LABELS[entry.action] || entry.action)}</strong>
              ${entry.target_username ? ` · ${usernameBtn(entry.target_username)}` : ""}
              <div class="meta">${escapeHtml(entry.reason)}</div>
            </div>
            <div class="meta">${escapeHtml(age(entry.acted_at))}</div>
          </div>
        `).join("") || `<p class="empty">Aucune action pour l’instant.</p>`
      }
    </div>
  `;
}

function explorerView() {
  const selected = state.browseSelected;
  return `
    <form class="toolbar" id="explorer-form">
      <input class="search" name="query" placeholder="Un @, un mot, un bout de message" value="${escapeHtml(state.browseQuery)}" />
      <input class="search" type="date" name="since" value="${escapeHtml(state.browseSince)}" aria-label="Depuis" />
      <input class="search" type="date" name="until" value="${escapeHtml(state.browseUntil)}" aria-label="Jusqu’au" />
      <button class="btn brand" type="submit">Chercher</button>
    </form>
    <div class="layout-split">
      <div class="panel">
        ${
          state.browse.map((row) => `
            <button class="row" data-action="select-browse" data-id="${row.target_id}">
              <div>
                <strong>${usernameBtn(row.author_username)}</strong>
                <span class="tag">${escapeHtml(row.target_kind === "comment" ? "Commentaire" : KIND_LABELS[row.post_kind] || "Message")}</span>
                ${row.is_deleted ? `<span class="tag">Masqué</span>` : ""}
                ${row.author_warning_count ? `<span class="tag">Avertissement ×${row.author_warning_count}</span>` : ""}
                <div class="meta">${escapeHtml(row.content)}</div>
                <div class="meta">${escapeHtml(age(row.created_at))}</div>
              </div>
            </button>
          `).join("") || `<p class="empty">Rien à parcourir pour cette recherche.</p>`
        }
      </div>
      <div class="panel">
        ${selected ? browseDetail(selected) : `<p class="empty">Choisis un message pour agir, sans attendre un signalement.</p>`}
      </div>
    </div>
  `;
}

function browseDetail(row) {
  const warnings = row.author_warning_count || 0;
  return `
    <h2>${usernameBtn(row.author_username)}</h2>
    <p>${escapeHtml(row.content)}</p>
    <p class="meta">${escapeHtml(row.target_kind === "comment" ? "Commentaire" : KIND_LABELS[row.post_kind] || "Message")} · ${escapeHtml(age(row.created_at))}${
      warnings ? ` · ${warnings} avertissement(s)` : ""
    }</p>
    ${
      warnings >= 1
        ? `<p class="warn">Déjà averti. Un second avertissement, ou une suspension, est souvent plus clair.</p>`
        : ""
    }
    <div class="actions">
      ${
        row.is_deleted
          ? `<button class="btn" data-action="act" data-kind="${row.target_kind}" data-id="${row.target_id}" data-op="restore" data-submit="Rétablir">Rétablir</button>`
          : `<button class="btn danger" data-action="act" data-kind="${row.target_kind}" data-id="${row.target_id}" data-op="hide" data-submit="Masquer" data-danger="true">Masquer</button>`
      }
      <button class="btn" data-action="act" data-kind="${row.target_kind}" data-id="${row.target_id}" data-op="warn" data-warnings="${warnings}" data-submit="Avertir">${
        warnings >= 1 ? "Avertir encore" : "Avertir"
      }</button>
      <button class="btn danger" data-action="act" data-kind="${row.target_kind}" data-id="${row.target_id}" data-op="suspend" data-extra="suspend" data-submit="Suspendre" data-danger="true">Suspendre</button>
    </div>
  `;
}

function memberView() {
  const card = state.member;
  return `
    <form class="toolbar" id="member-form">
      <input class="search" name="lookup" placeholder="@username" value="${escapeHtml(state.memberQuery)}" />
      <button class="btn brand" type="submit">Ouvrir</button>
    </form>
    ${card ? memberCard(card) : `<p class="empty">Cherche un compte par son @. Rien de privé : pas d’urgences, pas d’argent, pas de protection.</p>`}
  `;
}

function memberCard(card) {
  const locked = card.community_locked;
  const suspended = card.suspended_until && Date.parse(card.suspended_until) > Date.now();
  const warnings = card.warning_count || 0;
  return `
    <div class="panel stack">
      <h2>${usernameBtn(card.username)}</h2>
      ${card.bio ? `<p>${escapeHtml(card.bio)}</p>` : ""}
      <p class="meta">
        ${card.post_count || 0} message(s) · ${card.comment_count || 0} commentaire(s) · ${card.report_count || 0} signalement(s) · ${warnings} avertissement(s)
      </p>
      <p class="meta">
        Communauté : ${locked ? "coupée" : card.community_enabled ? "ouverte" : "off"}
        ${suspended ? ` · suspendu jusqu’au ${escapeHtml(new Date(card.suspended_until).toLocaleString("fr-FR"))}` : ""}
      </p>
      ${locked && card.community_lock_reason ? `<p class="warn">Coupure : ${escapeHtml(card.community_lock_reason)}</p>` : ""}
      ${warnings >= 1 ? `<p class="warn">Déjà averti. La suspension est souvent la suite.</p>` : ""}
      <div class="actions">
        <button class="btn" data-action="act" data-kind="user" data-id="${card.user_id}" data-op="warn" data-warnings="${warnings}" data-submit="Avertir">${
          warnings >= 1 ? "Avertir encore" : "Avertir"
        }</button>
        <button class="btn danger" data-action="act" data-kind="user" data-id="${card.user_id}" data-op="suspend" data-extra="suspend" data-submit="Suspendre" data-danger="true">Suspendre</button>
        ${
          locked
            ? `<button class="btn" data-action="act" data-kind="user" data-id="${card.user_id}" data-op="unlock_community" data-submit="Rétablir">Rétablir la communauté</button>`
            : `<button class="btn danger" data-action="act" data-kind="user" data-id="${card.user_id}" data-op="lock_community" data-submit="Couper" data-danger="true">Couper la communauté</button>`
        }
      </div>
    </div>
    <div class="layout-split" style="margin-top:18px">
      <div class="panel">
        <h2>Messages</h2>
        ${
          (card.posts || []).map((post) => `
            <div class="row">
              <div>
                <span class="tag">${escapeHtml(KIND_LABELS[post.kind] || post.kind)}</span>
                ${post.is_deleted ? `<span class="tag">Masqué</span>` : ""}
                <div>${escapeHtml(post.body)}</div>
                <div class="meta">${escapeHtml(age(post.created_at))}</div>
                <div class="actions">
                  ${
                    post.is_deleted
                      ? `<button class="btn" data-action="act" data-kind="post" data-id="${post.id}" data-op="restore" data-submit="Rétablir">Rétablir</button>`
                      : `<button class="btn danger" data-action="act" data-kind="post" data-id="${post.id}" data-op="hide" data-submit="Masquer" data-danger="true">Masquer</button>`
                  }
                </div>
              </div>
            </div>
          `).join("") || `<p class="empty">Aucun message.</p>`
        }
      </div>
      <div class="panel">
        <h2>Signalements reçus</h2>
        ${
          (card.reports || []).map((report) => `
            <div class="row">
              <div>
                <strong>${escapeHtml(report.status)}</strong>
                ${report.reporter_username ? ` · par ${usernameBtn(report.reporter_username)}` : ""}
                <div class="meta">« ${escapeHtml(report.reason)} » · ${escapeHtml(age(report.created_at))}</div>
              </div>
            </div>
          `).join("") || `<p class="empty">Aucun signalement.</p>`
        }
        <h2 style="margin-top:22px">Avertissements</h2>
        ${
          (card.warnings || []).map((warning) => `
            <div class="row">
              <div>
                <div>${escapeHtml(warning.reason)}</div>
                <div class="meta">${escapeHtml(age(warning.created_at))}</div>
              </div>
            </div>
          `).join("") || `<p class="empty">Aucun avertissement.</p>`
        }
      </div>
    </div>
  `;
}

function noticeView() {
  return `
    <form class="panel stack" id="notice-form">
      <p class="muted">Une ligne épinglée en haut de la communauté. Vide pour la retirer.</p>
      <textarea class="field" name="body" rows="4" maxlength="280" placeholder="Les paris n’ont pas leur place ici.">${escapeHtml(state.notice.body || "")}</textarea>
      <div class="actions">
        <button class="btn brand" type="submit">Enregistrer</button>
      </div>
    </form>
  `;
}

function domainsView() {
  const rows = state.domains.filter((row) => matchesQuery(row.domain));
  return `
    <form class="toolbar" id="domain-form">
      <input class="search" name="domain" placeholder="nouveau-casino.com" autocomplete="off" />
      <button class="btn brand" type="submit">Ajouter</button>
    </form>
    <div class="toolbar">
      <input class="search" name="query" placeholder="Rechercher un domaine ajouté ici" value="${escapeHtml(state.query)}" />
    </div>
    <p class="muted">Seuls les domaines ajoutés par un admin apparaissent ici. La liste bundlée de l’app reste dans l’app.</p>
    <div class="panel">
      ${
        rows.map((row) => `
          <div class="row">
            <div>
              <strong>${escapeHtml(row.domain)}</strong>
              <div class="meta">Ajouté ${escapeHtml(age(row.created_at))}</div>
            </div>
            <button class="btn danger" data-action="remove-domain" data-domain="${escapeHtml(row.domain)}">Retirer</button>
          </div>
        `).join("") || `<p class="empty">Aucun domaine distant pour l’instant.</p>`
      }
    </div>
  `;
}

function dialogView() {
  const dialog = state.dialog;
  return `
    <div class="dialog-backdrop">
      <form class="dialog stack" id="dialog-form">
        <h2>${escapeHtml(dialog.title)}</h2>
        ${dialog.hint ? `<p class="warn">${escapeHtml(dialog.hint)}</p>` : ""}
        ${dialog.fields.map((field) => field.type === "number"
          ? `<label class="muted">${escapeHtml(field.label)}<input class="field" type="number" min="1" max="365" name="${field.name}" value="${field.value || ""}" required /></label>`
          : `<label class="muted">${escapeHtml(field.label)}<textarea class="field" name="${field.name}" rows="3" placeholder="${escapeHtml(field.placeholder || "")}" required></textarea></label>`
        ).join("")}
        <div class="actions">
          <button class="btn ${dialog.danger ? "danger" : "brand"}" type="submit">${escapeHtml(dialog.submit)}</button>
          <button class="btn" type="button" data-action="close-dialog">Annuler</button>
        </div>
      </form>
    </div>
  `;
}

function usernameBtn(name, fallback = "Compte") {
  const lookup = name || null;
  if (!lookup) return escapeHtml(fallback);
  return `<span class="username" data-action="open-member" data-username="${escapeHtml(lookup)}">@${escapeHtml(lookup)}</span>`;
}

function actTitle(op, warnings) {
  if (op === "warn") return warnings >= 1 ? "Nouveau avertissement" : "Avertir";
  if (op === "hide") return "Masquer ce contenu";
  if (op === "restore") return "Rétablir ce contenu";
  if (op === "suspend") return "Suspendre ce compte";
  if (op === "lock_community") return "Couper la communauté";
  if (op === "unlock_community") return "Rétablir la communauté";
  return "Confirmer";
}

async function loadBrowse() {
  state.loading = true;
  render();
  try {
    state.browse = (await rpc("browse", {
      query: state.browseQuery,
      since: state.browseSince,
      until_date: state.browseUntil,
      max_rows: 200,
    })) || [];
    if (state.browseSelected) {
      state.browseSelected =
        state.browse.find((row) => row.target_id === state.browseSelected.target_id) || null;
    }
    state.error = null;
  } catch (error) {
    state.error = frenchError(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function loadMember(lookup) {
  const needle = String(lookup || "").trim();
  state.memberQuery = needle.replace(/^@/, "");
  if (!state.memberQuery) return;
  state.section = "members";
  state.loading = true;
  render();
  try {
    state.member = await rpc("member", { lookup: state.memberQuery });
    state.error = null;
  } catch (error) {
    state.member = null;
    state.error = frenchError(error);
  } finally {
    state.loading = false;
    render();
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
