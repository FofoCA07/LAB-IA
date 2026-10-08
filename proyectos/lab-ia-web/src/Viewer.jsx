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

function validConversation(value) {
  return value && Number.isSafeInteger(value.id) && value.id > 0
    && ['titulo', 'agente_id', 'modelo', 'workspace', 'creada_en', 'actualizada_en']
      .every((field) => typeof value[field] === 'string' && value[field].trim())
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.agente_id)
    && Number.isFinite(Date.parse(value.creada_en))
    && Number.isFinite(Date.parse(value.actualizada_en));
}

function Viewer({ activeSection, onSelectSection }) {
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');
  const [openingId, setOpeningId] = useState(null);
  const [openError, setOpenError] = useState('');
  const openingRequest = useRef(null);
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
    if (loadedAgent?.id === activeAgentId) return;
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
  }, [activeAgentId, loadedAgent?.id]);

  useEffect(() => {
    if (activeSection !== 'Historial') return;
    const controller = new AbortController();
    async function loadHistory() {
      setHistoryLoading(true);
      setHistoryError('');
      try {
        const response = await fetch('/api/lab/api/conversations', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(data) || !data.every(validConversation)) throw new Error();
        if (!controller.signal.aborted) setHistory(data);
      } catch {
        if (!controller.signal.aborted) setHistoryError('No se pudo cargar el historial. Comprueba el servidor local.');
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }
    void loadHistory();
    return () => controller.abort();
  }, [activeSection, isLoading]);

  useEffect(() => () => openingRequest.current?.abort(), [activeSection]);

  async function openConversation(id) {
    if (requestInProgress.current || openingRequest.current) return;
    const controller = new AbortController();
    openingRequest.current = controller;
    setOpeningId(id);
    setOpenError('');
    try {
      const response = await fetch(`/api/lab/api/conversations/${id}`, { signal: controller.signal });
      if (!response.ok) throw new Error('No se pudo recuperar la conversación.');
      const data = await response.json();
      if (!validConversation(data?.conversation) || data.conversation.id !== id
        || !Array.isArray(data.messages) || !data.messages.every((message) =>
          message && Number.isSafeInteger(message.id) && message.id > 0
          && message.conversacion_id === id && ['user', 'assistant'].includes(message.rol)
          && typeof message.contenido === 'string' && message.contenido.trim()
          && typeof message.creado_en === 'string' && Number.isFinite(Date.parse(message.creado_en)))) {
        throw new Error('La conversación contiene datos no válidos.');
      }
      const agentId = data.conversation.agente_id;
      const agentResponse = await fetch(`/api/lab/api/agents/${encodeURIComponent(agentId)}`, { signal: controller.signal });
      if (!agentResponse.ok) {
        throw new Error(agentResponse.status === 404
          ? 'El agente de esta conversación ya no existe. No se abrió la conversación.'
          : 'No se pudo cargar el agente real. No se abrió la conversación.');
      }
      const agent = await agentResponse.json();
      if (agent?.id !== agentId || typeof agent.content !== 'string' || !agent.content.trim()) {
        throw new Error('Las instrucciones del agente no son válidas. No se abrió la conversación.');
      }
      if (controller.signal.aborted) return;
      setConversationId(id);
      setActiveAgentId(agentId);
      setLoadedAgent({ id: agentId, content: agent.content });
      setAgentLoading(false);
      setAgentError('');
      setMessages(data.messages.map((message) => ({ role: message.rol, content: message.contenido })));
      setDraft('');
      setError('');
      onSelectSection('Chat');
    } catch (openFailure) {
      if (!controller.signal.aborted) setOpenError(openFailure instanceof TypeError
        ? 'No se pudo abrir la conversación. Comprueba el servidor local.' : openFailure.message);
    } finally {
      openingRequest.current = null;
      setOpeningId(null);
    }
  }

  function selectAgent(id) {
    if (requestInProgress.current || openingRequest.current || id === activeAgentId) return;
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
    if (!content || requestInProgress.current || openingRequest.current || !agentReady) return;

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
                      disabled={isLoading || openingId !== null}
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
            <>
              {historyLoading && <p role="status">Cargando historial...</p>}
              {historyError && <p className="chat-error" role="alert">{historyError}</p>}
              {openError && <p className="chat-error" role="alert">{openError}</p>}
              {openingId !== null && <p role="status">Abriendo conversación y cargando su agente...</p>}
              {!historyLoading && !historyError && history.length === 0 && <p>No hay conversaciones guardadas.</p>}
              {!historyLoading && !historyError && (
                <ul className="history-list">
                  {history.map((conversation) => (
                    <li className="section-card" key={conversation.id}>
                      <h2>{conversation.titulo}</h2>
                      <p>{agentName(conversation.agente_id)} · <time dateTime={conversation.actualizada_en}>
                        {new Date(conversation.actualizada_en).toLocaleString()}
                      </time></p>
                      <button className="agent-select" type="button"
                        disabled={isLoading || openingId !== null}
                        aria-label={`Abrir ${conversation.titulo}`}
                        onClick={() => void openConversation(conversation.id)}>Abrir conversación</button>
                    </li>
                  ))}
                </ul>
              )}
            </>
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
            <button type="button" disabled={isLoading || openingId !== null || !draft.trim() || !agentReady} onClick={sendMessage}>Enviar</button>
          </div>
        </div>
        <p className="composer-note">Enter para enviar · Shift+Enter para una nueva línea. Los mensajes se guardan localmente y pueden recuperarse desde Historial.</p>
      </div>
    </main>
  );
}

export default Viewer;
