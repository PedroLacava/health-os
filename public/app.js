import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const metricDefinitions = [
  { type: "training.readiness", label: "Prontidão", unit: "/100", format: round, direction: 1 },
  { type: "sleep.score", label: "Sono", unit: "/100", format: round, direction: 1 },
  { type: "sleep.duration", label: "Duração do sono", unit: "", format: duration, direction: 1 },
  { type: "daily.heart_rate.resting", label: "FC de repouso", unit: " bpm", format: round, direction: -1 },
  { type: "fitness.vo2_max", label: "VO₂ máx.", unit: " ml/kg/min", format: oneDecimal, direction: 1 },
  { type: "daily.stress.average", label: "Estresse médio", unit: "/100", format: round, direction: -1 },
  { type: "daily.steps", label: "Passos", unit: "", format: number, direction: 1 },
  { type: "training.load.acute", label: "Carga aguda", unit: "", format: round, direction: 0 },
];

const state = { supabase: null, metrics: new Map(), days: 30 };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function round(value) { return Math.round(value).toLocaleString("pt-BR"); }
function oneDecimal(value) { return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 }); }
function number(value) { return Math.round(value).toLocaleString("pt-BR"); }
function duration(seconds) {
  const minutes = Math.round(seconds / 60);
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}`;
}
function distance(metres) { return `${(metres / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} km`; }
function dateLabel(value) { return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(new Date(value)); }
function longDate(value) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeStyle: "short" }).format(new Date(value)); }

function average(items) {
  if (!items.length) return null;
  return items.reduce((sum, item) => sum + item.value, 0) / items.length;
}

function weeklyDelta(items, direction) {
  const now = new Date(items[0]?.recorded_at ?? 0).getTime();
  if (!now || direction === 0) return null;
  const day = 86_400_000;
  const current = average(items.filter((item) => now - new Date(item.recorded_at).getTime() < 7 * day));
  const previous = average(items.filter((item) => {
    const age = now - new Date(item.recorded_at).getTime();
    return age >= 7 * day && age < 14 * day;
  }));
  if (current === null || previous === null || previous === 0) return null;
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return { change, positive: change * direction >= 0 };
}

function sparkline(items) {
  const values = [...items].slice(0, state.days).reverse().map((item) => item.value).filter(Number.isFinite);
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 86 - ((value - min) / range) * 72;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M ${points.join(" L ")}`;
  const area = `${line} L 100,96 L 0,96 Z`;
  return `<svg class="sparkline" viewBox="0 0 100 96" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${area}"></path><path d="${line}"></path></svg>`;
}

function renderSummary() {
  const featured = metricDefinitions.slice(0, 4);
  $("#summary-cards").innerHTML = featured.map((definition) => {
    const items = state.metrics.get(definition.type) ?? [];
    const latest = items[0];
    const delta = weeklyDelta(items, definition.direction);
    const deltaMarkup = delta
      ? `<p class="delta ${delta.positive ? "positive" : "negative"}">${delta.change >= 0 ? "+" : ""}${delta.change.toFixed(0)}% vs. 7 dias anteriores</p>`
      : `<p class="delta muted">Sem comparação disponível</p>`;
    return `<article class="summary-card"><div><span class="card-label">${definition.label}</span><div class="card-value">${latest ? definition.format(latest.value) : "–"}<span class="card-unit">${definition.unit}</span></div></div>${deltaMarkup}</article>`;
  }).join("");
}

function renderTrends() {
  $("#trend-grid").innerHTML = metricDefinitions.slice(4).map((definition) => {
    const items = state.metrics.get(definition.type) ?? [];
    const visible = items.slice(0, state.days);
    const latest = visible[0];
    return `<article class="trend-card"><div class="trend-head"><div><div class="card-label">${definition.label}</div><div class="trend-meta">${visible.length} registros</div></div><div class="trend-value">${latest ? definition.format(latest.value) : "–"}<span class="card-unit">${definition.unit}</span></div></div>${sparkline(visible)}</article>`;
  }).join("");
}

function renderActivities() {
  const durations = state.metrics.get("activity.duration") ?? [];
  const distances = new Map((state.metrics.get("activity.distance") ?? []).map((item) => [item.external_id, item]));
  if (!durations.length) {
    $("#activities").innerHTML = `<div class="empty">Nenhuma atividade encontrada no período.</div>`;
    return;
  }
  $("#activities").innerHTML = durations.slice(0, 8).map((item) => {
    const activityDistance = distances.get(item.external_id);
    return `<article class="activity"><div><strong>Atividade Garmin</strong><span>${dateLabel(item.recorded_at)}</span></div><div class="activity-stat">${duration(item.value)}</div><div class="activity-stat">${activityDistance ? distance(activityDistance.value) : "–"}</div></article>`;
  }).join("");
}

function render() {
  renderSummary();
  renderTrends();
  renderActivities();
  const latest = [...state.metrics.values()].flat().sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))[0];
  $("#freshness").textContent = latest ? `Dados Garmin atualizados até ${longDate(latest.recorded_at)}` : "Nenhum dado encontrado";
}

async function fetchMetric(type) {
  const from = new Date();
  from.setDate(from.getDate() - 120);
  const { data, error } = await state.supabase.from("metrics")
    .select("external_id,type,recorded_at,value,unit")
    .eq("type", type)
    .gte("recorded_at", from.toISOString())
    .not("value", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  state.metrics.set(type, data ?? []);
}

async function loadDashboard() {
  $("#dashboard-error").classList.add("hidden");
  const types = [...metricDefinitions.map((item) => item.type), "activity.duration", "activity.distance"];
  try {
    await Promise.all(types.map(fetchMetric));
    render();
  } catch (error) {
    $("#dashboard-error").textContent = `Não foi possível carregar os dados: ${error.message}`;
    $("#dashboard-error").classList.remove("hidden");
  }
}

function setSignedIn(signedIn) {
  $("#login").classList.toggle("hidden", signedIn);
  $("#dashboard").classList.toggle("hidden", !signedIn);
  $("#logout").classList.toggle("hidden", !signedIn);
}

async function start() {
  const response = await fetch("/v1/client-config");
  if (!response.ok) throw new Error("Configuração do Supabase indisponível");
  const config = await response.json();
  state.supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);
  const { data: { session } } = await state.supabase.auth.getSession();
  setSignedIn(Boolean(session));
  if (session) await loadDashboard();
  state.supabase.auth.onAuthStateChange(async (event, nextSession) => {
    if (event === "SIGNED_IN" && nextSession) {
      setSignedIn(true);
      await loadDashboard();
    }
    if (event === "SIGNED_OUT") setSignedIn(false);
  });
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = $("#login-message");
  const button = event.currentTarget.querySelector("button");
  message.textContent = "Enviando...";
  button.disabled = true;
  const email = new FormData(event.currentTarget).get("email");
  const { error } = await state.supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: window.location.origin },
  });
  message.textContent = error ? error.message : "Link enviado. Confira seu e-mail.";
  button.disabled = false;
});

$("#logout").addEventListener("click", () => state.supabase.auth.signOut());
$$('.period').forEach((button) => button.addEventListener("click", () => {
  state.days = Number(button.dataset.days);
  $$('.period').forEach((item) => item.classList.toggle("active", item === button));
  render();
}));

start().catch((error) => {
  $("#login-message").textContent = error.message;
});
