import { useEffect, useRef, useState } from 'react';
import './Viewer.css';

function agentName(id) {
  return id.split('-').map((word) => word === 'sql' ? 'SQL' : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function conversationTitle(content) {
  const characters = Array.from(content.trim());
  const title = characters.slice(0, 60).join('');
  if (characters.length <= 60 || /\s/.test(characters[60])) return title.trimEnd();
  const boundary = title.search(/\s+\S*$/);
  return boundary > 0 ? title.slice(0, boundary) : title.trimEnd();
}

async function postConversation(path, body, failureMessage) {
  try {
    const response = await fetch(`/api/lab/api/conversations${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!Number.isSafeInteger(data?.id) || data.id <= 0) throw new Error();
    return data;
  } catch {
    throw new Error(failureMessage);
  }
}

const configuration = [
  ['Modelo', 'Qwen3:8b'],
  ['Ejecución', 'Local'],
  ['Backend', 'Ollama'],
  ['Workspace', '/workspace'],
];

function Viewer({ activeSection }) {
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [draft, setDraft] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const requestInProgress = useRef(false);
  const [agents, setAgents] = useState([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState('');
  const [activeAgentId, setActiveAgentId] = useState('senior-developer');
  const [loadedAgent, setLoadedAgent] = useState(null);
  const [agentError, setAgentError] = useState('');
  const [agentLoading, setAgentLoading] = useState(true);
  const activeAgentName = agentName(activeAgentId);
  const agentReady = !agentsLoading && !agentsError && !agentLoading
    && loadedAgent?.id === activeAgentId && Boolean(loadedAgent.content.trim());

  useEffect(() => {
    const controller = new AbortController();
    async function loadAgents() {
      try {
        const response = await fetch('/api/lab/api/agents', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(data) || !data.every((agent) =>
          typeof agent.id === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(agent.id)
          && agent.filename === `${agent.id}.md`)) throw new Error();
        if (!controller.signal.aborted) setAgents(data);
      } catch {
        if (!controller.signal.aborted) setAgentsError('No se pudo cargar la lista de agentes. Comprueba el servidor local y recarga la página.');
      } finally {
        if (!controller.signal.aborted) setAgentsLoading(false);
      }
    }
    void loadAgents();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAgent() {
      try {
        const response = await fetch(`/api/lab/api/agents/${encodeURIComponent(activeAgentId)}`, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (data.id !== activeAgentId || typeof data.content !== 'string' || !data.content.trim()) throw new Error();
        if (!controller.signal.aborted) setLoadedAgent({ id: data.id, content: data.content });
      } catch {
        if (!controller.signal.aborted) setAgentError('No se pudieron cargar las instrucciones del agente. Comprueba el servidor local; el chat permanece bloqueado.');
      } finally {
        if (!controller.signal.aborted) setAgentLoading(false);
      }
    }
    void loadAgent();
    return () => controller.abort();
  }, [activeAgentId]);

  function selectAgent(id) {
    if (requestInProgress.current || id === activeAgentId) return;
    setActiveAgentId(id);
    setLoadedAgent(null);
    setAgentLoading(true);
    setAgentError('');
    setMessages([]);
    setConversationId(null);
    setDraft('');
    setError('');
  }


  async function sendMessage() {
    const content = draft.trim();
    if (!content || requestInProgress.current || !agentReady) return;

    const nextMessages = [...messages, { role: 'user', content }];
    requestInProgress.current = true;
    setError('');
    setIsLoading(true);

    let userSaved = false;
    try {
      let activeConversationId = conversationId;
      if (activeConversationId === null) {
        const conversation = await postConversation('', {
          titulo: conversationTitle(content),
          agente_id: activeAgentId,
          modelo: 'qwen3:8b',
          workspace: '/workspace',
        }, 'No se pudo crear la conversación. Comprueba el servidor local.');
        activeConversationId = conversation.id;
        setConversationId(activeConversationId);
      }
      await postConversation(`/${activeConversationId}/messages`, {
        rol: 'user', contenido: content,
      }, 'No se pudo guardar tu mensaje. No se ha enviado a Ollama.');
      userSaved = true;
      setMessages(nextMessages);
      setDraft('');

      const response = await fetch('/api/ollama/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen3:8b',
          messages: [{ role: 'system', content: loadedAgent.content }, ...nextMessages],
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
      try {
        await postConversation(`/${activeConversationId}/messages`, {
          rol: 'assistant', contenido: data.message.content,
        }, 'La respuesta de Qwen está visible, pero no pudo guardarse. No se reintentará automáticamente.');
      } catch (saveError) {
        setError(saveError.message);
      }
      setMessages([...nextMessages, { role: 'assistant', content: data.message.content }]);
    } catch (requestError) {
      setError(userSaved ? `No se pudo obtener una respuesta. ${requestError instanceof TypeError
        ? 'Comprueba que Ollama esté disponible y que Vite esté ejecutándose con el proxy.'
        : requestError.message} Puedes volver a enviar un mensaje.` : requestError.message);
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
            <>
              <p className="section-description">Agente seleccionado: <strong>{activeAgentName}</strong></p>
              {agentsLoading && <p role="status">Cargando agentes...</p>}
              {agentsError && <p className="chat-error" role="alert">{agentsError}</p>}
              {agentLoading && <p role="status">Cargando instrucciones del agente...</p>}
              {agentError && <p className="chat-error" role="alert">{agentError}</p>}
              {!agentsLoading && !agentsError && agents.length === 0 && <p>No hay agentes disponibles.</p>}
              <ul className="agent-grid">
                {agents.map((agent) => (
                  <li className={`section-card${agent.id === activeAgentId ? ' selected-agent' : ''}`} key={agent.id}>
                    <h2>{agentName(agent.id)}</h2>
                    <p>{agent.filename}</p>
                    <button
                      className="agent-select"
                      type="button"
                      aria-pressed={agent.id === activeAgentId}
                      disabled={isLoading}
                      onClick={() => selectAgent(agent.id)}
                    >
                      {agent.id === activeAgentId ? 'Seleccionado' : 'Seleccionar'}
                    </button>
                  </li>
                ))}
              </ul>
            </>
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
              <h2>Historial próximamente</h2>
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
          <h1 id="viewer-title">{activeAgentName}</h1>
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
                <span className="message-author">{message.role === 'user' ? 'Tú' : activeAgentName}</span>
                <p>{message.content}</p>
              </li>
            ))}
          </ol>
        )}
        {(agentsLoading || agentLoading) && <p className="chat-status" role="status">Cargando agente...</p>}
        {agentsError && <p className="chat-error" role="alert">{agentsError}</p>}
        {agentError && <p className="chat-error" role="alert">{agentError}</p>}
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
            <span>{activeAgentName} · Qwen3:8b</span>
            <button type="button" disabled={isLoading || !draft.trim() || !agentReady} onClick={sendMessage}>Enviar</button>
          </div>
        </div>
        <p className="composer-note">Enter para enviar · Shift+Enter para una nueva línea. Los mensajes se guardan localmente; el historial estará disponible próximamente.</p>
      </div>
    </main>
  );
}

export default Viewer;
