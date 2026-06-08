import React, { useState } from 'react';
import { supabase } from './supabase';

export default function AuthScreen({ onAuth }) {
  const [mode, setMode]       = useState('login'); // 'login' | 'register'
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [info, setInfo]       = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setInfo(null); setLoading(true);
    try {
      if (mode === 'register') {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setInfo('Bestätigungs-E-Mail gesendet – bitte prüfe dein Postfach.');
      } else {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onAuth(data.user);
      }
    } catch (err) {
      setError(err.message || 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@400;500;600&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f4f5fb; }
        .auth-wrap {
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
          font-family: 'DM Sans', system-ui, sans-serif;
          background:
            radial-gradient(900px 500px at 100% 0%, rgba(124,111,240,.12), transparent 60%),
            radial-gradient(800px 500px at 0% 100%, rgba(108,92,231,.09), transparent 60%),
            #f4f5fb;
          padding: 1rem;
        }
        @media (prefers-color-scheme: dark) {
          body { background: #101018; }
          .auth-wrap { background:
            radial-gradient(900px 500px at 100% 0%, rgba(139,127,240,.10), transparent 60%),
            radial-gradient(800px 500px at 0% 100%, rgba(108,92,231,.08), transparent 60%),
            #101018; }
          .auth-card { background: #191923; border-color: #2a2a38; }
          .auth-card h1 { color: #ececf4; }
          .auth-card p  { color: #a9abc4; }
          .auth-input   { background: #101018; border-color: #3a3a4c; color: #ececf4; }
          .auth-input:focus { border-color: #8b7ff0; box-shadow: 0 0 0 3px rgba(139,127,240,.2); }
          .auth-label   { color: #a9abc4; }
          .auth-switch  { color: #a9abc4; }
          .auth-switch button { color: #b9b1f7; }
          .auth-error   { background: rgba(214,69,69,.12); border-color: rgba(214,69,69,.3); color: #f87171; }
          .auth-info    { background: rgba(34,160,90,.10); border-color: rgba(34,160,90,.25); color: #4ade80; }
        }
        .auth-card {
          background: #fff; border: 1px solid #e6e7f1; border-radius: 16px;
          padding: 2.5rem 2rem; width: 100%; max-width: 400px;
          box-shadow: 0 12px 40px rgba(108,92,231,.10), 0 2px 8px rgba(0,0,0,.04);
        }
        .auth-brand {
          display: flex; align-items: center; gap: 10px; margin-bottom: 1.75rem;
        }
        .auth-brand-dot {
          width: 10px; height: 10px; border-radius: 50%;
          background: linear-gradient(135deg,#7c6ff0,#6c5ce7);
          box-shadow: 0 0 0 4px rgba(108,92,231,.15);
          flex-shrink: 0;
        }
        .auth-card h1 { font-size: 16px; font-weight: 600; color: #1d1d2b; letter-spacing: -.01em; }
        .auth-card > p { font-size: 22px; font-weight: 600; color: #1d1d2b; margin-bottom: .4rem; letter-spacing: -.02em; }
        .auth-sub { font-size: 14px; color: #585a70; margin-bottom: 1.75rem; }
        .auth-label { display: block; font-size: 12px; font-weight: 500; color: #585a70; margin-bottom: 6px; }
        .auth-field { margin-bottom: 1rem; }
        .auth-input {
          width: 100%; font-family: inherit; font-size: 14px; color: #1d1d2b;
          border: 1px solid #d5d7e6; border-radius: 8px; padding: 10px 12px;
          background: #f4f5fb; transition: border-color .15s, box-shadow .15s;
          outline: none;
        }
        .auth-input:focus { border-color: #6c5ce7; box-shadow: 0 0 0 3px rgba(108,92,231,.15); }
        .auth-btn {
          width: 100%; padding: 11px; font-family: inherit; font-size: 14px; font-weight: 600;
          border: none; border-radius: 9px; cursor: pointer; margin-top: .5rem;
          background: linear-gradient(135deg,#7c6ff0,#6c5ce7);
          color: #fff; box-shadow: 0 3px 12px rgba(108,92,231,.32);
          transition: filter .15s, transform .1s;
        }
        .auth-btn:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
        .auth-btn:disabled { opacity: .6; cursor: default; transform: none; }
        .auth-switch { margin-top: 1.25rem; text-align: center; font-size: 13px; color: #585a70; }
        .auth-switch button {
          background: none; border: none; cursor: pointer; font-family: inherit;
          font-size: 13px; font-weight: 600; color: #5a4fcf; padding: 0;
        }
        .auth-switch button:hover { text-decoration: underline; }
        .auth-error, .auth-info {
          padding: 10px 12px; border-radius: 8px; font-size: 13px;
          margin-bottom: 1rem; line-height: 1.5;
        }
        .auth-error { background: rgba(214,69,69,.08); border: 1px solid rgba(214,69,69,.25); color: #c0392b; }
        .auth-info  { background: rgba(34,160,90,.08); border: 1px solid rgba(34,160,90,.2);  color: #0d7a45; }
      `}</style>
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="auth-brand-dot" />
            <h1>Vokabelkarten</h1>
          </div>
          <p>{mode === 'login' ? 'Willkommen zurück' : 'Konto erstellen'}</p>
          <div className="auth-sub">
            {mode === 'login' ? 'Melde dich an um weiterzulernen.' : 'Starte deine Lernreise.'}
          </div>

          {error && <div className="auth-error">{error}</div>}
          {info  && <div className="auth-info">{info}</div>}

          <form onSubmit={submit}>
            <div className="auth-field">
              <label className="auth-label">E-Mail</label>
              <input className="auth-input" type="email" value={email} required autoFocus
                onChange={e => setEmail(e.target.value)} placeholder="du@beispiel.de" />
            </div>
            <div className="auth-field">
              <label className="auth-label">Passwort</label>
              <input className="auth-input" type="password" value={password} required
                onChange={e => setPassword(e.target.value)}
                placeholder={mode === 'register' ? 'Mindestens 6 Zeichen' : '••••••••'} />
            </div>
            <button className="auth-btn" type="submit" disabled={loading}>
              {loading ? 'Bitte warten…' : mode === 'login' ? 'Anmelden' : 'Registrieren'}
            </button>
          </form>

          <div className="auth-switch">
            {mode === 'login'
              ? <>Noch kein Konto? <button onClick={() => { setMode('register'); setError(null); setInfo(null); }}>Registrieren</button></>
              : <>Bereits registriert? <button onClick={() => { setMode('login'); setError(null); setInfo(null); }}>Anmelden</button></>
            }
          </div>
        </div>
      </div>
    </>
  );
}
