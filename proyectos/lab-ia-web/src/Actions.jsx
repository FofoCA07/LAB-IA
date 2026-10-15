import { useEffect, useRef, useState } from 'react';
import './Actions.css';

const TYPES = {
  read: 'Lectura', write: 'Escritura', command: 'Comando', test: 'Prueba',
  docker: 'Docker', sql: 'SQL', git: 'Git',
};

const STATUSES = {
  pending: 'Pendiente', running: 'Ejecutando', completed: 'Completada', denied: 'Rechazada',
  expired: 'Expirada', failed: 'Fallida',
};

const TABS = [
  { id: 'pending', label: 'Pendientes', empty: 'No hay acciones pendientes.' },
  { id: 'running', label: 'Ejecutando', empty: 'No hay acciones en ejecución.' },
  { id: 'completed', label: 'Finalizadas', empty: 'No hay acciones finalizadas.' },
];

function belongsToTab(action, tab) {
  return tab === 'completed'
    ? ['completed', 'denied', 'expired', 'failed'].includes(action.status)
    : action.status === tab;
}

function ActionCard({ action, onDecision, busy, processing }) {
  return (
    <article className={`action-card action-card--${action.status}`} aria-busy={processing}>
      <div className="action-card-top">
        <span className="action-agent">{action.agent}</span>
        <span className="action-status">{STATUSES[action.status]}</span>
      </div>
      <h2>{action.title}</h2>
      <div className="action-tags">
        <span className="action-type" title={`Tipo: ${action.type}`}>{Object.hasOwn(TYPES, action.type) ? TYPES[action.type] : action.type}</span>
        {action.project && <span>Proyecto: {action.project}</span>}
      </div>
      <div className="action-reason">
        <span className="action-field-label">Motivo</span>
        <p>{action.reason}</p>
      </div>
      {action.resources?.length > 0 && (
        <div className="action-resources">
          <span className="action-field-label">Recursos afectados</span>
          <ul>{action.resources.map((resource, index) => <li key={index}>{resource}</li>)}</ul>
        </div>
      )}
      {action.dateTime && (
        <time className="action-time" dateTime={action.dateTime}>
          {new Date(action.dateTime).toLocaleString('es')}
        </time>
      )}
      {action.status === 'pending' && action.type === 'read' && (
        <div className="action-card-buttons">
          <button type="button" className="action-button action-button--primary"
            disabled={busy} onClick={() => onDecision(action, 'approve_once')}>
            {processing ? 'Procesando…' : 'Permitir una vez'}
          </button>
          <button type="button" className="action-button action-button--deny"
            disabled={busy} onClick={() => onDecision(action, 'deny')}>Rechazar</button>
        </div>
      )}
    </article>
  );
}

// Copy only the fields used by the view; never retain extra response fields.
function parseActions(data) {
  if (!data || !Array.isArray(data.actions)) throw new Error('Invalid actions');
  const ids = new Set();
  return data.actions.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.actionId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.actionId)
      || ids.has(item.actionId)
      || typeof item.state !== 'string' || !Object.hasOwn(STATUSES, item.state)
      || !['agentName', 'type', 'projectName', 'reason', 'createdAt'].every(
        (key) => typeof item[key] === 'string' && item[key].trim().length > 0)
      || !Number.isFinite(Date.parse(item.createdAt))
      || !Array.isArray(item.resources)
      || !item.resources.every((resource) => typeof resource === 'string' && resource.trim().length > 0)) {
      throw new Error('Invalid action');
    }
    ids.add(item.actionId);
    return {
      id: item.actionId, agent: item.agentName, type: item.type, status: item.state,
      title: Object.hasOwn(TYPES, item.type) ? TYPES[item.type] : item.type, project: item.projectName, reason: item.reason,
      resources: [...item.resources], dateTime: item.createdAt,
    };
  });
}

export default function Actions() {
  const [actions, setActions] = useState([]);
  const [activeTab, setActiveTab] = useState('pending');
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const requestVersion = useRef(0);
  const currentTab = TABS.find((tab) => tab.id === activeTab);
  const visibleActions = actions.filter((action) => belongsToTab(action, activeTab));
  const busy = loading || processingId !== null;

  async function loadActions() {
    const version = ++requestVersion.current;
    setLoading(true);
    try {
      const response = await fetch('/api/lab/api/actions', { cache: 'no-store' });
      if (!response.ok) throw new Error('Request failed');
      const nextActions = parseActions(await response.json());
      if (version === requestVersion.current) setActions(nextActions);
    } catch {
      if (version === requestVersion.current) {
        setActions([]);
        setError('No se pudieron cargar las acciones. Intenta actualizar.');
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) void loadActions(); });
    return () => { active = false; requestVersion.current += 1; };
  }, []);

  async function decide(action, decision) {
    if (busyRef.current || loading || action.status !== 'pending' || action.type !== 'read') return;
    busyRef.current = true;
    if (decision === 'approve_once' && !window.confirm(
      `El agente podrá leer ${action.resources.length} archivo(s) una sola vez. ¿Deseas permitirlo?`,
    )) {
      busyRef.current = false;
      return;
    }
    setProcessingId(action.id);
    setError('');
    try {
      const response = await fetch('/api/lab/api/actions/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actionId: action.id, decision }),
      });
      if (!response.ok) throw new Error('Decision failed');
    } catch {
      setError('No se pudo completar la decisión. Revisa el estado actualizado de la acción.');
    } finally {
      await loadActions();
      setProcessingId(null);
      busyRef.current = false;
    }
  }

  return (
    <main className="actions" aria-labelledby="actions-title">
      <div className="actions-content">
        <header className="actions-header">
          <p className="actions-eyebrow">Consola de autorización</p>
          <h1 id="actions-title">Acciones</h1>
          <p>Revisa y controla las acciones que los agentes necesitan realizar.</p>
        </header>
        <div className="actions-toolbar">
          <button type="button" className="action-button" disabled={busy} onClick={() => {
            setError('');
            void loadActions();
          }}>Actualizar</button>
        </div>
        <div className="actions-counters" aria-label="Resumen de acciones">
          {TABS.map((tab) => (
            <div className={`actions-counter actions-counter--${tab.id}`} key={tab.id}>
              <span>{tab.label}</span>
              <strong>{actions.filter((action) => belongsToTab(action, tab.id)).length}</strong>
            </div>
          ))}
        </div>
        <nav className="actions-tabs" aria-label="Filtrar acciones por estado">
          {TABS.map((tab) => (
            <button type="button" key={tab.id} aria-pressed={activeTab === tab.id}
              className={activeTab === tab.id ? 'is-active' : ''}
              onClick={() => setActiveTab(tab.id)}>{tab.label}</button>
          ))}
        </nav>
        <p className="actions-feedback" role="status">
          {processingId ? 'Procesando decisión…' : loading ? 'Cargando acciones…' : ''}
        </p>
        {error && <p className="actions-error" role="alert">{error}</p>}
        <section aria-busy={busy} className="actions-list" aria-label={`Acciones: ${currentTab.label}`}>
          {visibleActions.length > 0
            ? visibleActions.map((action) => <ActionCard key={action.id} action={action} onDecision={decide} busy={busy} processing={processingId === action.id} />)
            : !loading && !error && <div className="actions-empty"><span aria-hidden="true">◇</span><p>{currentTab.empty}</p></div>}
        </section>
      </div>
    </main>
  );
}
