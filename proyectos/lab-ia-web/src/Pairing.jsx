import { useRef, useState } from 'react';
import { pairDevice } from './auth';
import './Pairing.css';

export default function Pairing({ onPaired, initialError = '' }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const submitting = useRef(false);

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || !code.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await pairDevice(code);
      setCode('');
      await onPaired();
    } catch (cause) {
      setError(cause.message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="pairing-screen">
      <section className="pairing-card" aria-labelledby="pairing-title">
        <p className="pairing-brand">LAB-IA</p>
        <h1 id="pairing-title">Emparejar dispositivo</h1>
        <p>Para acceder a LAB-IA genera un código temporal desde la terminal del backend.</p>
        <ol>
          <li>Ejecuta el servidor.</li>
          <li>En esa misma terminal escribe: <code>pair</code></li>
          <li>Copia el código generado.</li>
          <li>Pégalo aquí.</li>
        </ol>
        <form onSubmit={submit} autoComplete="off">
          <label htmlFor="pairing-code">Código de emparejamiento</label>
          <input id="pairing-code" type="password" value={code}
            onChange={event => setCode(event.target.value)}
            autoComplete="off" autoCapitalize="none" spellCheck={false}
            disabled={busy} required />
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button type="submit" disabled={busy || !code.trim()}>
            {busy ? 'Emparejando…' : 'Emparejar'}
          </button>
        </form>
      </section>
    </main>
  );
}
