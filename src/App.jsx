import React, { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import {
  Folder, FolderOpen, Plus, Pencil, Trash2, Shuffle, Download, BarChart3, Flame,
  Menu, X, Check, RotateCcw, ChevronLeft, ChevronRight, Upload, HardDrive,
  BookOpen, Brain, PencilLine, ChevronDown, Plug, FolderSync, Settings2, Volume2,
  Maximize2, Minimize2
} from 'lucide-react';
import AuthScreen from './AuthScreen';

/* =====================================================================
   Hilfsfunktionen
   ===================================================================== */
const uid = () => crypto.randomUUID();
const isUUID = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const MS_DAY = 86400000;
const startOfDay = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayStr = (d = new Date()) => startOfDay(d).toISOString().slice(0, 10);
const addDays = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
const isDue = (card) => startOfDay(new Date(card.due)).getTime() <= startOfDay().getTime();
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const isTyping = () => {
  const t = document.activeElement;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};

const shuffleArr = (arr) => {           // Fisher-Yates (kopiert)
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

/* ---------- Karten-/Ordner-Fabriken (setzen SM-2-Defaults) ---------- */
function mkCard(p = {}) {
  return {
    id: (p.id && isUUID(p.id)) ? p.id : uid(),  // Nur echte UUIDs übernehmen
    term: p.term || '',
    def: p.def || '',
    cat: p.cat || '',
    catLabel: p.catLabel || p.cat || '',
    image: p.image || null,          // Base64-String oder null
    ease: typeof p.ease === 'number' ? p.ease : 2.5,
    interval: typeof p.interval === 'number' ? p.interval : 0,
    repetitions: typeof p.repetitions === 'number' ? p.repetitions : 0,
    due: p.due || startOfDay().toISOString(),
    totalReviews: p.totalReviews || 0,
    correctReviews: p.correctReviews || 0,
    createdAt: p.createdAt || new Date().toISOString(),
  };
}
function mkFolder(name, cards = []) {
  return {
    id: uid(),
    name,
    dirName: null,
    cards: cards.map(mkCard),
    dailyGoal: 20,
    streak: 0,
    lastStudied: null,
  };
}

/* ---------- SM-2 ---------- */
function applySM2(card, quality) {
  let { ease = 2.5, interval = 0, repetitions = 0 } = card;
  if (quality < 3) {
    interval = 1;
    repetitions = 0;
  } else {
    if (repetitions === 0) interval = 1;
    else if (repetitions === 1) interval = 6;
    else interval = Math.round(interval * ease);
    repetitions += 1;
  }
  ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  ease = Math.max(1.3, ease);
  return {
    ...card,
    ease,
    interval,
    repetitions,
    due: addDays(new Date(), interval).toISOString(),
    totalReviews: (card.totalReviews || 0) + 1,
    correctReviews: (card.correctReviews || 0) + (quality >= 3 ? 1 : 0),
  };
}

/* ---------- Klassifikation für Statistik ---------- */
function classify(card) {
  const r = card.repetitions || 0;
  if (r === 0) return 'neu';
  if (r <= 2) return 'lernend';
  if ((card.interval || 0) > 21) return 'beherrscht';
  if ((card.ease || 0) > 2.0) return 'vertraut';
  return 'lernend';
}

/* ---------- Streak-Update pro Ordner ---------- */
function applyStreak(folder) {
  const today = dayStr();
  if (folder.lastStudied === today) return folder;
  const yest = dayStr(new Date(Date.now() - MS_DAY));
  let streak = folder.streak || 0;
  streak = folder.lastStudied === yest ? streak + 1 : 1;
  return { ...folder, streak, lastStudied: today };
}

/* =====================================================================
   Parser: HTML & CSV
   ===================================================================== */
function parseCardsFromHTML(text) {
  const m = text.match(/(?:const|let|var)\s+cards\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (m) {
    try {
      const arr = Function('"use strict";return (' + m[1] + ')')();
      if (Array.isArray(arr)) return arr.filter(x => x && (x.term || x.def)).map(mkCard);
    } catch (e) { console.warn('cards-Array nicht auswertbar', e); }
  }
  try {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const terms = [...doc.querySelectorAll('.card-term, .term')];
    if (terms.length) return terms.map(t => mkCard({ term: t.textContent.trim() }));
  } catch (e) {}
  return [];
}

function splitCSVLine(line, delim) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else {
      if (ch === '"') q = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return [];
  const delim = (lines[0].split(';').length >= lines[0].split(',').length) ? ';' : ',';
  let rows = lines.map(l => splitCSVLine(l, delim));
  const headerKW = ['begriff', 'term', 'definition', 'erklärung', 'erklarung', 'frage', 'antwort', 'kategorie', 'front', 'back'];
  const first = rows[0].map(c => c.toLowerCase());
  if (first.some(c => headerKW.includes(c))) rows = rows.slice(1);
  return rows
    .filter(r => r[0])
    .map(r => mkCard({ term: r[0], def: r[1] || '', catLabel: r[2] || '', cat: '' }));
}

function parseFile(name, text) {
  if (/\.csv$/i.test(name)) return parseCSV(text);
  return parseCardsFromHTML(text);
}

/* =====================================================================
   IndexedDB – persistiert das File-System-Handle
   ===================================================================== */
const supportsFS = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('vk-fs', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readwrite');
    t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = () => rej(t.error);
  });
}
async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readonly');
    const rq = t.objectStore('kv').get(k);
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
  });
}

/* =====================================================================
   Supabase – Hilfsfunktionen
   ===================================================================== */
import { supabase } from './supabase';

// Konvertiert eine DB-Zeile → internes Card-Objekt
function dbRowToCard(row) {
  return mkCard({
    id:             row.id,
    term:           row.term,
    def:            row.def,
    cat:            row.cat,
    catLabel:       row.cat_label,
    image:          row.image || null,
    ease:           row.ease,
    interval:       row.interval,
    repetitions:    row.repetitions,
    due:            row.due,
    totalReviews:   row.total_reviews,
    correctReviews: row.correct_reviews,
    createdAt:      row.created_at,
  });
}

// Konvertiert internes Card-Objekt → DB-Insert/Update
function cardToDb(card, folderId, userId) {
  return {
    id:              card.id,
    folder_id:       folderId,
    user_id:         userId,
    term:            card.term,
    def:             card.def,
    cat:             card.cat,
    cat_label:       card.catLabel || '',
    image:           card.image || null,
    ease:            card.ease,
    interval:        card.interval,
    repetitions:     card.repetitions,
    due:             card.due,
    total_reviews:   card.totalReviews,
    correct_reviews: card.correctReviews,
    created_at:      card.createdAt,
  };
}

// Konvertiert eine DB-Zeile → internes Folder-Objekt
function dbRowToFolder(row, cards = []) {
  return {
    id:          row.id,
    name:        row.name,
    dirName:     row.dir_name || null,
    dailyGoal:   row.daily_goal || 20,
    streak:      row.streak || 0,
    lastStudied: row.last_studied || null,
    cards,
  };
}

// Konvertiert internen Folder → DB-Insert/Update
function folderToDb(folder, userId) {
  return {
    id:           folder.id,
    user_id:      userId,
    name:         folder.name,
    daily_goal:   folder.dailyGoal || 20,
    streak:       folder.streak || 0,
    last_studied: folder.lastStudied || null,
    dir_name:     folder.dirName || null,
  };
}

const HISTORY_KEY = 'vokabelkarten.history';
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || {}; } catch { return {}; }
}

/* =====================================================================
   Zentraler Store-Hook (Supabase-Backend)
   ===================================================================== */
function useLearningStore(toast, userId) {
  const [folders, setFolders]           = useState([]);
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [history, setHistory]           = useState(loadHistory);
  const [loading, setLoading]           = useState(true);

  const activeFolder = useMemo(
    () => folders.find(f => f.id === activeFolderId) || folders[0] || null,
    [folders, activeFolderId]
  );

  /* ---- Initialer Datenlad ---- */
  useEffect(() => {
    if (!userId) return;
    (async () => {
      setLoading(true);
      const { data: foldersData, error } = await supabase
        .from('folders')
        .select('*, cards(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (error) { toast('Fehler beim Laden: ' + error.message); setLoading(false); return; }

      const parsed = (foldersData || []).map(f =>
        dbRowToFolder(f, (f.cards || []).map(dbRowToCard))
      );
      setFolders(parsed);
      if (parsed.length) setActiveFolderId(parsed[0].id);
      setLoading(false);
    })();
  }, [userId]); // eslint-disable-line

  const bumpHistory = useCallback(() => {
    setHistory(prev => {
      const k = dayStr();
      const next = { ...prev, [k]: (prev[k] || 0) + 1 };
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  /* ---- Ordner-Aktionen ---- */
  const addFolder = useCallback(async (name) => {
    const f = mkFolder(name);
    const { data, error } = await supabase
      .from('folders')
      .insert(folderToDb(f, userId))
      .select()
      .single();
    if (error) { toast('Fehler: ' + error.message); return; }
    const newFolder = dbRowToFolder(data, []);
    setFolders(prev => [...prev, newFolder]);
    setActiveFolderId(newFolder.id);
  }, [userId, toast]);

  const renameFolder = useCallback(async (id, name) => {
    const { error } = await supabase
      .from('folders').update({ name }).eq('id', id).eq('user_id', userId);
    if (error) { toast('Fehler: ' + error.message); return; }
    setFolders(prev => prev.map(f => f.id === id ? { ...f, name } : f));
  }, [userId, toast]);

  const deleteFolder = useCallback(async (id) => {
    const { error } = await supabase
      .from('folders').delete().eq('id', id).eq('user_id', userId);
    if (error) { toast('Fehler: ' + error.message); return; }
    setFolders(prev => {
      const next = prev.filter(f => f.id !== id);
      setActiveFolderId(cur => cur === id ? (next[0]?.id || null) : cur);
      return next;
    });
  }, [userId, toast]);

  const setDailyGoal = useCallback(async (id, goal) => {
    const { error } = await supabase
      .from('folders').update({ daily_goal: goal }).eq('id', id).eq('user_id', userId);
    if (error) { toast('Fehler: ' + error.message); return; }
    setFolders(prev => prev.map(f => f.id === id ? { ...f, dailyGoal: goal } : f));
  }, [userId, toast]);

  /* ---- Karten-Aktionen ---- */
  const addCard = useCallback(async (folderId, data) => {
    const card = mkCard(data);
    const { error } = await supabase
      .from('cards').insert(cardToDb(card, folderId, userId));
    if (error) { toast('Fehler: ' + error.message); return; }
    setFolders(prev => prev.map(f =>
      f.id === folderId ? { ...f, cards: [...f.cards, card] } : f
    ));
  }, [userId, toast]);

  const updateCard = useCallback(async (folderId, cardId, data) => {
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;
    const existing = folder.cards.find(c => c.id === cardId);
    if (!existing) return;
    const updated = { ...existing, ...data };
    const { error } = await supabase
      .from('cards').update(cardToDb(updated, folderId, userId)).eq('id', cardId).eq('user_id', userId);
    if (error) { toast('Fehler: ' + error.message); return; }
    setFolders(prev => prev.map(f =>
      f.id === folderId ? { ...f, cards: f.cards.map(c => c.id === cardId ? updated : c) } : f
    ));
  }, [folders, userId, toast]);

  const updateCardImage = useCallback(async (folderId, cardId, image) => {
    const { error } = await supabase
      .from('cards').update({ image }).eq('id', cardId).eq('user_id', userId);
    if (error) { toast('Fehler: ' + error.message); return; }
    setFolders(prev => prev.map(f =>
      f.id === folderId ? { ...f, cards: f.cards.map(c => c.id === cardId ? { ...c, image } : c) } : f
    ));
  }, [userId, toast]);

  const deleteCard = useCallback(async (folderId, cardId) => {
    const { error } = await supabase
      .from('cards').delete().eq('id', cardId).eq('user_id', userId);
    if (error) { toast('Fehler: ' + error.message); return; }
    setFolders(prev => prev.map(f =>
      f.id === folderId ? { ...f, cards: f.cards.filter(c => c.id !== cardId) } : f
    ));
  }, [userId, toast]);

  const importCards = useCallback(async (target, cards) => {
    if (target.mode === 'new') {
      const f = mkFolder(target.name);
      const { data: folderData, error: fErr } = await supabase
        .from('folders').insert(folderToDb(f, userId)).select().single();
      if (fErr) { toast('Fehler: ' + fErr.message); return; }
      const newFolder = dbRowToFolder(folderData, []);
      const newCards  = cards.map(mkCard);
      const rows      = newCards.map(c => cardToDb(c, newFolder.id, userId));
      const { error: cErr } = await supabase.from('cards').insert(rows);
      if (cErr) { toast('Fehler: ' + cErr.message); return; }
      setFolders(prev => [...prev, { ...newFolder, cards: newCards }]);
      setActiveFolderId(newFolder.id);
    } else {
      const newCards = cards.map(mkCard);
      const rows     = newCards.map(c => cardToDb(c, target.id, userId));
      const { error } = await supabase.from('cards').insert(rows);
      if (error) { toast('Fehler: ' + error.message); return; }
      setFolders(prev => prev.map(f =>
        f.id === target.id ? { ...f, cards: [...f.cards, ...newCards] } : f
      ));
      setActiveFolderId(target.id);
    }
  }, [userId, toast]);

  const reviewCard = useCallback(async (folderId, cardId, quality) => {
    bumpHistory();
    const folder = folders.find(f => f.id === folderId);
    if (!folder) return;
    const card    = folder.cards.find(c => c.id === cardId);
    if (!card) return;
    const updated = applySM2(card, quality);
    const updatedFolder = applyStreak(folder);

    // Karte + Ordner-Streak parallel updaten
    await Promise.all([
      supabase.from('cards')
        .update(cardToDb(updated, folderId, userId))
        .eq('id', cardId).eq('user_id', userId),
      supabase.from('folders')
        .update({ streak: updatedFolder.streak, last_studied: updatedFolder.lastStudied })
        .eq('id', folderId).eq('user_id', userId),
    ]);

    setFolders(prev => prev.map(f => {
      if (f.id !== folderId) return f;
      return {
        ...updatedFolder,
        cards: f.cards.map(c => c.id === cardId ? updated : c),
      };
    }));
  }, [folders, userId, bumpHistory]);

  return {
    folders, activeFolder, activeFolderId, setActiveFolderId, history, loading,
    fs: { supported: false, connected: false, pending: false, dirName: '', saveStatus: 'Supabase' },
    addFolder, renameFolder, deleteFolder, setDailyGoal,
    addCard, updateCard, updateCardImage, deleteCard, importCards, reviewCard,
  };
}

/* =====================================================================
   Kontext: Toast
   ===================================================================== */
const ToastCtx = createContext(() => {});
const useToast = () => useContext(ToastCtx);

/* =====================================================================
   Semantic Similarity – Transformers.js (läuft komplett im Browser)
   Modell: Xenova/all-MiniLM-L6-v2  (~25 MB, wird einmalig gecacht)
   ===================================================================== */
const EmbedderCtx = createContext(null);
const useEmbedder = () => useContext(EmbedderCtx);

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

function EmbedderProvider({ children }) {
  // status: 'idle' | 'loading' | 'ready' | 'error'
  const [status, setStatus] = useState('idle');
  const pipeRef = useRef(null);

  // Lazy-load Transformers.js the first time similarity is needed
  const ensureReady = useCallback(async () => {
    if (pipeRef.current) return pipeRef.current;
    if (status === 'loading') {
      // Wait until ready
      return new Promise((res, rej) => {
        const t = setInterval(() => {
          if (pipeRef.current) { clearInterval(t); res(pipeRef.current); }
          if (status === 'error') { clearInterval(t); rej(new Error('Modell konnte nicht geladen werden')); }
        }, 200);
      });
    }
    setStatus('loading');
    try {
      const { pipeline, env } = await import(
        'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js'
      );
      env.allowLocalModels = false;
      const pipe = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', { quantized: true });
      pipeRef.current = pipe;
      setStatus('ready');
      return pipe;
    } catch (e) {
      setStatus('error');
      throw e;
    }
  }, [status]);

  const embed = useCallback(async (text) => {
    const pipe = await ensureReady();
    const out = await pipe(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }, [ensureReady]);

  const similarity = useCallback(async (a, b) => {
    const [va, vb] = await Promise.all([embed(a), embed(b)]);
    return cosineSim(va, vb);
  }, [embed]);

  return (
    <EmbedderCtx.Provider value={{ similarity, status }}>
      {children}
    </EmbedderCtx.Provider>
  );
}

/* =====================================================================
   Text-to-Speech
   Primär: ElevenLabs API (hohe Qualität, API-Key in localStorage)
   Fallback: Web Speech API (kostenlos, im Browser)
   ===================================================================== */
const TTS_KEY_STORAGE = 'vokabelkarten.elevenlabs_key';
const TTS_VOICE_STORAGE = 'vokabelkarten.elevenlabs_voice';
// Gute deutsche ElevenLabs-Stimme als Default (Sarah – mehrsprachig)
const TTS_DEFAULT_VOICE = 'EXAVITQu4vr4xnSDxMaL';

function useSpeech() {
  const [speaking, setSpeaking]   = useState(false);
  const [provider, setProvider]   = useState('detecting');
  const audioRef = useRef(null);
  const wsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Detect provider on mount
  useEffect(() => {
    const key = localStorage.getItem(TTS_KEY_STORAGE);
    setProvider(key ? 'elevenlabs' : 'browser');
  }, []);

  // Stop helper
  const stop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (wsSupported) window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [wsSupported]);

  // ElevenLabs TTS
  const speakElevenLabs = useCallback(async (text) => {
    const key   = localStorage.getItem(TTS_KEY_STORAGE);
    const voice = localStorage.getItem(TTS_VOICE_STORAGE) || TTS_DEFAULT_VOICE;
    if (!key) return false;
    try {
      setSpeaking(true);
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: 'POST',
        headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_turbo_v2_5',   // schnell + mehrsprachig
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
      if (!res.ok) { setSpeaking(false); return false; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      audio.onerror = () => { setSpeaking(false); URL.revokeObjectURL(url); };
      await audio.play();
      return true;
    } catch { setSpeaking(false); return false; }
  }, []);

  // Browser Web Speech fallback
  const speakBrowser = useCallback((text) => {
    if (!wsSupported) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'de-DE';
    const voices = window.speechSynthesis.getVoices();
    const deVoice = voices.find(v => v.lang.startsWith('de') && v.localService)
                 || voices.find(v => v.lang.startsWith('de'));
    if (deVoice) utt.voice = deVoice;
    utt.rate = 0.95;
    utt.onstart = () => setSpeaking(true);
    utt.onend   = () => setSpeaking(false);
    utt.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utt);
  }, [wsSupported]);

  const speak = useCallback(async (text) => {
    if (!text) return;
    stop();
    const key = localStorage.getItem(TTS_KEY_STORAGE);
    if (key) {
      const ok = await speakElevenLabs(text);
      if (!ok) speakBrowser(text);   // Fallback bei API-Fehler
    } else {
      speakBrowser(text);
    }
  }, [stop, speakElevenLabs, speakBrowser]);

  // Refresh provider when key changes (called by settings dialog)
  const refreshProvider = useCallback(() => {
    const key = localStorage.getItem(TTS_KEY_STORAGE);
    setProvider(key ? 'elevenlabs' : 'browser');
  }, []);

  return { speak, stop, speaking, supported: wsSupported || true, provider, refreshProvider };
}

// Kleiner Lautsprecher-Button, wiederverwendbar
function SpeakButton({ text, speech }) {
  if (!text) return null;
  return (
    <button
      onClick={(e) => { e.stopPropagation(); speech.speaking ? speech.stop() : speech.speak(text); }}
      title={speech.speaking ? 'Stoppen' : 'Vorlesen'}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 28, height: 28, borderRadius: '50%', border: '1px solid var(--border-2)',
        background: speech.speaking ? 'var(--accent-soft)' : 'var(--surface)',
        color: speech.speaking ? 'var(--accent-text)' : 'var(--text-3)',
        cursor: 'pointer', flexShrink: 0, transition: 'all .15s',
      }}
    >
      <Volume2 size={13} />
    </button>
  );
}

/* =====================================================================
   TTS-Einstellungen Dialog
   ===================================================================== */
function TTSSettingsDialog({ onClose, onSaved }) {
  const [key,   setKey]   = useState(() => localStorage.getItem(TTS_KEY_STORAGE) || '');
  const [voice, setVoice] = useState(() => localStorage.getItem(TTS_VOICE_STORAGE) || TTS_DEFAULT_VOICE);
  const [testing, setTesting]   = useState(false);
  const [testResult, setTestResult] = useState(null); // null | 'ok' | 'error'
  const toast = useToast();

  const VOICES = [
    { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah (mehrsprachig, warm)' },
    { id: 'TX3LPaxmHKxFdv7VOQHJ',  label: 'Liam (mehrsprachig, klar)' },
    { id: 'pFZP5JQG7iQjIQuC4Bku',  label: 'Lily (mehrsprachig, sanft)' },
    { id: 'onwK4e9ZLuTAKqWW03F9',  label: 'Daniel (Englisch, tief)' },
  ];

  const save = () => {
    if (key.trim()) {
      localStorage.setItem(TTS_KEY_STORAGE, key.trim());
      localStorage.setItem(TTS_VOICE_STORAGE, voice);
    } else {
      localStorage.removeItem(TTS_KEY_STORAGE);
      localStorage.removeItem(TTS_VOICE_STORAGE);
    }
    onSaved();
    onClose();
    toast(key.trim() ? 'ElevenLabs aktiviert ✓' : 'Browser-Stimme aktiv');
  };

  const testVoice = async () => {
    const k = key.trim();
    if (!k) return toast('Bitte zuerst einen API-Key eingeben');
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: 'POST',
        headers: { 'xi-api-key': k, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hallo, ich bin deine Lernassistentin.',
          model_id: 'eleven_turbo_v2_5',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      });
      if (!res.ok) { setTestResult('error'); return; }
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
      setTestResult('ok');
    } catch { setTestResult('error'); }
    finally { setTesting(false); }
  };

  return (
    <Modal title="Sprachausgabe-Einstellungen" onClose={onClose} wide
      footer={<>
        <button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn primary" onClick={save}>Speichern</button>
      </>}>

      <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.6,
        background: 'var(--accent-soft)', borderRadius: 8, padding: '10px 12px' }}>
        <strong>ElevenLabs</strong> bietet hochwertige deutsche Stimmen.<br />
        Kostenloses Konto: <a href="https://elevenlabs.io" target="_blank" rel="noreferrer"
          style={{ color: 'var(--accent-text)' }}>elevenlabs.io</a> → API-Key unter <em>Profile → API Key</em>.<br />
        Free Tier: 10.000 Zeichen/Monat (ca. 5.000 Kartenvorlesungen).
      </div>

      <div className="field">
        <label>ElevenLabs API-Key (leer lassen = Browser-Stimme)</label>
        <input
          type="password"
          value={key}
          onChange={(e) => { setKey(e.target.value); setTestResult(null); }}
          placeholder="sk-..."
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label>Stimme</label>
        <select value={voice} onChange={(e) => { setVoice(e.target.value); setTestResult(null); }}>
          {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="btn sm" onClick={testVoice} disabled={testing}>
          <Volume2 size={14} />{testing ? 'Teste…' : 'Stimme testen'}
        </button>
        {testResult === 'ok'    && <span style={{ fontSize: 13, color: '#1f9956' }}>✓ Verbindung erfolgreich</span>}
        {testResult === 'error' && <span style={{ fontSize: 13, color: '#cf5a52' }}>✗ Fehler – Key prüfen</span>}
      </div>
    </Modal>
  );
}


const CATS = {
  grundlagen: { label: 'Grundlagen', cls: 'cat-grundlagen' },
  normen: { label: 'Normen', cls: 'cat-normen' },
  auslegung: { label: 'Auslegung', cls: 'cat-auslegung' },
  quellen: { label: 'Rechtsquellen', cls: 'cat-quellen' },
  urheberrecht: { label: 'Urheberrecht', cls: 'cat-urheberrecht' },
};
const catClass = (c) => (CATS[c]?.cls) || 'cat-default';

function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => { if (e.target.classList.contains('modal-bg')) onClose(); }}>
      <div className="modal" style={wide ? { maxWidth: 560 } : null}>
        <div className="modal-head">{title}<button className="icon-btn" onClick={onClose} aria-label="Schließen"><X size={16} /></button></div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* =====================================================================
   Sidebar
   ===================================================================== */
function ConnectionStatus({ fs }) {
  if (!fs.supported) {
    return (
      <div className="conn">
        <div className="conn-row"><span className="dot off" /><span>Browser-Speicher (lokal)</span></div>
        <div className="conn-sub">File System API nicht verfügbar</div>
      </div>
    );
  }
  if (fs.connected) {
    return (
      <div className="conn connected">
        <div className="conn-row"><span className="dot" /><span className="path">{fs.dirName}/</span></div>
        <div className="conn-sub">{fs.saveStatus}</div>
      </div>
    );
  }
  return (
    <div className="conn">
      <div className="conn-row"><span className="dot off" /><span>{fs.pending ? 'Nicht verbunden' : 'Nur Browser-Speicher'}</span></div>
      <div className="conn-sub">{fs.pending ? 'Klicke „Verbinden"' : 'Wähle einen Arbeitsordner'}</div>
    </div>
  );
}

function Sidebar({ store, open, onClose, onImportClick, onNewFolder }) {
  const { folders, activeFolderId, setActiveFolderId, fs, deleteFolder } = store;
  return (
    <>
      <div className={'backdrop' + (open ? ' show' : '')} onClick={onClose} />
      <aside className={'sidebar' + (open ? ' open' : '')}>
        <div className="sidebar-head">
          <div className="brand"><span className="brand-dot" />Vokabelkarten</div>
          <div className="brand-sub">Spaced Repetition</div>
        </div>
        <div className="folder-list">
          {folders.map(f => {
            const due = f.cards.filter(isDue).length;
            const active = f.id === activeFolderId;
            return (
              <div key={f.id} className={'folder' + (active ? ' active' : '')}
                onClick={() => { setActiveFolderId(f.id); onClose(); }}>
                {active ? <FolderOpen size={16} /> : <Folder size={16} />}
                <span className="folder-name">{f.name}</span>
                {due > 0 && <span className="due-badge">{due}</span>}
                <span className="count">{f.cards.length}</span>
                <button className="del" title="Löschen" onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Ordner „${f.name}" mit ${f.cards.length} Karte(n) löschen?`)) deleteFolder(f.id);
                }}><X size={13} /></button>
              </div>
            );
          })}
        </div>
        <div className="sidebar-foot">
          <ConnectionStatus fs={fs} />
          {fs.supported && (fs.connected ? (
            <>
              <button className="btn sm" onClick={fs.syncAll}><HardDrive size={14} />Alles speichern</button>
              <button className="btn sm" onClick={fs.choose}><FolderSync size={14} />Ordner wechseln</button>
            </>
          ) : fs.pending ? (
            <>
              <button className="btn sm primary" onClick={fs.reconnect}><Plug size={14} />Verbinden</button>
              <button className="btn sm" onClick={fs.choose}>Anderen Ordner wählen</button>
            </>
          ) : (
            <button className="btn sm primary" onClick={fs.choose}><HardDrive size={14} />Arbeitsordner wählen</button>
          ))}
          <button className="btn sm" onClick={onNewFolder}><Plus size={14} />Neuer Ordner</button>
          <button className="btn sm" onClick={onImportClick}><Upload size={14} />Importieren</button>
        </div>
      </aside>
    </>
  );
}

/* =====================================================================
   Topbar
   ===================================================================== */
const MODES = [
  { id: 'browse', label: 'Durchstöbern', Icon: BookOpen },
  { id: 'learn', label: 'Lernen', Icon: Brain },
  { id: 'recall', label: 'Test', Icon: PencilLine },
];

function ExportMenu({ folder, toast }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };
  const exportJSON = () => {
    const { id, ...payload } = folder;
    download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), sanitizeFile(folder.name) + '.json');
    setOpen(false); toast('JSON exportiert');
  };
  const exportCSV = () => {
    const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = ['Begriff;Definition;Kategorie',
      ...folder.cards.map(c => [c.term, c.def, c.catLabel || c.cat].map(esc).join(';'))];
    download(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }), sanitizeFile(folder.name) + '.csv');
    setOpen(false); toast('CSV exportiert');
  };
  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn sm" onClick={() => setOpen(o => !o)} title="Exportieren">
        <Download size={15} /><span className="hide-mobile">Export</span><ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu">
          <button onClick={exportJSON}>JSON (vollständig)</button>
          <button onClick={exportCSV}>CSV (Excel)</button>
        </div>
      )}
    </div>
  );
}
const sanitizeFile = (n) => (n || 'export').replace(/[\/\\:*?"<>|]/g, '-').trim();

// Reihenfolge-Optionen
const ORDER_OPTIONS = [
  { id: 'normal',    label: 'Normal',       icon: '↕' },
  { id: 'shuffle',   label: 'Zufällig',     icon: '🔀' },
  { id: 'due',       label: 'Fälligkeit',   icon: '⏰' },
  { id: 'reverse',   label: 'Umgekehrt',    icon: '↩' },
  { id: 'term_asc',  label: 'A → Z',        icon: '🔤' },
  { id: 'term_desc', label: 'Z → A',        icon: '🔤' },
];

function OrderMenu({ order, setOrder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const current = ORDER_OPTIONS.find(o => o.id === order) || ORDER_OPTIONS[0];
  return (
    <div className="menu-wrap" ref={ref}>
      <button className={'btn sm' + (order !== 'normal' ? ' primary' : '')}
        onClick={() => setOpen(o => !o)} title="Reihenfolge">
        <Shuffle size={15} /><span className="hide-mobile">{current.label}</span><ChevronDown size={13} />
      </button>
      {open && (
        <div className="menu">
          {ORDER_OPTIONS.map(o => (
            <button key={o.id} onClick={() => { setOrder(o.id); setOpen(false); }}
              style={{ fontWeight: o.id === order ? 600 : 400, color: o.id === order ? 'var(--accent-text)' : undefined }}>
              {o.icon} {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Topbar({ folder, mode, setMode, order, setOrder, onMenu, onStats, onNewCard, toast }) {
  const due = folder ? folder.cards.filter(isDue).length : 0;
  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-btn hamburger" onClick={onMenu} aria-label="Menü"><Menu size={18} /></button>
        <div className="title-wrap">
          <h1>{folder ? folder.name : '—'}</h1>
          <div className="sub">{folder ? `${folder.cards.length} Karten · ${due} fällig` : ''}</div>
        </div>
      </div>

      {folder && (
        <div className="mode-selector">
          {MODES.map(({ id, label, Icon }) => (
            <button key={id} className={'mode-btn' + (mode === id ? ' active' : '')} onClick={() => setMode(id)}>
              <Icon size={15} /><span className="hide-mobile">{label}</span>
            </button>
          ))}
        </div>
      )}

      {folder && (
        <div className="topbar-actions">
          <OrderMenu order={order} setOrder={setOrder} />
          <button className="btn sm" onClick={onStats} title="Statistiken"><BarChart3 size={15} /></button>
          <ExportMenu folder={folder} toast={toast} />
          <button className="btn sm primary" onClick={onNewCard}><Plus size={15} /><span className="hide-mobile">Karte</span></button>
        </div>
      )}
    </header>
  );
}

/* =====================================================================
   Bild-Hilfsfunktionen
   ===================================================================== */

// Liest eine Bilddatei als Base64-Data-URL
function readImageFile(file) {
  return new Promise((res, rej) => {
    if (!file.type.startsWith('image/')) { rej(new Error('Keine Bilddatei')); return; }
    const r = new FileReader();
    r.onload = (e) => res(e.target.result);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
}

// Zeigt das Kartenbild an (beide Seiten)
function CardImage({ src }) {
  if (!src) return null;
  return (
    <div style={{
      marginTop: '1.1rem',
      borderRadius: 10,
      overflow: 'hidden',
      border: '1px solid var(--border)',
      background: 'var(--surface-2)',
      maxHeight: 220,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <img
        src={src}
        alt="Kartenbild"
        style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain', display: 'block' }}
      />
    </div>
  );
}

// Drag & Drop einer Bilddatei direkt auf eine Karte
function useCardImageDrop(onImage) {
  const [draggingOver, setDraggingOver] = useState(false);
  const dragDepth = useRef(0);

  const onDragEnter = (e) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); e.stopPropagation();
    dragDepth.current++;
    setDraggingOver(true);
  };
  const onDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (--dragDepth.current <= 0) { dragDepth.current = 0; setDraggingOver(false); }
  };
  const onDragOver = (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); };
  const onDrop = async (e) => {
    e.preventDefault(); e.stopPropagation();
    dragDepth.current = 0; setDraggingOver(false);
    const file = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
    if (!file) return;
    try { onImage(await readImageFile(file)); } catch (err) { console.warn(err); }
  };

  return { draggingOver, onDragEnter, onDragLeave, onDragOver, onDrop };
}

/* =====================================================================
   Karten-Anzeige (Cross-Fade)
   ===================================================================== */
function CardShell({ front, back, flipped, onClick }) {
  return (
    <div className="card" onClick={onClick}>
      <div className={'card-face' + (flipped ? '' : ' visible')}>{front}</div>
      <div className={'card-face back' + (flipped ? ' visible' : '')}>{back}</div>
    </div>
  );
}
function CatBadge({ card }) {
  if (!card.catLabel && !card.cat) return null;
  return <span className={'cat ' + catClass(card.cat)}>{card.catLabel || CATS[card.cat]?.label || card.cat}</span>;
}

/* =====================================================================
   Browse-Modus
   ===================================================================== */
function applyOrder(cards, orderMode) {
  const ids = cards.map(c => c.id);
  switch (orderMode) {
    case 'shuffle':   return shuffleArr(ids);
    case 'due':       return [...cards].sort((a, b) => new Date(a.due) - new Date(b.due)).map(c => c.id);
    case 'reverse':   return [...ids].reverse();
    case 'term_asc':  return [...cards].sort((a, b) => a.term.localeCompare(b.term, 'de')).map(c => c.id);
    case 'term_desc': return [...cards].sort((a, b) => b.term.localeCompare(a.term, 'de')).map(c => c.id);
    default:          return ids;
  }
}

function BrowseView({ folder, order: orderMode, onEdit, onDelete, onImageDrop }) {
  const orderedIds = useMemo(() => applyOrder(folder.cards, orderMode),
    [folder.cards, orderMode]); // eslint-disable-line

  const [search, setSearch] = useState('');
  const cardRefs = useRef({});
  const speech = useSpeech();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orderedIds
      .map(id => folder.cards.find(c => c.id === id))
      .filter(Boolean)
      .filter(card => {
        if (!q) return true;
        return (
          card.term.toLowerCase().includes(q) ||
          (card.def || '').toLowerCase().includes(q) ||
          (card.catLabel || '').toLowerCase().includes(q)
        );
      });
  }, [orderedIds, folder.cards, search]);

  const handleEdit = (card) => {
    onEdit(card, () => {
      // Callback: nach dem Speichern zur Karte scrollen
      setTimeout(() => {
        cardRefs.current[card.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    });
  };

  return (
    <div style={{ width: '100%', maxWidth: 680, display: 'flex', flexDirection: 'column', gap: '1rem', alignSelf: 'flex-start', paddingBottom: '2rem' }}>
      {/* Suchfeld */}
      <div style={{ position: 'relative' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={`${folder.cards.length} Karten durchsuchen…`}
          style={{
            width: '100%', fontSize: 15, padding: '11px 40px 11px 16px',
            border: '1px solid var(--border-2)', borderRadius: 10,
            background: 'var(--surface)', color: 'var(--text)',
            fontFamily: 'inherit',
          }}
          onFocus={e => { e.target.style.outline = 'none'; e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
          onBlur={e => { e.target.style.borderColor = 'var(--border-2)'; e.target.style.boxShadow = 'none'; }}
        />
        {search && (
          <button onClick={() => setSearch('')} style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-3)', display: 'flex', alignItems: 'center',
          }}><X size={15} /></button>
        )}
      </div>

      {/* Karten-Liste */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-3)', padding: '3rem 0', fontSize: 14 }}>
          {search ? 'Keine Karten gefunden.' : 'Noch keine Karten vorhanden.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((card, i) => (
            <BrowseCard
              key={card.id}
              card={card}
              index={i}
              speech={speech}
              cardRef={el => { cardRefs.current[card.id] = el; }}
              onEdit={() => handleEdit(card)}
              onDelete={() => {
                if (confirm('Diese Karte löschen?')) onDelete(card);
              }}
              onImageDrop={onImageDrop}
            />
          ))}
        </div>
      )}

      {search && filtered.length > 0 && (
        <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-3)', paddingBottom: '1rem' }}>
          {filtered.length} von {folder.cards.length} Karten
        </div>
      )}
    </div>
  );
}

function BrowseCard({ card, index, speech, cardRef, onEdit, onDelete, onImageDrop }) {
  const [expanded, setExpanded] = useState(false);
  const imgDrop = useCardImageDrop((base64) => onImageDrop(card.id, base64));

  return (
    <div
      ref={cardRef}
      onDragEnter={imgDrop.onDragEnter}
      onDragLeave={imgDrop.onDragLeave}
      onDragOver={imgDrop.onDragOver}
      onDrop={imgDrop.onDrop}
      style={{
        background: 'var(--surface)',
        border: `1px solid ${imgDrop.draggingOver ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(76,62,150,.06)',
        transition: 'border-color .15s',
      }}
    >
      {/* Obere Leiste: Begriff + Aktionen */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <span style={{
          fontSize: 11, color: 'var(--text-3)', fontFamily: 'DM Mono, monospace',
          minWidth: 24, textAlign: 'right', flexShrink: 0,
        }}>{index + 1}</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          {(card.catLabel || card.cat) && (
            <span className={'cat ' + catClass(card.cat)} style={{ marginBottom: 4, display: 'inline-block' }}>
              {card.catLabel || CATS[card.cat]?.label || card.cat}
            </span>
          )}
          <div style={{
            fontFamily: 'DM Mono, monospace', fontSize: 15, fontWeight: 500,
            color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {card.term}
          </div>
          {!expanded && card.def && (
            <div style={{
              fontSize: 13, color: 'var(--text-3)', marginTop: 2,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {card.def}
            </div>
          )}
        </div>

        {/* Aktionen */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
          onClick={e => e.stopPropagation()}>
          <SpeakButton text={card.term} speech={speech} />
          <button className="ghost xs" onClick={onEdit} title="Bearbeiten">
            <Pencil size={13} />
          </button>
          <button className="ghost xs" onClick={onDelete} title="Löschen"
            style={{ color: 'var(--text-3)' }}>
            <Trash2 size={13} />
          </button>
          <button style={{
            display: 'flex', alignItems: 'center', color: 'var(--text-3)',
            padding: '4px 6px', borderRadius: 6, transition: 'color .1s',
          }}>
            <ChevronDown size={15} style={{
              transform: expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform .2s',
            }} />
          </button>
        </div>
      </div>

      {/* Aufgeklappte Rückseite */}
      {expanded && (
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '14px 16px 14px 52px',
          background: 'var(--surface-2)',
          animation: 'fadeUp .15s ease',
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Rückseite
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ fontSize: 14, lineHeight: 1.65, whiteSpace: 'pre-wrap', color: 'var(--text)', flex: 1 }}>
              {card.def || '—'}
            </div>
            <SpeakButton text={card.def} speech={speech} />
          </div>
          {card.image && <CardImage src={card.image} />}
          {!card.image && (
            <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 10 }}>
              {imgDrop.draggingOver ? '📎 Bild loslassen…' : 'Bild hierher ziehen'}
            </div>
          )}
          {card.image && (
            <button className="ghost xs" style={{ marginTop: 8, color: 'var(--text-3)' }}
              onClick={() => onImageDrop(card.id, null)}>
              <X size={12} />Bild entfernen
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* =====================================================================
   Lern-Modus (Spaced Repetition)
   ===================================================================== */
const RATINGS = [
  { q: 1, label: 'Nochmal', key: '1', tone: 'again' },
  { q: 2, label: 'Schwer', key: '2', tone: 'hard' },
  { q: 4, label: 'Gut', key: '3', tone: 'good' },
  { q: 5, label: 'Leicht', key: '4', tone: 'easy' },
];

function LearnView({ folder, order: orderMode, onReview }) {
  const buildQueue = (cards, mode) => {
    const due = cards.filter(isDue);
    switch (mode) {
      case 'shuffle':   return shuffleArr(due.map(c => c.id));
      case 'due':       return [...due].sort((a, b) => new Date(a.due) - new Date(b.due)).map(c => c.id);
      case 'reverse':   return [...due].reverse().map(c => c.id);
      case 'term_asc':  return [...due].sort((a, b) => a.term.localeCompare(b.term, 'de')).map(c => c.id);
      case 'term_desc': return [...due].sort((a, b) => b.term.localeCompare(a.term, 'de')).map(c => c.id);
      default:          return due.map(c => c.id);
    }
  };
  const [queue, setQueue]       = useState(() => buildQueue(folder.cards, orderMode));
  const [flipped, setFlipped]   = useState(false);
  const [stats, setStats]       = useState({ done: 0, again: 0 });
  // errorRound: null | 'prompt' | 'running'
  const [errorRound, setErrorRound] = useState(null);
  const [errorIds, setErrorIds]     = useState([]);   // ids der Fehlerkarten
  const [errorFlipped, setErrorFlipped] = useState(false);
  const totalRef = useRef(queue.length);
  const speech = useSpeech();

  useEffect(() => {
    const due = buildQueue(folder.cards, orderMode);
    setQueue(due); setFlipped(false); setStats({ done: 0, again: 0 });
    setErrorRound(null); setErrorIds([]);
    totalRef.current = due.length;
  }, [folder.id, orderMode]); // eslint-disable-line

  const card = folder.cards.find(c => c.id === queue[0]);

  const rate = useCallback((q) => {
    if (!card) return;
    onReview(folder.id, card.id, q);
    const isAgain = q < 3;
    setStats(s => ({ done: s.done + 1, again: s.again + (isAgain ? 1 : 0) }));
    if (isAgain) setErrorIds(prev => prev.includes(card.id) ? prev : [...prev, card.id]);
    setQueue(prev => {
      const [first, ...rest] = prev;
      return isAgain ? [...rest, first] : rest;
    });
    setFlipped(false);
  }, [card, folder.id, onReview]);

  // Fehler-Runde: aktuell laufend
  const errorCard = errorRound === 'running'
    ? folder.cards.find(c => c.id === errorIds[0])
    : null;

  const rateError = useCallback((correct) => {
    if (!errorCard) return;
    onReview(folder.id, errorCard.id, correct ? 4 : 1);
    setErrorIds(prev => {
      const [, ...rest] = prev;
      if (!correct) return [...rest, errorCard.id]; // nochmal ans Ende
      return rest;
    });
    setErrorFlipped(false);
  }, [errorCard, folder.id, onReview]);

  useEffect(() => {
    const h = (e) => {
      if (isTyping()) return;
      if (errorRound === 'running') {
        if (e.key === ' ') { e.preventDefault(); setErrorFlipped(true); }
        else if (errorFlipped && e.key === '1') rateError(false);
        else if (errorFlipped && e.key === '2') rateError(true);
        return;
      }
      if (e.key === ' ') { e.preventDefault(); setFlipped(f => !f); }
      else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
        rate(RATINGS[Number(e.key) - 1].q);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [flipped, rate, errorRound, errorFlipped, rateError]);

  // ---- Fehler-Runde läuft ----
  if (errorRound === 'running') {
    if (!errorCard) {
      return (
        <div className="summary">
          <div className="summary-icon"><Check size={40} /></div>
          <h2>Fehler-Runde abgeschlossen 🎉</h2>
          <p>Alle schwierigen Karten sitzen jetzt besser. Serie: {folder.streak} Tag(e) 🔥</p>
        </div>
      );
    }
    return (
      <div className="card-wrap">
        <div className="progress">
          <div className="progress-fill" style={{ background: 'linear-gradient(90deg,#f59e0b,#d97706)', width: '100%' }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--warm)', textAlign: 'center', marginBottom: 8, fontWeight: 500 }}>
          🔁 Fehler-Runde · {errorIds.length} Karte{errorIds.length !== 1 ? 'n' : ''} übrig
        </div>
        <CardShell flipped={errorFlipped} onClick={() => !errorFlipped && setErrorFlipped(true)}
          front={<><CatBadge card={errorCard} /><div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><div className="term" style={{ flex: 1 }}>{errorCard.term}</div><SpeakButton text={errorCard.term} speech={speech} /></div><CardImage src={errorCard.image} /></>}
          back={<><div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><div className="def" style={{ flex: 1 }}>{errorCard.def || '—'}</div><SpeakButton text={errorCard.def} speech={speech} /></div><CardImage src={errorCard.image} /></>} />
        {!errorFlipped ? (
          <p className="hint">Klicken zum Umdrehen · Leertaste</p>
        ) : (
          <div className="ratings fade-up two">
            <button className="rate again" onClick={() => rateError(false)}><span className="rate-key">1</span>Nochmal</button>
            <button className="rate good"  onClick={() => rateError(true)}><span className="rate-key">2</span>Sitzt jetzt</button>
          </div>
        )}
      </div>
    );
  }

  // ---- Haupt-Session fertig: Prompt für Fehler-Runde ----
  if (!card) {
    if (stats.again > 0 && errorRound === null) {
      return (
        <div className="summary">
          <div className="summary-icon" style={{ background: 'var(--warm-soft)', color: 'var(--warm)' }}>
            <RotateCcw size={36} />
          </div>
          <h2>Session abgeschlossen</h2>
          <p style={{ marginBottom: '1.25rem' }}>
            {stats.done} Bewertungen · <strong>{stats.again} Karte{stats.again !== 1 ? 'n' : ''}</strong> mit „Nochmal" markiert.
            <br />Möchtest du diese jetzt in einer kurzen Fehler-Runde festigen?
          </p>
          <div className="empty-actions">
            <button className="btn primary" onClick={() => { setErrorRound('running'); setErrorFlipped(false); }}>
              <RotateCcw size={15} />Fehler-Runde starten ({stats.again})
            </button>
            <button className="btn" onClick={() => setErrorRound('skip')}>Überspringen</button>
          </div>
        </div>
      );
    }
    return (
      <div className="summary">
        <div className="summary-icon"><Check size={40} /></div>
        <h2>{stats.done > 0 ? 'Session abgeschlossen' : 'Nichts fällig'}</h2>
        <p>{stats.done > 0
          ? `${stats.done} Bewertungen · alle Karten saßen. Serie: ${folder.streak} Tag(e) 🔥`
          : 'Für heute sind keine Karten fällig. Komm morgen wieder oder nutze den Durchstöbern-Modus.'}</p>
      </div>
    );
  }

  const remaining = queue.length;
  return (
    <div className="card-wrap">
      <div className="progress"><div className="progress-fill" style={{ width: (stats.done / (stats.done + remaining) * 100) + '%' }} /></div>
      <CardShell flipped={flipped} onClick={() => setFlipped(f => !f)}
        front={<><CatBadge card={card} /><div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><div className="term" style={{ flex: 1 }}>{card.term}</div><SpeakButton text={card.term} speech={speech} /></div><CardImage src={card.image} /></>}
        back={<><div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}><div className="def" style={{ flex: 1 }}>{card.def || '—'}</div><SpeakButton text={card.def} speech={speech} /></div><CardImage src={card.image} /></>} />
      {!flipped ? (
        <p className="hint">Klicken zum Umdrehen · Leertaste · {remaining} übrig</p>
      ) : (
        <div className="ratings fade-up">
          {RATINGS.map(r => (
            <button key={r.q} className={'rate ' + r.tone} onClick={() => rate(r.q)}>
              <span className="rate-key">{r.key}</span>{r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* =====================================================================
   Recall-Modus (Eingabe-Test mit KI-Bewertung)
   ===================================================================== */

// Score-Schwellen
const THRESH_CORRECT = 0.80;   // ≥ 80% → Richtig (SM-2 q=4)
const THRESH_PARTIAL = 0.55;   // 55–79% → Teilweise → zählt als Falsch (SM-2 q=1)
                                // < 55% → Falsch (SM-2 q=1)

function scoreLabel(score) {
  if (score >= THRESH_CORRECT) return { text: 'Richtig', color: '#1f9956' };
  if (score >= THRESH_PARTIAL) return { text: 'Teilweise richtig – gilt als falsch', color: '#b07b1d' };
  return { text: 'Falsch', color: '#cf5a52' };
}

function ScoreBar({ score }) {
  const pct = Math.round(score * 100);
  const { text, color } = scoreLabel(score);
  return (
    <div style={{ marginTop: '1.1rem' }} className="fade-up">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color }}>{text}</span>
        <span style={{ fontSize: 22, fontWeight: 500, fontFamily: 'DM Mono, monospace', color }}>{pct}%</span>
      </div>
      <div style={{ height: 8, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: pct + '%', borderRadius: 999,
          background: score >= THRESH_CORRECT
            ? 'linear-gradient(90deg,#22c55e,#16a34a)'
            : score >= THRESH_PARTIAL
              ? 'linear-gradient(90deg,#f59e0b,#d97706)'
              : 'linear-gradient(90deg,#f87171,#dc2626)',
          transition: 'width .5s cubic-bezier(.4,0,.2,1)',
        }} />
      </div>
      {/* Threshold markers */}
      <div style={{ position: 'relative', height: 14, marginTop: 2 }}>
        <div style={{ position: 'absolute', left: (THRESH_PARTIAL * 100) + '%', transform: 'translateX(-50%)',
          fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>55%</div>
        <div style={{ position: 'absolute', left: (THRESH_CORRECT * 100) + '%', transform: 'translateX(-50%)',
          fontSize: 10, color: 'var(--text-3)', whiteSpace: 'nowrap' }}>80%</div>
      </div>
    </div>
  );
}

function RecallView({ folder, order: orderMode, onReview }) {
  const ids = useMemo(() => applyOrder(folder.cards, orderMode), [folder.id, orderMode]); // eslint-disable-line
  const [idx, setIdx]         = useState(0);
  const [answer, setAnswer]   = useState('');
  const [scoring, setScoring] = useState(null);  // null | {checking:true} | {checking:false,score}
  const [done, setDone]       = useState(0);
  const [hintLevel, setHintLevel] = useState(0);
  const [errorIds, setErrorIds]   = useState([]);
  // errorRound: null | 'running' | 'skip'
  const [errorRound, setErrorRound] = useState(null);
  const [erIdx, setErIdx]           = useState(0);
  const [erAnswer, setErAnswer]     = useState('');
  const [erScoring, setErScoring]   = useState(null);
  const [erHint, setErHint]         = useState(0);
  const inputRef   = useRef(null);
  const erInputRef = useRef(null);
  const embedder   = useEmbedder();
  const speech     = useSpeech();

  useEffect(() => {
    setIdx(0); setAnswer(''); setScoring(null); setDone(0); setHintLevel(0);
    setErrorIds([]); setErrorRound(null); setErIdx(0); setErAnswer(''); setErScoring(null); setErHint(0);
  }, [folder.id]); // eslint-disable-line

  useEffect(() => { if (!scoring && errorRound !== 'running') inputRef.current?.focus(); }, [idx, scoring, errorRound]);
  useEffect(() => { if (errorRound === 'running' && !erScoring) erInputRef.current?.focus(); }, [erIdx, erScoring, errorRound]);

  const card    = folder.cards.find(c => c.id === ids[idx]);
  const erCard  = errorRound === 'running' ? (folder.cards.find(c => c.id === errorIds[erIdx]) || null) : null;

  const getHint = (c, level) => {
    if (!c || level === 0) return null;
    return (c.def || c.term).slice(0, level) + '…';
  };

  const computeScore = useCallback(async (userAnswer, targetCard) => {
    try {
      return await embedder.similarity(userAnswer.trim(), targetCard.def || targetCard.term);
    } catch {
      const a = userAnswer.trim().toLowerCase();
      const d = (targetCard.def || '').toLowerCase();
      return d.includes(a) ? 0.85 : a.split(' ').some(w => w.length > 3 && d.includes(w)) ? 0.60 : 0.20;
    }
  }, [embedder]);

  // ---- Haupt-Runde ----
  const check = useCallback(async () => {
    if (!answer.trim() || scoring) return;
    setScoring({ checking: true });
    const score = await computeScore(answer, card);
    setScoring({ checking: false, score });
  }, [answer, card, scoring, computeScore]);

  const advance = useCallback(() => {
    if (!scoring || scoring.checking) return;
    const correct = scoring.score >= THRESH_CORRECT;
    onReview(folder.id, card.id, correct ? 4 : 1);
    if (!correct) setErrorIds(prev => prev.includes(card.id) ? prev : [...prev, card.id]);
    setDone(d => d + 1);
    setIdx(i => i + 1);
    setAnswer(''); setScoring(null); setHintLevel(0);
  }, [scoring, folder.id, card, onReview]);

  // ---- Fehler-Runde ----
  const erCheck = useCallback(async () => {
    if (!erAnswer.trim() || erScoring || !erCard) return;
    setErScoring({ checking: true });
    const score = await computeScore(erAnswer, erCard);
    setErScoring({ checking: false, score });
  }, [erAnswer, erCard, erScoring, computeScore]);

  const erAdvance = useCallback(() => {
    if (!erScoring || erScoring.checking || !erCard) return;
    const correct = erScoring.score >= THRESH_CORRECT;
    onReview(folder.id, erCard.id, correct ? 4 : 1);
    setErrorIds(prev => {
      const without = prev.filter((_, i) => i !== erIdx);
      return correct ? without : [...without, erCard.id];
    });
    if (!correct) {
      // bleibt bei gleicher Position; Liste rotiert nach vorne
    } else {
      // erIdx bleibt, aber Liste ist kürzer → nächste Karte rückt nach
    }
    setErAnswer(''); setErScoring(null); setErHint(0);
  }, [erScoring, folder.id, erCard, erIdx, onReview]);

  useEffect(() => {
    const h = (e) => {
      if (errorRound === 'running') {
        if (isTyping() && e.key === 'Enter' && !erScoring) { e.preventDefault(); erCheck(); return; }
        if (!isTyping() && e.key === 'Enter' && erScoring && !erScoring.checking) { erAdvance(); return; }
        return;
      }
      if (isTyping() && e.key === 'Enter' && !scoring) { e.preventDefault(); check(); return; }
      if (!isTyping() && e.key === 'Enter' && scoring && !scoring.checking) { advance(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [check, advance, scoring, errorRound, erCheck, erAdvance, erScoring]);

  // ---- Fehler-Runde läuft ----
  if (errorRound === 'running') {
    if (!erCard || errorIds.length === 0) {
      return (
        <div className="summary">
          <div className="summary-icon"><Check size={40} /></div>
          <h2>Fehler-Runde abgeschlossen 🎉</h2>
          <p>Alle schwierigen Karten sitzen jetzt besser. Serie: {folder.streak} Tag(e) 🔥</p>
        </div>
      );
    }
    const erIsChecking = erScoring?.checking;
    const erHasScore   = erScoring && !erScoring.checking;
    const erHintText   = getHint(erCard, erHint);
    const erRemaining  = errorIds.length;
    return (
      <div className="card-wrap">
        <div className="progress">
          <div className="progress-fill" style={{ background: 'linear-gradient(90deg,#f59e0b,#d97706)', width: (erIdx / Math.max(erRemaining, 1) * 100) + '%' }} />
        </div>
        <div style={{ fontSize: 12, color: 'var(--warm)', textAlign: 'center', marginBottom: 8, fontWeight: 500 }}>
          🔁 Fehler-Runde · {erRemaining} Karte{erRemaining !== 1 ? 'n' : ''} übrig
        </div>
        {embedder.status === 'loading' && !erScoring && (
          <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', marginBottom: 8 }}>KI-Modell wird geladen…</div>
        )}
        <div className="card recall">
          <CatBadge card={erCard} />
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div className="term" style={{ flex: 1 }}>{erCard.term}</div>
            <SpeakButton text={erCard.term} speech={speech} />
          </div>
          <CardImage src={erCard.image} />
          {erHintText && (
            <div style={{ fontSize: 12, color: 'var(--accent-text)', marginTop: 8, fontFamily: 'DM Mono, monospace' }}>
              Tipp: {erHintText}
            </div>
          )}
          <input ref={erInputRef} className="recall-input" placeholder="Deine Antwort…" value={erAnswer}
            disabled={!!erScoring} onChange={(e) => setErAnswer(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !erScoring) { e.preventDefault(); erCheck(); } }} />
          {erHasScore && <ScoreBar score={erScoring.score} />}
          {erHasScore && (
            <div className="reveal fade-up">
              <div className="reveal-label">Musterlösung</div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div className="def" style={{ flex: 1 }}>{erCard.def || '—'}</div>
                <SpeakButton text={erCard.def} speech={speech} />
              </div>
            </div>
          )}
        </div>
        {!erScoring ? (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => setErHint(h => Math.min(h + 1, (erCard.def || erCard.term).length))}
              disabled={erHint >= (erCard.def || erCard.term).length}>
              💡 Tipp{erHint > 0 ? ` (${erHint} Zeichen)` : ''}
            </button>
            <button className="btn primary" onClick={erCheck} disabled={!erAnswer.trim()}>Prüfen (Enter)</button>
          </div>
        ) : erIsChecking ? (
          <div className="nav center" style={{ color: 'var(--text-3)', fontSize: 13 }}>
            <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginRight: 7 }}>⏳</span>
            Bewerte Antwort…
          </div>
        ) : (
          <div className="nav center fade-up">
            <button className="btn primary" onClick={erAdvance}>Weiter (Enter)</button>
          </div>
        )}
        <p className="hint">{erIdx + 1} / {erRemaining}</p>
      </div>
    );
  }

  // ---- Haupt-Session fertig ----
  if (!card) {
    if (errorIds.length > 0 && errorRound === null) {
      return (
        <div className="summary">
          <div className="summary-icon" style={{ background: 'var(--warm-soft)', color: 'var(--warm)' }}>
            <RotateCcw size={36} />
          </div>
          <h2>Test abgeschlossen</h2>
          <p style={{ marginBottom: '1.25rem' }}>
            {done} Karten geprüft · <strong>{errorIds.length} Karte{errorIds.length !== 1 ? 'n' : ''}</strong> unter 80 % Ähnlichkeit.
            <br />Möchtest du diese jetzt nochmal üben?
          </p>
          <div className="empty-actions">
            <button className="btn primary" onClick={() => { setErrorRound('running'); setErIdx(0); }}>
              <RotateCcw size={15} />Fehler-Runde ({errorIds.length})
            </button>
            <button className="btn" onClick={() => setErrorRound('skip')}>Überspringen</button>
          </div>
        </div>
      );
    }
    return (
      <div className="summary">
        <div className="summary-icon"><Check size={40} /></div>
        <h2>Test abgeschlossen</h2>
        <p>{done} Karten durchgearbeitet{errorIds.length === 0 ? ' – alles richtig! 🎉' : ''}. Serie: {folder.streak} Tag(e) 🔥</p>
      </div>
    );
  }

  // ---- Haupt-Runde läuft ----
  const isChecking = scoring?.checking;
  const hasScore   = scoring && !scoring.checking;
  const hintText   = getHint(card, hintLevel);

  return (
    <div className="card-wrap">
      <div className="progress"><div className="progress-fill" style={{ width: (idx / ids.length * 100) + '%' }} /></div>
      {embedder.status === 'loading' && !scoring && (
        <div style={{ fontSize: 12, color: 'var(--text-3)', textAlign: 'center', marginBottom: 8 }}>
          KI-Modell wird geladen… (einmalig ~25 MB)
        </div>
      )}
      {embedder.status === 'error' && (
        <div style={{ fontSize: 12, color: '#cf5a52', textAlign: 'center', marginBottom: 8 }}>
          KI-Modell nicht verfügbar – einfaches Textmatching aktiv
        </div>
      )}
      <div className="card recall">
        <CatBadge card={card} />
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div className="term" style={{ flex: 1 }}>{card.term}</div>
          <SpeakButton text={card.term} speech={speech} />
        </div>
        <CardImage src={card.image} />
        {hintText && (
          <div style={{ fontSize: 12, color: 'var(--accent-text)', marginTop: 8, fontFamily: 'DM Mono, monospace' }}>
            Tipp: {hintText}
          </div>
        )}
        <input ref={inputRef} className="recall-input" placeholder="Deine Antwort…" value={answer}
          disabled={!!scoring} onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !scoring) { e.preventDefault(); check(); } }} />
        {hasScore && <ScoreBar score={scoring.score} />}
        {hasScore && (
          <div className="reveal fade-up">
            <div className="reveal-label">Musterlösung</div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div className="def" style={{ flex: 1 }}>{card.def || '—'}</div>
              <SpeakButton text={card.def} speech={speech} />
            </div>
          </div>
        )}
      </div>
      {!scoring ? (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: '1rem', flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setHintLevel(h => Math.min(h + 1, (card.def || card.term).length))}
            disabled={hintLevel >= (card.def || card.term).length}>
            💡 Tipp{hintLevel > 0 ? ` (${hintLevel} Zeichen)` : ''}
          </button>
          <button className="btn primary" onClick={check} disabled={!answer.trim()}>Prüfen (Enter)</button>
        </div>
      ) : isChecking ? (
        <div className="nav center" style={{ color: 'var(--text-3)', fontSize: 13 }}>
          <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginRight: 7 }}>⏳</span>
          Bewerte Antwort…
        </div>
      ) : (
        <div className="nav center fade-up">
          <button className="btn primary" onClick={advance}>Weiter (Enter)</button>
        </div>
      )}
      <p className="hint">{idx + 1} / {ids.length}</p>
    </div>
  );
}
/* =====================================================================
   Statistik-Panel
   ===================================================================== */
const STAGE_SHADES = { neu: '#c2c7da', lernend: '#f0b86e', vertraut: '#8b7ff0', beherrscht: '#54c08a' };
const STAGE_LABELS = { neu: 'Neu', lernend: 'Lernend', vertraut: 'Vertraut', beherrscht: 'Beherrscht' };

function StatsPanel({ folder, history, onClose }) {
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const counts = useMemo(() => {
    const c = { neu: 0, lernend: 0, vertraut: 0, beherrscht: 0 };
    folder.cards.forEach(card => { c[classify(card)]++; });
    return c;
  }, [folder]);
  const due = folder.cards.filter(isDue).length;
  const progressData = [{ name: 'p', ...counts }];

  const histData = useMemo(() => {
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * MS_DAY);
      const k = dayStr(d);
      out.push({ day: d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }), count: history[k] || 0 });
    }
    return out;
  }, [history]);

  const total = folder.cards.length || 1;
  return (
    <div className="panel-bg" onMouseDown={(e) => { if (e.target.classList.contains('panel-bg')) onClose(); }}>
      <aside className="panel">
        <div className="panel-head">
          <span>Statistiken</span>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="panel-body">
          <div className="stat-grid">
            <div className="stat-card big">
              <div className="stat-num">{due}</div>
              <div className="stat-lbl">heute fällig</div>
            </div>
            <div className="stat-card big streak">
              <div className="stat-num"><Flame size={22} className="flame" />{folder.streak || 0}</div>
              <div className="stat-lbl">Tage Serie</div>
            </div>
          </div>

          <div className="stat-section">
            <div className="stat-title">Fortschritt ({folder.cards.length} Karten)</div>
            <div style={{ height: 46 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart layout="vertical" data={progressData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <XAxis type="number" hide domain={[0, total]} />
                  <YAxis type="category" dataKey="name" hide />
                  <Tooltip cursor={{ fill: 'transparent' }} formatter={(v, n) => [v, STAGE_LABELS[n]]} />
                  {Object.keys(STAGE_SHADES).map((k, i, a) => (
                    <Bar key={k} dataKey={k} stackId="s" fill={STAGE_SHADES[k]}
                      radius={i === 0 ? [4, 0, 0, 4] : i === a.length - 1 ? [0, 4, 4, 0] : 0} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="legend">
              {Object.keys(STAGE_SHADES).map(k => (
                <span key={k} className="legend-item">
                  <span className="legend-dot" style={{ background: STAGE_SHADES[k] }} />
                  {STAGE_LABELS[k]} <b>{counts[k]}</b>
                </span>
              ))}
            </div>
          </div>

          <div className="stat-section">
            <div className="stat-title">Lernverlauf (14 Tage)</div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histData} margin={{ top: 8, right: 4, bottom: 0, left: -24 }}>
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text-3)' }} interval={1} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--text-3)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: 'var(--surface-2)' }} formatter={(v) => [v, 'Bewertungen']} labelFormatter={(l) => l} />
                  <Bar dataKey="count" fill="#8b7ff0" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* =====================================================================
   Dialoge: Ordner / Karte / Import / Einstellungen
   ===================================================================== */
function FolderDialog({ initial, onSave, onClose }) {
  const [name, setName] = useState(initial?.name || '');
  const ref = useRef(null);
  useEffect(() => { setTimeout(() => ref.current?.focus(), 30); }, []);
  const submit = () => { if (!name.trim()) return; onSave(name.trim()); };
  return (
    <Modal title={initial ? 'Ordner umbenennen' : 'Neuer Ordner'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn primary" onClick={submit}>{initial ? 'Speichern' : 'Erstellen'}</button></>}>
      <div className="field">
        <label>Name des Ordners</label>
        <input ref={ref} value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} placeholder="z. B. IT-Recht" />
      </div>
    </Modal>
  );
}

function CardDialog({ initial, onAdd, onSave, onClose }) {
  const isNew = !initial;
  const [form, setForm] = useState({
    term: initial?.term || '', def: initial?.def || '',
    catLabel: initial?.catLabel || '', cat: initial?.cat || '',
    image: initial?.image || null,
  });
  const termRef = useRef(null);
  const fileInputRef = useRef(null);
  const toast = useToast();
  useEffect(() => { setTimeout(() => termRef.current?.focus(), 30); }, []);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleImageFile = async (file) => {
    if (!file) return;
    try {
      const base64 = await readImageFile(file);
      setForm(f => ({ ...f, image: base64 }));
    } catch { toast('Nur Bilddateien (PNG, JPG, …) erlaubt'); }
  };

  const imgDrop = useCardImageDrop(async (base64) => setForm(f => ({ ...f, image: base64 })));

  const collect = () => ({ ...form, term: form.term.trim(), def: form.def.trim(), catLabel: form.catLabel.trim() });
  const saveNext = () => {
    const d = collect();
    if (!d.term) return toast('Bitte einen Begriff eingeben');
    onAdd(d);
    setForm(f => ({ ...f, term: '', def: '', image: null }));
    termRef.current?.focus();
    toast('Karte hinzugefügt – weiter geht’s');
  };
  const finish = () => {
    const d = collect();
    if (!d.term) return toast('Bitte einen Begriff eingeben');
    isNew ? onAdd(d) : onSave(d);
    onClose();
  };

  return (
    <Modal title={isNew ? 'Neue Karte' : 'Karte bearbeiten'} onClose={onClose} wide
      footer={isNew
        ? <><button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn" onClick={saveNext}><Plus size={14} />Speichern & weiter</button>
          <button className="btn primary" onClick={finish}>Fertig</button></>
        : <><button className="btn" onClick={onClose}>Abbrechen</button>
          <button className="btn primary" onClick={finish}>Speichern</button></>}>
      <div className="field"><label>Begriff (Vorderseite)</label>
        <input ref={termRef} value={form.term} onChange={set('term')} placeholder="Begriff"
          onKeyDown={(e) => { if (e.key === 'Enter') document.getElementById('cd-def')?.focus(); }} /></div>
      <div className="field"><label>Erklärung (Rückseite)</label>
        <textarea id="cd-def" value={form.def} onChange={set('def')} placeholder="Erklärung … (Zeilenumbrüche bleiben erhalten)" /></div>
      <div className="row">
        <div className="field"><label>Kategorie-Label (optional)</label>
          <input value={form.catLabel} onChange={set('catLabel')} placeholder="z. B. Normen" /></div>
        <div className="field"><label>Farbe (optional)</label>
          <select value={form.cat} onChange={set('cat')}>
            <option value="">— keine —</option>
            {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select></div>
      </div>

      {/* Bild-Upload */}
      <div className="field">
        <label>Bild (optional)</label>
        <div
          onDragEnter={imgDrop.onDragEnter}
          onDragLeave={imgDrop.onDragLeave}
          onDragOver={imgDrop.onDragOver}
          onDrop={imgDrop.onDrop}
          onClick={() => !form.image && fileInputRef.current?.click()}
          style={{
            border: `2px dashed ${imgDrop.draggingOver ? 'var(--accent)' : 'var(--border-2)'}`,
            borderRadius: 10,
            background: imgDrop.draggingOver ? 'var(--accent-soft)' : form.image ? 'var(--surface-2)' : 'transparent',
            padding: form.image ? 0 : '18px 12px',
            textAlign: 'center',
            cursor: form.image ? 'default' : 'pointer',
            transition: 'border-color .15s, background .15s',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {form.image ? (
            <>
              <img src={form.image} alt="Vorschau"
                style={{ maxWidth: '100%', maxHeight: 160, objectFit: 'contain', display: 'block', margin: '0 auto' }} />
              <button
                onClick={(e) => { e.stopPropagation(); setForm(f => ({ ...f, image: null })); }}
                style={{
                  position: 'absolute', top: 6, right: 6,
                  background: 'rgba(0,0,0,.55)', color: '#fff', border: 'none',
                  borderRadius: '50%', width: 24, height: 24, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
              ><X size={13} /></button>
            </>
          ) : (
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>
              Bild hierher ziehen oder klicken zum Auswählen
            </span>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files[0]) handleImageFile(e.target.files[0]); e.target.value = ''; }}
        />
      </div>
    </Modal>
  );
}

function ImportDialog({ item, folders, onConfirm, onSkip }) {
  const [mode, setMode] = useState('new');
  const [name, setName] = useState(item.name);
  const [target, setTarget] = useState(folders[0]?.id || '');
  return (
    <Modal title={`Import: ${item.cards.length} Karte(n)`} onClose={onSkip}
      footer={<><button className="btn" onClick={onSkip}>Überspringen</button>
        <button className="btn primary" onClick={() => onConfirm(mode === 'new' ? { mode: 'new', name: name.trim() || item.name } : { mode: 'existing', id: target })}>Importieren</button></>}>
      <div className="field">
        <label>Wohin importieren?</label>
        <div className="seg">
          <label className={mode === 'new' ? 'sel' : ''}>
            <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} /> Neuer Ordner
          </label>
          {folders.length > 0 && (
            <label className={mode === 'existing' ? 'sel' : ''}>
              <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} /> Bestehender Ordner
            </label>
          )}
        </div>
      </div>
      {mode === 'new' ? (
        <div className="field"><label>Name des neuen Ordners</label>
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></div>
      ) : (
        <div className="field"><label>Ordner auswählen</label>
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            {folders.map(f => <option key={f.id} value={f.id}>{f.name} ({f.cards.length})</option>)}
          </select></div>
      )}
    </Modal>
  );
}

function SettingsDialog({ folder, onSave, onClose }) {
  const [goal, setGoal] = useState(folder.dailyGoal || 20);
  return (
    <Modal title="Ordner-Einstellungen" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Abbrechen</button>
        <button className="btn primary" onClick={() => { onSave(Math.max(1, Number(goal) || 20)); onClose(); }}>Speichern</button></>}>
      <div className="field"><label>Tages-Ziel (Karten pro Tag)</label>
        <input type="number" min="1" value={goal} onChange={(e) => setGoal(e.target.value)} /></div>
    </Modal>
  );
}

/* =====================================================================
   Root
   ===================================================================== */
export default function App() {
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);
  const toast = useCallback((msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2200);
  }, []);

  // Auth
  const [user, setUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data?.session?.user || null);
      setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => listener?.subscription?.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const store = useLearningStore(toast, user?.id);
  const { folders, activeFolder } = store;

  const [mode, setMode] = useState('learn');
  const [order, setOrder] = useState('normal');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showTTSSettings, setShowTTSSettings] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dialog, setDialog] = useState(null);            // { type, ... }
  const [importQueue, setImportQueue] = useState([]);
  const fileInputRef = useRef(null);

  /* globales 'f' für Vollbild */
  useEffect(() => {
    const h = (e) => {
      if (isTyping() || dialog || showStats) return;
      if (e.key.toLowerCase() === 'f') setFullscreen(fs => !fs);
      if (e.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [dialog, showStats]);
  useEffect(() => {
    const h = (e) => {
      if (isTyping() || dialog || showStats) return;
      if (e.key.toLowerCase() === 's' && mode === 'browse') setOrder(o => o === 'shuffle' ? 'normal' : 'shuffle');
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [mode, dialog, showStats]);

  /* ---- Datei-Import (Drag&Drop + Dialog) ---- */
  const handleFiles = useCallback((fileList) => {
    const files = [...fileList].filter(f => /\.(html?|csv)$/i.test(f.name));
    if (!files.length) return toast('Nur HTML- oder CSV-Dateien');
    let pending = files.length; const parsed = [];
    files.forEach(file => {
      const r = new FileReader();
      r.onload = (e) => {
        const cards = parseFile(file.name, e.target.result);
        parsed.push({ name: file.name.replace(/\.(html?|csv)$/i, '').replace(/[_-]+/g, ' ').trim() || 'Import', cards });
        if (--pending === 0) {
          const valid = parsed.filter(p => p.cards.length);
          if (!valid.length) return toast('Keine Karten erkannt');
          setImportQueue(valid);
        }
      };
      r.readAsText(file);
    });
  }, [toast]);

  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    const over = (e) => e.preventDefault();
    const enter = (e) => { e.preventDefault(); dragDepth.current++; setDragging(true); };
    const leave = (e) => { e.preventDefault(); if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); } };
    const drop = (e) => { e.preventDefault(); dragDepth.current = 0; setDragging(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); };
    window.addEventListener('dragover', over);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [handleFiles]);

  const advanceImport = () => setImportQueue(q => q.slice(1));

  /* ---- Render Stage ---- */
  const renderStage = () => {
    const f = activeFolder;
    if (!f || f.cards.length === 0) {
      return (
        <div className="empty">
          <div className="empty-icon">🗂️</div>
          <h2>Noch keine Karten</h2>
          <p>Ziehe eine HTML- oder CSV-Datei ins Fenster oder lege manuell eine Karte an.</p>
          <div className="empty-actions">
            <button className="btn primary" onClick={() => setDialog({ type: 'card' })}><Plus size={15} />Neue Karte</button>
            <button className="btn" onClick={() => fileInputRef.current?.click()}><Upload size={15} />Importieren</button>
          </div>
        </div>
      );
    }
    if (mode === 'browse') return <BrowseView folder={f} order={order}
      onEdit={(card, onScrollBack) => setDialog({ type: 'card', card, onScrollBack })}
      onDelete={(card) => { if (confirm('Diese Karte löschen?')) { store.deleteCard(f.id, card.id); toast('Karte gelöscht'); } }}
      onImageDrop={(cardId, image) => store.updateCardImage(f.id, cardId, image)} />;
    if (mode === 'learn') return <LearnView folder={f} order={order} onReview={store.reviewCard} />;
    return <RecallView folder={f} order={order} onReview={store.reviewCard} />;
  };

  return (
    <EmbedderProvider>
    <ToastCtx.Provider value={toast}>
      <StyleTag />
      {/* Auth-Check läuft noch */}
      {!authChecked && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: '100vh', background: '#f4f5fb', fontFamily: 'DM Sans, system-ui' }}>
          <div style={{ color: '#9698b0', fontSize: 14 }}>Laden…</div>
        </div>
      )}
      {/* Nicht eingeloggt → Auth-Screen */}
      {authChecked && !user && (
        <AuthScreen onAuth={setUser} />
      )}
      {/* Eingeloggt → App */}
      {authChecked && user && (
      <div className="app">
        <Sidebar store={store} open={sidebarOpen} onClose={() => setSidebarOpen(false)}
          onImportClick={() => fileInputRef.current?.click()}
          onNewFolder={() => setDialog({ type: 'folder' })} />

        <main className="main">
          <Topbar folder={activeFolder} mode={mode} setMode={setMode}
            order={order} setOrder={setOrder}
            onMenu={() => setSidebarOpen(true)} onStats={() => setShowStats(true)}
            onNewCard={() => setDialog({ type: 'card' })} toast={toast} />
          {activeFolder && (
            <div className="subbar">
              <button className="ghost xs" onClick={() => setDialog({ type: 'renameFolder' })}>
                <Pencil size={13} />Umbenennen
              </button>
              <button className="ghost xs" onClick={() => setDialog({ type: 'settings' })}>
                <Settings2 size={13} />Ziel: {activeFolder.dailyGoal}/Tag
              </button>
              <button className="ghost xs" onClick={() => setShowTTSSettings(true)}>
                <Volume2 size={13} />Stimme
              </button>
              {activeFolder.streak > 0 && <span className="streak-chip"><Flame size={12} />{activeFolder.streak} Tage</span>}
            </div>
          )}
          <div className={'stage' + (fullscreen ? ' stage-fullscreen' : '')}>
            {store.loading
              ? <div style={{ color: 'var(--text-3)', fontSize: 14 }}>Karten werden geladen…</div>
              : renderStage()
            }
            {activeFolder && !store.loading && (
              <button
                onClick={() => setFullscreen(fs => !fs)}
                title={fullscreen ? 'Vollbild beenden (F / Esc)' : 'Vollbild (F)'}
                style={{
                  position: 'absolute', bottom: 16, right: 16,
                  width: 32, height: 32, borderRadius: '50%',
                  border: '1px solid var(--border-2)',
                  background: 'var(--surface)',
                  color: 'var(--text-3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', opacity: 0.7, transition: 'opacity .15s',
                  boxShadow: '0 2px 8px rgba(0,0,0,.08)',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = 1}
                onMouseLeave={e => e.currentTarget.style.opacity = 0.7}
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>
            )}
          </div>
        </main>

        {dragging && (
          <div className="drop-overlay">
            <div className="drop-box">📄 Datei hier ablegen<br /><span>HTML oder CSV · du wählst danach das Ziel</span></div>
          </div>
        )}

        {showStats && activeFolder && (
          <StatsPanel folder={activeFolder} history={store.history} onClose={() => setShowStats(false)} />
        )}

        {showTTSSettings && (
          <TTSSettingsDialog onClose={() => setShowTTSSettings(false)} onSaved={() => {}} />
        )}

        {/* Dialoge */}
        {dialog?.type === 'folder' && (
          <FolderDialog onClose={() => setDialog(null)}
            onSave={(name) => { store.addFolder(name); setDialog(null); toast('Ordner erstellt'); }} />
        )}
        {dialog?.type === 'renameFolder' && (
          <FolderDialog initial={activeFolder} onClose={() => setDialog(null)}
            onSave={(name) => { store.renameFolder(activeFolder.id, name); setDialog(null); }} />
        )}
        {dialog?.type === 'card' && activeFolder && (
          <CardDialog initial={dialog.card} onClose={() => setDialog(null)}
            onAdd={(d) => store.addCard(activeFolder.id, d)}
            onSave={(d) => { store.updateCard(activeFolder.id, dialog.card.id, d); toast('Gespeichert'); dialog.onScrollBack?.(); }} />
        )}
        {dialog?.type === 'settings' && activeFolder && (
          <SettingsDialog folder={activeFolder} onClose={() => setDialog(null)}
            onSave={(goal) => { store.setDailyGoal(activeFolder.id, goal); toast('Ziel gespeichert'); }} />
        )}

        {/* Import-Queue */}
        {importQueue.length > 0 && (
          <ImportDialog item={importQueue[0]} folders={folders}
            onSkip={advanceImport}
            onConfirm={(target) => { store.importCards(target, importQueue[0].cards); toast(`${importQueue[0].cards.length} Karte(n) importiert`); advanceImport(); }} />
        )}

        <input ref={fileInputRef} type="file" accept=".html,.htm,.csv" multiple style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files.length) handleFiles(e.target.files); e.target.value = ''; }} />

        {/* Abmelden + User-Info */}
        <div style={{ position: 'fixed', bottom: 16, right: 13, zIndex: 99 }}>
          <button className="ghost xs" onClick={handleLogout}
            title={user?.email}
            style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,.08)' }}>
            ↩ Abmelden
          </button>
        </div>

        <div className={'toast' + (toastMsg ? ' show' : '')}>{toastMsg}</div>
      </div>
      )}
    </ToastCtx.Provider>
    </EmbedderProvider>
  );
}

/* =====================================================================
   Styles
   ===================================================================== */
function StyleTag() {
  return <style>{`
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap');

:root{
  --bg:#f4f5fb; --surface:#ffffff; --surface-2:#eef0f8; --border:#e6e7f1; --border-2:#d5d7e6;
  --text:#1d1d2b; --text-2:#585a70; --text-3:#9698b0;
  --accent:#6c5ce7; --accent-2:#8b7ff0; --accent-soft:#ece9fc; --accent-text:#5a4fcf;
  --grad:linear-gradient(135deg,#7c6ff0,#6c5ce7);
  --warm:#e8852b; --warm-soft:rgba(232,133,43,.12);
  --radius:14px;
}
@media (prefers-color-scheme: dark){
  :root{ --bg:#101018; --surface:#191923; --surface-2:#23232f; --border:#2a2a38; --border-2:#3a3a4c;
    --text:#ececf4; --text-2:#a9abc4; --text-3:#71738c;
    --accent:#8b7ff0; --accent-2:#a59bf5; --accent-soft:#262339; --accent-text:#b9b1f7;
    --grad:linear-gradient(135deg,#8b7ff0,#6c5ce7);
    --warm:#f0a050; --warm-soft:rgba(240,160,80,.14); }
}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg)}
.app{font-family:'DM Sans',system-ui,sans-serif;color:var(--text);
  background:
    radial-gradient(900px 500px at 100% -5%, rgba(124,111,240,.10), transparent 60%),
    radial-gradient(800px 500px at -5% 105%, rgba(108,92,231,.08), transparent 60%),
    var(--bg);
  display:flex;height:100vh;overflow:hidden;-webkit-font-smoothing:antialiased}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
.term,.counter,.stat-num,.recall-input,.rate-key{font-family:'DM Mono',monospace}

/* buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 14px;
  font-size:14px;border:1px solid var(--border-2);border-radius:8px;background:var(--surface);color:var(--text);
  transition:background .12s,border-color .12s}
.btn:hover{background:var(--surface-2)}
.btn.sm{padding:6px 11px;font-size:13px}
.btn.xs{padding:4px 9px;font-size:12px}
.btn.primary{background:var(--grad);color:#fff;border-color:transparent;box-shadow:0 3px 10px rgba(108,92,231,.28)}
.btn.primary:hover{filter:brightness(1.05);background:var(--grad)}
.ghost{display:inline-flex;align-items:center;gap:6px;color:var(--text-2);padding:7px 10px;border-radius:7px;font-size:13px}
.ghost:hover{background:var(--surface-2)}
.ghost.xs{font-size:12px;padding:4px 8px}
.icon-btn{display:inline-flex;align-items:center;justify-content:center;color:var(--text-2);padding:6px;border-radius:7px}
.icon-btn:hover{background:var(--surface-2)}

/* sidebar */
.sidebar{width:272px;flex-shrink:0;background:var(--surface);border-right:1px solid var(--border);display:flex;flex-direction:column}
.sidebar-head{padding:1.5rem 1.5rem 1rem}
.brand{font-size:16px;font-weight:600;display:flex;align-items:center;gap:10px;letter-spacing:-.01em}
.brand-dot{width:10px;height:10px;border-radius:50%;background:var(--grad);box-shadow:0 0 0 4px var(--accent-soft)}
.brand-sub{font-size:12px;color:var(--text-3);margin-top:3px}
.folder-list{flex:1;overflow-y:auto;padding:.5rem .75rem}
.folder{display:flex;align-items:center;gap:10px;padding:10px 11px;border-radius:8px;cursor:pointer;
  font-size:14px;color:var(--text-2);user-select:none}
.folder:hover{background:var(--surface-2)}
.folder.active{background:var(--accent-soft);color:var(--accent-text);font-weight:600}
.folder-name{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.folder .count{font-size:11px;color:var(--text-3)}
.due-badge{font-size:11px;font-weight:600;background:var(--grad);color:#fff;padding:1px 7px;border-radius:999px;box-shadow:0 1px 4px rgba(108,92,231,.3)}
.folder .del{opacity:0;color:var(--text-3);display:inline-flex;padding:2px;border-radius:5px}
.folder:hover .del{opacity:1}
.folder .del:hover{color:#c0392b}
.sidebar-foot{padding:.75rem;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:6px}
.conn{background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:12px;color:var(--text-2);margin-bottom:2px}
.conn.connected{background:rgba(22,163,74,.08);border-color:rgba(22,163,74,.25)}
.conn-row{display:flex;align-items:center;gap:8px}
.conn .dot{width:8px;height:8px;border-radius:50%;background:#16a34a;flex-shrink:0}
.conn .dot.off{background:var(--text-3)}
.conn .path{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.conn-sub{font-size:11px;color:var(--text-3);margin-top:4px}

/* main */
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.topbar{min-height:60px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:14px;
  padding:0 1.25rem;background:var(--surface)}
.topbar h1{background:var(--grad);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.topbar-left{display:flex;align-items:center;gap:11px;min-width:0;flex:1}
.topbar h1{font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em}
.topbar .sub{font-size:12px;color:var(--text-3);margin-top:1px}
.hamburger{display:none}
.mode-selector{display:flex;gap:2px;background:var(--surface-2);padding:3px;border-radius:9px}
.mode-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 13px;font-size:13px;border-radius:7px;color:var(--text-2)}
.mode-btn.active{background:var(--surface);color:var(--accent-text);font-weight:600;box-shadow:0 1px 4px rgba(108,92,231,.2)}
.topbar-actions{display:flex;gap:7px;align-items:center}
.subbar{display:flex;align-items:center;gap:10px;padding:7px 1.25rem;border-bottom:1px solid var(--border);background:var(--surface)}
.streak-chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:500;color:var(--warm);background:var(--warm-soft);padding:3px 10px;border-radius:999px}
.menu-wrap{position:relative}
.menu{position:absolute;right:0;top:calc(100% + 5px);background:var(--surface);border:1px solid var(--border);
  border-radius:9px;box-shadow:0 8px 24px rgba(0,0,0,.12);padding:5px;z-index:50;min-width:170px}
.menu button{display:block;width:100%;text-align:left;padding:8px 11px;font-size:13px;border-radius:6px;color:var(--text)}
.menu button:hover{background:var(--surface-2)}

.stage{flex:1;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:2rem;position:relative}
.stage-fullscreen{position:fixed;inset:0;z-index:120;background:var(--bg);padding:2rem;
  background:
    radial-gradient(900px 500px at 100% -5%, rgba(124,111,240,.10), transparent 60%),
    radial-gradient(800px 500px at -5% 105%, rgba(108,92,231,.08), transparent 60%),
    var(--bg);
}

/* card */
.card-wrap{width:100%;max-width:560px}
.progress{height:4px;background:var(--border);border-radius:999px;margin-bottom:1.75rem;overflow:hidden}
.progress-fill{height:100%;background:var(--grad);transition:width .3s}
.card{position:relative;width:100%;min-height:260px;background:var(--surface);border:1px solid var(--border);
  border-radius:var(--radius);box-shadow:0 10px 30px rgba(76,62,150,.08),0 1px 2px rgba(0,0,0,.04);cursor:pointer;padding:2.25rem;overflow:hidden}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--grad)}
.card.recall{cursor:default;display:flex;flex-direction:column}
.card-face{position:absolute;inset:0;padding:2.25rem;display:flex;flex-direction:column;justify-content:center;
  opacity:0;transition:opacity .2s ease;pointer-events:none}
.card-face.visible{opacity:1;pointer-events:auto}
.cat{font-size:11px;padding:3px 10px;border-radius:999px;align-self:flex-start;margin-bottom:1rem;font-weight:500}
.term{font-size:23px;font-weight:500;line-height:1.35;letter-spacing:-.01em}
.def{font-size:15px;line-height:1.7;white-space:pre-wrap;color:var(--text)}
.hint{font-size:12px;color:var(--text-3);text-align:center;margin-top:1rem}
.nav{display:flex;align-items:center;justify-content:space-between;margin-top:1.25rem}
.nav.center{justify-content:center}
.counter{font-size:13px;color:var(--text-2)}
.card-tools{display:flex;justify-content:center;gap:4px;margin-top:.9rem}
.dots{display:flex;gap:6px;justify-content:center;margin-top:1.25rem;flex-wrap:wrap}
.dot-nav{width:7px;height:7px;border-radius:50%;background:var(--border-2);cursor:pointer;transition:transform .15s,background .15s}
.dot-nav.active{background:var(--accent);transform:scale(1.3)}
.dot-nav.seen{background:var(--text-3)}

/* ratings */
.ratings{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:1.25rem}
.ratings.two{grid-template-columns:repeat(2,1fr);max-width:340px;margin-left:auto;margin-right:auto}
.rate{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:11px 8px;font-size:13px;font-weight:500;
  border:1px solid var(--border-2);border-radius:10px;background:var(--surface);color:var(--text);transition:transform .12s,background .12s,border-color .12s,box-shadow .12s}
.rate:hover{transform:translateY(-1px)}
.rate.again{background:rgba(214,69,69,.10);border-color:rgba(214,69,69,.28);color:#cf5a52}
.rate.hard{background:rgba(200,140,30,.12);border-color:rgba(200,140,30,.30);color:#b07b1d}
.rate.good{background:rgba(45,120,200,.11);border-color:rgba(45,120,200,.28);color:#3a7fc4}
.rate.easy{background:rgba(34,160,90,.11);border-color:rgba(34,160,90,.28);color:#1f9956}
.rate.again:hover{background:rgba(214,69,69,.18);box-shadow:0 4px 12px rgba(214,69,69,.18)}
.rate.hard:hover{background:rgba(200,140,30,.2);box-shadow:0 4px 12px rgba(200,140,30,.18)}
.rate.good:hover{background:rgba(45,120,200,.2);box-shadow:0 4px 12px rgba(45,120,200,.18)}
.rate.easy:hover{background:rgba(34,160,90,.2);box-shadow:0 4px 12px rgba(34,160,90,.18)}
.rate-key{font-size:11px;color:currentColor;opacity:.7;border:1px solid currentColor;border-radius:4px;padding:0 5px;line-height:16px}
.recall-input{margin-top:1.5rem;width:100%;font-size:16px;padding:12px 14px;border:1px solid var(--border-2);
  border-radius:10px;background:var(--bg);color:var(--text)}
.recall-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.reveal{margin-top:1.25rem;padding-top:1.25rem;border-top:1px solid var(--border)}
.reveal-label{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--text-3);margin-bottom:.5rem}

.fade-up{animation:fadeUp .15s ease}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}

/* summary / empty */
.summary,.empty{text-align:center;max-width:440px;color:var(--text-2);margin:auto}
.summary-icon{width:78px;height:78px;border-radius:50%;background:var(--accent-soft);display:flex;align-items:center;
  justify-content:center;margin:0 auto 1.25rem;color:var(--accent-text)}
.summary h2,.empty h2{font-size:19px;font-weight:600;color:var(--text);margin-bottom:.5rem}
.summary p,.empty p{font-size:14px;line-height:1.6}
.empty-icon{font-size:42px;margin-bottom:.75rem}
.empty-actions{display:flex;gap:8px;justify-content:center;margin-top:1.25rem;flex-wrap:wrap}

/* category palette */
.cat-grundlagen{background:#EEEDFE;color:#3C3489}
.cat-normen{background:#E1F5EE;color:#085041}
.cat-auslegung{background:#FAEEDA;color:#633806}
.cat-quellen{background:#E6F1FB;color:#0C447C}
.cat-urheberrecht{background:#FAECE7;color:#712B13}
.cat-default{background:var(--surface-2);color:var(--text-2)}

/* drop overlay */
.drop-overlay{position:fixed;inset:0;background:rgba(108,92,231,.10);backdrop-filter:blur(2px);display:flex;
  align-items:center;justify-content:center;z-index:100;pointer-events:none}
.drop-box{border:2px dashed var(--accent);background:var(--surface);border-radius:var(--radius);color:var(--accent-text);
  padding:2.5rem 3.5rem;text-align:center;font-size:16px;font-weight:500;box-shadow:0 12px 40px rgba(108,92,231,.18)}
.drop-box span{font-size:13px;font-weight:400;color:var(--text-3)}

/* modal */
.modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:200;padding:1rem}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);width:100%;max-width:480px;
  max-height:90vh;display:flex;flex-direction:column;box-shadow:0 12px 40px rgba(0,0,0,.25)}
.modal-head{padding:1.15rem 1.4rem;border-bottom:1px solid var(--border);font-size:15px;font-weight:600;
  display:flex;align-items:center;justify-content:space-between}
.modal-body{padding:1.25rem 1.4rem;overflow-y:auto;display:flex;flex-direction:column;gap:1rem}
.modal-foot{padding:1rem 1.4rem;border-top:1px solid var(--border);display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.field label{display:block;font-size:12px;font-weight:500;color:var(--text-2);margin-bottom:6px}
.field input,.field textarea,.field select{width:100%;font-family:inherit;font-size:14px;color:var(--text);
  border:1px solid var(--border-2);border-radius:8px;padding:9px 11px;background:var(--bg)}
.field input:focus,.field textarea:focus,.field select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
.field textarea{resize:vertical;min-height:92px;line-height:1.5}
.row{display:flex;gap:12px;flex-wrap:wrap}
.row .field{flex:1;min-width:140px}
.seg{display:flex;gap:8px}
.seg label{flex:1;border:1px solid var(--border-2);border-radius:8px;padding:10px 12px;font-size:13px;cursor:pointer;
  display:flex;align-items:center;gap:8px}
.seg label.sel{border-color:var(--accent);background:var(--accent-soft);color:var(--accent-text);font-weight:500}

/* stats panel */
.panel-bg{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;justify-content:flex-end;z-index:200}
.panel{width:420px;max-width:100%;background:var(--surface);border-left:1px solid var(--border);display:flex;flex-direction:column;animation:slideIn .2s ease}
@keyframes slideIn{from{transform:translateX(30px);opacity:.6}to{transform:translateX(0);opacity:1}}
.panel-head{padding:1.15rem 1.4rem;border-bottom:1px solid var(--border);font-weight:600;display:flex;justify-content:space-between;align-items:center}
.panel-body{padding:1.4rem;overflow-y:auto;display:flex;flex-direction:column;gap:1.75rem}
.stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.stat-card{border:1px solid var(--border);border-radius:var(--radius);padding:1.1rem;text-align:center}
.stat-card.big{background:var(--accent-soft);border-color:transparent}
.stat-card.big .stat-num,.stat-card.big .stat-lbl{color:var(--accent-text)}
.stat-card.streak{background:var(--warm-soft);border-color:transparent}
.stat-card.streak .stat-num,.stat-card.streak .stat-lbl{color:var(--warm)}
.stat-num{font-size:30px;font-weight:500;display:flex;align-items:center;justify-content:center;gap:8px}
.stat-lbl{font-size:12px;color:var(--text-3);margin-top:3px}
.flame{color:var(--warm)}
.stat-section{display:flex;flex-direction:column;gap:.6rem}
.stat-title{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--text-3)}
.legend{display:flex;flex-wrap:wrap;gap:10px 14px;font-size:12px;color:var(--text-2)}
.legend-item{display:inline-flex;align-items:center;gap:6px}
.legend-dot{width:9px;height:9px;border-radius:2px}
.legend-item b{color:var(--text);font-weight:600}

/* toast */
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(16px);background:var(--text);
  color:var(--bg);padding:10px 18px;border-radius:999px;font-size:13px;opacity:0;pointer-events:none;
  transition:opacity .2s,transform .2s;z-index:300}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}

.backdrop{display:none}
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-thumb{background:var(--border-2);border-radius:99px;border:2px solid var(--surface)}

/* responsive */
@media(max-width:768px){
  .hamburger{display:inline-flex}
  .sidebar{position:fixed;top:0;left:0;bottom:0;z-index:150;transform:translateX(-100%);transition:transform .25s ease;box-shadow:0 0 40px rgba(0,0,0,.2)}
  .sidebar.open{transform:translateX(0)}
  .backdrop{display:block;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:140;opacity:0;pointer-events:none;transition:opacity .2s}
  .backdrop.show{opacity:1;pointer-events:auto}
  .topbar{flex-wrap:wrap;padding:.6rem 1rem;gap:8px}
  .topbar-left{flex:1 1 100%}
  .mode-selector{flex:1}
  .mode-btn{flex:1;justify-content:center}
  .hide-mobile{display:none}
  .stage{padding:1.25rem .9rem}
  .card,.card-face{padding:1.6rem}
  .ratings{grid-template-columns:repeat(2,1fr)}
  .panel{width:100%}
}
`}</style>;
}
