import { useState } from 'react';
import './Actions.css';

// Datos DEMO locales. No representan solicitudes ni permisos reales.
const DEMO_ACTIONS = [
  {
    id: 'demo-read', agent: 'Senior Developer', type: 'read', status: 'pending',
    title: 'Leer archivos del proyecto', project: 'Facturación',
    resources: ['ProductoController.java', 'ProductoDao.java'],
    reason: 'Revisar dónde debe agregarse la validación.', allowLabel: 'Permitir una vez',
  },
  {
    id: 'demo-docker', agent: 'Docker Expert', type: 'docker', status: 'pending',
    title: 'Reiniciar contenedor', project: 'LAB-IA',
    resources: ['Contenedor de ejemplo'],
    reason: 'Simular la autorización de un reinicio en esta interfaz.', allowLabel: 'Permitir',
  },
  {
    id: 'demo-sql', agent: 'SQL Expert', type: 'sql', status: 'running',
    title: 'Ejecutando consulta de validación', project: 'Facturación',
    resources: ['Consulta de ejemplo'], reason: 'Mostrar cómo se presenta una acción en ejecución.',
  },
  {
    id: 'demo-review', agent: 'Reviewer', type: 'read', status: 'completed',
    title: 'Revisión completada', project: 'LAB-IA',
    resources: [], reason: 'Mostrar el resultado visual de una revisión finalizada.',
  },
];

const TYPES = {
  read: 'Lectura', write: 'Escritura', command: 'Comando', test: 'Prueba',
  docker: 'Docker', sql: 'SQL', git: 'Git',
};

const STATUSES = {
  pending: 'Pendiente', running: 'Ejecutando', completed: 'Completada', denied: 'Rechazada',
};

const TABS = [
  { id: 'pending', label: 'Pendientes', empty: 'No hay acciones pendientes.' },
  { id: 'running', label: 'Ejecutando', empty: 'No hay acciones en ejecución.' },
  { id: 'completed', label: 'Finalizadas', empty: 'No hay acciones finalizadas.' },
];

function belongsToTab(action, tab) {
  return tab === 'completed'
    ? action.status === 'completed' || action.status === 'denied'
    : action.status === tab;
}

// Modelo visual reutilizable: type y status solo determinan su presentación.
function ActionCard({ action, onStatusChange }) {
  return (
    <article className={`action-card action-card--${action.status}`}>
      <div className="action-card-top">
        <span className="action-agent">{action.agent}</span>
        <span className="action-status">{STATUSES[action.status]}</span>
      </div>
      <h2>{action.title}</h2>
      <div className="action-tags">
        <span className="action-type" title={`Tipo: ${action.type}`}>{TYPES[action.type] || action.type}</span>
        {action.project && <span>Proyecto: {action.project}</span>}
      </div>
      <div className="action-reason">
        <span className="action-field-label">Motivo</span>
        <p>{action.reason}</p>
      </div>
      {action.resources?.length > 0 && (
        <div className="action-resources">
          <span className="action-field-label">Recursos afectados</span>
          <ul>{action.resources.map((resource) => <li key={resource}>{resource}</li>)}</ul>
        </div>
      )}
      {action.dateTime && (
        <time className="action-time" dateTime={action.dateTime}>
          {new Date(action.dateTime).toLocaleString('es')}
        </time>
      )}
      {action.status === 'pending' && (
        <div className="action-card-buttons">
          <button type="button" className="action-button action-button--primary"
            onClick={() => onStatusChange(action.id, 'running')}>
            {action.allowLabel || 'Permitir'}
          </button>
          <button type="button" className="action-button action-button--deny"
            onClick={() => onStatusChange(action.id, 'denied')}>Rechazar</button>
        </div>
      )}
      {action.status === 'running' && (
        <div className="action-card-buttons">
          <button type="button" className="action-button"
            onClick={() => onStatusChange(action.id, 'completed')}>Finalizar demo</button>
        </div>
      )}
    </article>
  );
}

export default function Actions() {
  const [actions, setActions] = useState(DEMO_ACTIONS);
  const [activeTab, setActiveTab] = useState('pending');
  const [announcement, setAnnouncement] = useState('');
  const currentTab = TABS.find((tab) => tab.id === activeTab);
  const visibleActions = actions.filter((action) => belongsToTab(action, activeTab));

  function changeStatus(id, status) {
    setActions((current) => current.map((action) => action.id === id ? { ...action, status } : action));
    const action = actions.find((item) => item.id === id);
    setAnnouncement(`${action.agent}: ${STATUSES[status]}. Cambio simulado localmente.`);
  }

  return (
    <main className="actions" aria-labelledby="actions-title">
      <div className="actions-content">
        <header className="actions-header">
          <p className="actions-eyebrow">Consola de autorización</p>
          <h1 id="actions-title">Acciones</h1>
          <p>Revisa y controla las acciones que los agentes necesitan realizar.</p>
        </header>
        <div className="actions-demo-notice">
          <div><span className="actions-demo-badge">DEMO / LOCAL</span>
            <p>Datos de ejemplo. Los botones solo cambian el estado visual; no conceden permisos ni ejecutan acciones reales.</p>
          </div>
          <button type="button" className="action-button" onClick={() => {
            setActions(DEMO_ACTIONS);
            setAnnouncement('Demo restablecida.');
          }}>Restablecer demo</button>
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
        <p className="actions-announcement" role="status">{announcement}</p>
        <section className="actions-list" aria-label={`Acciones: ${currentTab.label}`}>
          {visibleActions.length > 0
            ? visibleActions.map((action) => <ActionCard key={action.id} action={action} onStatusChange={changeStatus} />)
            : <div className="actions-empty"><span aria-hidden="true">◇</span><p>{currentTab.empty}</p></div>}
        </section>
        <p className="actions-footer">Sesión de demostración · Los cambios se reinician al salir del módulo.</p>
      </div>
    </main>
  );
}
