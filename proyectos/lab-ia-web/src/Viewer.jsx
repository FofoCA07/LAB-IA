import { useRef, useState } from 'react';
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
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const requestInProgress = useRef(false);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || requestInProgress.current) return;

    const nextMessages = [...messages, { role: 'user', content }];
    requestInProgress.current = true;
    setMessages(nextMessages);
    setDraft('');
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/ollama/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen3:8b',
          messages: nextMessages,
          stream: false,
        }),
      });
      if (!response.ok) {
        throw new Error(`Ollama devolvió un error HTTP ${response.status}.`);
      }
      const data = await response.json();
      if (typeof data.message?.content !== 'string' || !data.message.content.trim()) {
        throw new Error('Ollama no devolvió una respuesta válida.');
      }
      setMessages([...nextMessages, { role: 'assistant', content: data.message.content }]);
    } catch (requestError) {
      setError(`No se pudo obtener una respuesta. ${requestError instanceof TypeError
        ? 'Comprueba que Ollama esté disponible y que Vite esté ejecutándose con el proxy.'
        : requestError.message} Puedes volver a enviar un mensaje.`);
    } finally {
      requestInProgress.current = false;
      setIsLoading(false);
    }
  }

  function handleMessageKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendMessage();
    }
  }

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
              <p className="section-description">Valores de referencia del laboratorio. El chat utiliza Ollama mediante el proxy de desarrollo.</p>
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

      <section className={`chat-area${messages.length ? ' has-messages' : ''}`} aria-label="Conversación">
        {messages.length === 0 && (
        <div className="chat-welcome">
          <span className="welcome-mark" aria-hidden="true">&gt;_</span>
          <h2>¿Qué vamos a construir?</h2>
          <p>Un espacio para revisar código, explorar ideas y planificar tu próximo proyecto.</p>
        </div>
        )}
        {messages.length > 0 && (
          <ol className="chat-messages" aria-label="Mensajes" aria-live="polite">
            {messages.map((message, index) => (
              <li className={`chat-message ${message.role}`} key={index}>
                <span className="message-author">{message.role === 'user' ? 'Tú' : 'Senior Developer'}</span>
                <p>{message.content}</p>
              </li>
            ))}
          </ol>
        )}
        {isLoading && <p className="chat-status" role="status">Pensando...</p>}
        {error && <p className="chat-error" role="alert">{error}</p>}
      </section>

      <div className="composer-area">
        <div className="composer">
          <label className="composer-label" htmlFor="chat-message">Tu mensaje</label>
          <textarea
            id="chat-message"
            placeholder="Describe tu idea o escribe una pregunta…"
            rows={3}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleMessageKeyDown}
          />
          <div className="composer-footer">
            <span>Senior Developer · Qwen3:8b</span>
            <button type="button" disabled={isLoading || !draft.trim()} onClick={sendMessage}>Enviar</button>
          </div>
        </div>
        <p className="composer-note">Enter para enviar · Shift+Enter para una nueva línea. Conversación guardada solo durante esta sesión.</p>
      </div>
    </main>
  );
}

export default Viewer;
