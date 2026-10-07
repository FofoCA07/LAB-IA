import './Viewer.css';

const agents = [
  ['Software Architect', 'Diseña la arquitectura y organiza los componentes del software.'],
  ['Senior Developer', 'Desarrolla soluciones y ayuda a mejorar el código.'],
  ['Reviewer', 'Revisa la calidad, claridad y mantenibilidad del código.'],
  ['Debugger', 'Analiza errores y ayuda a encontrar sus causas.'],
  ['Docker Expert', 'Orienta sobre contenedores y entornos Docker.'],
  ['SQL Expert', 'Ayuda a diseñar consultas y bases de datos relacionales.'],
  ['Profesor', 'Explica conceptos y guía el aprendizaje paso a paso.'],
  ['Prompt Engineer', 'Diseña y mejora instrucciones para modelos de inteligencia artificial.'],
];

const configuration = [
  ['Modelo', 'Qwen3:8b'],
  ['Ejecución', 'Local'],
  ['Backend', 'Ollama'],
  ['Workspace', '/workspace'],
];

function Viewer({ activeSection }) {
  if (activeSection !== 'Chat') {
    return (
      <main className="viewer" aria-labelledby="viewer-title">
        <header className="viewer-header">
          <div>
            <p className="viewer-eyebrow">Laboratorio</p>
            <h1 id="viewer-title">{activeSection}</h1>
          </div>
        </header>
        <section className="section-content" aria-label={activeSection}>
          {activeSection === 'Agentes' && (
            <ul className="agent-grid">
              {agents.map(([name, description]) => (
                <li className="section-card" key={name}>
                  <h2>{name}</h2>
                  <p>{description}</p>
                </li>
              ))}
            </ul>
          )}
          {activeSection === 'Proyectos' && (
            <>
              <p className="section-description">Aquí se mostrarán los workspaces disponibles.</p>
              <div className="section-card">
                <h2>Workspace actual</h2>
                <code>/workspace</code>
              </div>
            </>
          )}
          {activeSection === 'Historial' && (
            <div className="section-card">
              <h2>Todavía no existen conversaciones almacenadas</h2>
              <p>El historial de conversaciones estará disponible en una próxima etapa.</p>
            </div>
          )}
          {activeSection === 'Configuración' && (
            <>
              <p className="section-description">Valores informativos del laboratorio. Los servicios aún no están conectados.</p>
              <dl className="configuration-list section-card">
                {configuration.map(([label, value]) => (
                  <div className="configuration-row" key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="viewer" aria-labelledby="viewer-title">
      <header className="viewer-header">
        <div>
          <p className="viewer-eyebrow">Agente especializado</p>
          <h1 id="viewer-title">Senior Developer</h1>
        </div>
        <div className="workspace-label">
          <span>Workspace</span>
          <code>/workspace</code>
        </div>
      </header>

      <section className="chat-area" aria-label="Conversación">
        <div className="chat-welcome">
          <span className="welcome-mark" aria-hidden="true">&gt;_</span>
          <h2>¿Qué vamos a construir?</h2>
          <p>Un espacio para revisar código, explorar ideas y planificar tu próximo proyecto.</p>
        </div>
      </section>

      <div className="composer-area">
        <div className="composer">
          <label className="composer-label" htmlFor="chat-message">Tu mensaje</label>
          <textarea
            id="chat-message"
            placeholder="Describe tu idea o escribe una pregunta…"
            rows={3}
          />
          <div className="composer-footer">
            <span>Senior Developer · Qwen3:8b</span>
            <button type="button" disabled aria-describedby="visual-preview-note">Enviar</button>
          </div>
        </div>
        <p id="visual-preview-note" className="composer-note">Vista previa visual. El envío de mensajes aún no está disponible.</p>
      </div>
    </main>
  );
}

export default Viewer;
