import { useCallback, useEffect, useRef, useState } from 'react';
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

function validProposalId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function Viewer({ activeSection, onSelectSection }) {
  const [openCode, setOpenCode] = useState(null);
  const [openCodeLoading, setOpenCodeLoading] = useState(true);
  const [openCodeError, setOpenCodeError] = useState('');
  const [workspaceSummary, setWorkspaceSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const summaryPending = useRef(false);
  const [changeRequest, setChangeRequest] = useState('');
  const [proposalLoading, setProposalLoading] = useState(false);
  const [proposalError, setProposalError] = useState('');
  const [changeProposal, setChangeProposal] = useState(null);
  const proposalPending = useRef(false);
  const applyPending = useRef(false);
  const consumedProposalIds = useRef(new Set());
  const [applyState, setApplyState] = useState('idle');
  const [applyError, setApplyError] = useState('');
  const [appliedFiles, setAppliedFiles] = useState([]);
  const [proposalConsumed, setProposalConsumed] = useState(false);
  const [proposalExpired, setProposalExpired] = useState(false);

  useEffect(() => {
    if (!changeProposal || !Number.isSafeInteger(changeProposal.expiresAt)) return;
    const timer = window.setTimeout(() => setProposalExpired(true),
      Math.min(Math.max(0, changeProposal.expiresAt - Date.now()), 2_147_483_647));
    return () => window.clearTimeout(timer);
  }, [changeProposal]);
  const canAnalyzeWorkspace = !openCodeLoading && !openCodeError && openCode?.available
    && openCode.running && openCode.cliAvailable && openCode.workspace !== null;
  const [workspaces, setWorkspaces] = useState([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(true);
  const [workspacesError, setWorkspacesError] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] = useState(null);
  const [activeWorkspace, setActiveWorkspace] = useState(null);
  const [infrastructure, setInfrastructure] = useState(null);
  const [activeWorkspaceLoading, setActiveWorkspaceLoading] = useState(true);
  const [activeWorkspaceError, setActiveWorkspaceError] = useState('');
  const activeWorkspaceRequest = useRef(0);
  const [workspaceActivating, setWorkspaceActivating] = useState(false);
  const [activationError, setActivationError] = useState('');
  const activationPending = useRef(false);
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
    if (activeSection !== 'Configuración') return;
    const controller = new AbortController();
    async function loadOpenCode() {
      setOpenCodeLoading(true);
      setOpenCodeError('');
      setOpenCode(null);
      try {
        const response = await fetch('/api/lab/api/opencode/status', {
          signal: controller.signal, cache: 'no-store',
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!data || !['available', 'running', 'cliAvailable'].every((key) => typeof data[key] === 'boolean')
          || !(data.workspace === null || typeof data.workspace === 'string')
          || !(data.version === null || typeof data.version === 'string')) throw new Error();
        if (!controller.signal.aborted) setOpenCode(data);
      } catch {
        if (!controller.signal.aborted) setOpenCodeError('No se pudo consultar el estado de OpenCode. Comprueba el servidor local y Docker.');
      } finally {
        if (!controller.signal.aborted) setOpenCodeLoading(false);
      }
    }
    void loadOpenCode();
    return () => controller.abort();
  }, [activeSection]);

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

  useEffect(() => {
    if (activeSection !== 'Proyectos') return;
    const controller = new AbortController();
    async function loadWorkspaces() {
      setWorkspacesLoading(true);
      setWorkspacesError('');
      try {
        const response = await fetch('/api/lab/api/workspaces', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(data) || !data.every((workspace) =>
          workspace && typeof workspace.path === 'string' && workspace.path.startsWith('/')
          && ['windows', 'wsl'].includes(workspace.type)
          && typeof workspace.exists === 'boolean')) throw new Error();
        if (!controller.signal.aborted) setWorkspaces(data);
      } catch {
        if (!controller.signal.aborted) setWorkspacesError('No se pudieron cargar los proyectos. Comprueba el servidor local.');
      } finally {
        if (!controller.signal.aborted) setWorkspacesLoading(false);
      }
    }
    void loadWorkspaces();
    return () => controller.abort();
  }, [activeSection]);

  const loadActiveWorkspace = useCallback(async (signal) => {
    const requestId = ++activeWorkspaceRequest.current;
    setActiveWorkspaceLoading(true);
    setActiveWorkspaceError('');
    setActiveWorkspace(null);
    setInfrastructure(null);
    try {
      const response = await fetch('/api/lab/api/workspaces/active', { signal, cache: 'no-store' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!data || typeof data.active !== 'boolean' || typeof data.running !== 'boolean'
        || !(data.workspace === null || (typeof data.workspace === 'string' && data.workspace.length > 0))
        || data.active !== (data.running && data.workspace !== null)) throw new Error();
      if (!signal?.aborted && requestId === activeWorkspaceRequest.current) {
        setInfrastructure(data);
        setActiveWorkspace(data.active ? data.workspace : null);
      }
      return data;
    } catch {
      if (!signal?.aborted && requestId === activeWorkspaceRequest.current) {
        setActiveWorkspaceError('No se pudo consultar Docker para determinar el workspace activo.');
      }
      throw new Error('No se pudo verificar el workspace activo mediante Docker.');
    } finally {
      if (!signal?.aborted && requestId === activeWorkspaceRequest.current) setActiveWorkspaceLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeSection !== 'Proyectos') return;
    const controller = new AbortController();
    void loadActiveWorkspace(controller.signal).catch(() => {});
    return () => controller.abort();
  }, [activeSection, loadActiveWorkspace]);

  async function analyzeWorkspace() {
    if (summaryPending.current || proposalPending.current || applyPending.current || !canAnalyzeWorkspace) return;
    summaryPending.current = true;
    setSummaryLoading(true);
    setSummaryError('');
    setWorkspaceSummary(null);
    try {
      const response = await fetch('/api/lab/api/opencode/workspace-summary', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(response.status === 409 ? 'Ya hay un análisis de OpenCode en curso.'
          : response.status === 504 ? 'El análisis de OpenCode excedió el tiempo máximo.'
            : response.status === 503 ? 'OpenCode o su workspace no están disponibles para analizar con Reviewer.'
              : response.status === 502 ? (data?.error === 'No se pudo inspeccionar el workspace de forma segura.'
                ? 'No se pudo inspeccionar el workspace de forma segura.'
                : 'OpenCode no devolvió un resumen válido en el formato esperado.')
              : 'No se pudo completar el análisis de OpenCode.');
      }
      if (data?.success !== true || data.agent !== 'reviewer'
        || typeof data.workspace !== 'string' || !data.workspace.startsWith('/')
        || !data.summary || typeof data.summary !== 'object' || Array.isArray(data.summary)
        || Object.keys(data.summary).length !== 4
        || !['tipo', 'proposito', 'limitaciones'].every((key) =>
          typeof data.summary[key] === 'string' && data.summary[key].trim())
        || !Array.isArray(data.summary.elementos) || data.summary.elementos.length > 100
        || !data.summary.elementos.every((value) => typeof value === 'string' && value.trim())
        || JSON.stringify(data.summary).length > 256 * 1024) throw new Error('OpenCode devolvió una respuesta no válida.');
      setWorkspaceSummary(data);
    } catch (error) {
      setSummaryError(error instanceof TypeError ? 'No se pudo consultar OpenCode. Comprueba el servidor local.' : error.message);
    } finally {
      summaryPending.current = false;
      setSummaryLoading(false);
    }
  }

  async function activateSelectedWorkspace() {
    if (applyPending.current || activationPending.current || workspacesLoading || workspacesError
      || !workspaces.some((workspace) => workspace.path === selectedWorkspace && workspace.exists)) return;
    const path = selectedWorkspace;
    activationPending.current = true;
    setWorkspaceActivating(true);
    setActivationError('');
    let infrastructureConfirmed = false;
    try {
      const response = await fetch('/api/lab/api/workspaces/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(response.status === 409 ? 'Ya hay una activación de workspace en curso.'
          : 'No se pudo activar el workspace. Comprueba que siga disponible en el historial reciente.');
      }
      if (data?.success !== true || data.workspace !== path) throw new Error('Respuesta de activación no válida.');
      const confirmed = await loadActiveWorkspace();
      infrastructureConfirmed = true;
      if (!confirmed.active || !confirmed.running || confirmed.workspace !== path) {
        throw new Error('La activación no pudo verificarse: el workspace montado no coincide con el solicitado.');
      }
    } catch (failure) {
      // A failed or disconnected request may have partially changed OpenCode.
      if (!infrastructureConfirmed) {
        setActiveWorkspace(null);
        setInfrastructure(null);
      }
      setActivationError(`${failure instanceof TypeError ? 'No se pudo confirmar la activación. Comprueba el servidor local.' : failure.message}${infrastructureConfirmed ? '' : ' El workspace activo no está confirmado.'}`);
    } finally {
      activationPending.current = false;
      setWorkspaceActivating(false);
    }
  }

  async function generateChangeProposal() {
    if (applyPending.current || proposalPending.current || summaryPending.current || activationPending.current
      || requestInProgress.current || openingRequest.current || !canAnalyzeWorkspace || !changeRequest.trim()) return;
    proposalPending.current = true;
    setProposalLoading(true);
    setProposalError('');
    setChangeProposal(null);
    setApplyState('idle');
    setApplyError('');
    setAppliedFiles([]);
    setProposalConsumed(false);
    setProposalExpired(false);
    try {
      const response = await fetch('/api/lab/api/opencode/change-proposal', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: changeRequest.trim() }),
      });
      const data = await response.json();
      if (!response.ok) {
        const errors = {
          BUSY: 'Ya hay una propuesta en curso.',
          DIRTY_WORKSPACE: 'El repositorio debe estar completamente limpio: sin cambios ni archivos sin seguimiento.',
          NOT_REPOSITORY: 'El workspace debe ser la raíz de un repositorio Git válido.',
          NO_HEAD: 'El repositorio debe tener un HEAD válido.',
          INVALID_REQUEST: 'Describe el cambio usando entre 1 y 4000 caracteres, sin caracteres de control.',
          BODY_TOO_LARGE: 'La solicitud es demasiado grande.',
          UNAVAILABLE: 'OpenCode o su workspace no están disponibles.',
          UNSAFE_AGENT: 'No se pudo confirmar que Senior Developer tenga únicamente herramientas de lectura.',
          INVALID_MODEL_RESPONSE: 'Senior Developer no devolvió una propuesta con el formato esperado.',
          INVALID_PATCH_STRUCTURE: 'El diff generado no cumple la estructura segura requerida.',
          INVALID_TARGET_FILES: 'La propuesta intenta modificar archivos que no están permitidos.',
          PATCH_CHECK_FAILED: 'Git comprobó el diff, pero no puede aplicarse sobre el estado actual del proyecto.',
          WORKSPACE_CHANGED: 'El workspace activo cambió durante la propuesta.',
          HEAD_CHANGED: 'El HEAD cambió durante la propuesta. Genera una nueva propuesta sobre la base actual.',
          WORKSPACE_NOT_SAFE: 'Error crítico: el workspace cambió o no se pudo confirmar que siga limpio. No se puede afirmar que la propuesta fue segura.',
          TIMEOUT: 'La propuesta excedió el tiempo máximo.',
        };
        if (data?.code === 'PATCH_CHECK_FAILED') {
          const reasons = {
            index_metadata_mismatch: 'El diff contiene metadatos Git que no coinciden con el proyecto actual.',
            content_or_context_mismatch: 'El contenido que el diff intenta modificar no coincide con el archivo actual.',
            unknown: 'Git rechazó el diff y no se pudo determinar la causa de forma segura.',
          };
          throw new Error(Object.hasOwn(reasons, data.patchCheckReason)
            ? reasons[data.patchCheckReason] : reasons.unknown);
        }
        if (data?.code === 'INVALID_PATCH_STRUCTURE') {
          const reasons = {
            missing_final_newline: 'El diff generado no terminó con el formato requerido.',
            unexpected_diff_header: 'El diff generado contiene una cabecera de archivo no permitida.',
            duplicate_file: 'El diff generado repite un archivo.',
            invalid_index_line: 'El diff generado contiene una línea de índice con formato inválido.',
            invalid_file_headers: 'El diff generado contiene cabeceras de archivo con formato inválido.',
            invalid_hunk_header: 'El diff generado contiene un bloque de cambios con formato inválido.',
            invalid_hunk_body: 'El diff generado contiene líneas de cambios con formato inválido.',
            invalid_hunk_counts: 'El diff generado contiene conteos de líneas inconsistentes.',
            no_changes: 'El diff generado no contiene cambios de texto.',
            declared_files_mismatch: 'El diff generado no coincide con los archivos declarados.',
          };
          throw new Error(Object.hasOwn(reasons, data.patchStructureReason)
            ? reasons[data.patchStructureReason] : errors.INVALID_PATCH_STRUCTURE);
        }
        if (data?.code === 'INVALID_MODEL_RESPONSE') {
          const reasons = {
            invalid_jsonl: 'La respuesta de Senior Developer no pudo procesarse.',
            opencode_error: 'OpenCode informó un error al generar la propuesta.',
            unexpected_tool: 'Senior Developer intentó utilizar una herramienta no permitida.',
            invalid_text_event: 'La respuesta de Senior Developer no pudo procesarse.',
            no_text: 'Senior Developer terminó sin devolver una propuesta.',
            invalid_json: 'Senior Developer respondió, pero no produjo JSON válido.',
            invalid_contract: 'Senior Developer produjo JSON, pero no cumplió el formato de propuesta.',
          };
          throw new Error(Object.hasOwn(reasons, data.modelResponseReason)
            ? reasons[data.modelResponseReason] : errors.INVALID_MODEL_RESPONSE);
        }
        if (data?.code === 'TIMEOUT') {
          const stages = {
            body_validation: 'lectura y validación de la solicitud',
            initial_opencode_status: 'consulta inicial de OpenCode',
            repository_validation: 'validación del repositorio',
            initial_git_status: 'estado inicial de Git', head_revision: 'consulta de HEAD',
            debug_agent: 'verificación de Senior Developer', opencode_run: 'ejecución de Senior Developer',
            parse_proposal: 'validación de la respuesta', target_files_validation: 'validación de archivos',
            patch_check: 'comprobación del diff', final_opencode_status: 'consulta final de OpenCode',
            final_git_audit: 'auditoría final de Git',
          };
          let message = Object.hasOwn(stages, data.stage)
            ? `La propuesta excedió el tiempo máximo durante: ${stages[data.stage]}.` : errors.TIMEOUT;
          const timing = data.timing;
          if (Number.isFinite(timing?.elapsedMs) && timing.elapsedMs >= 0
            && Number.isFinite(timing?.modelBudgetSeconds) && timing.modelBudgetSeconds >= 0) {
            message += ` Tiempo consumido: ${(timing.elapsedMs / 1000).toFixed(1)} s. Presupuesto del modelo: ${timing.modelBudgetSeconds} s.`;
          }
          throw new Error(message);
        }
        throw new Error(Object.hasOwn(errors, data?.code) ? errors[data.code] : 'No se pudo generar una propuesta segura.');
      }
      const proposal = data?.proposal;
      if (data?.success !== true || data.engine !== 'ollama-deterministic'
        || typeof data.workspace !== 'string' || !data.workspace.startsWith('/')
        || typeof data.baseHead !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(data.baseHead)
        || !proposal || typeof proposal !== 'object' || Array.isArray(proposal)
        || Object.keys(proposal).length !== 3
        || typeof proposal.summary !== 'string' || !proposal.summary.trim() || proposal.summary.length > 4000
        || !Array.isArray(proposal.files) || proposal.files.length < 1 || proposal.files.length > 20
        || !proposal.files.every((file) => typeof file === 'string' && file.trim())
        || typeof proposal.patch !== 'string' || !proposal.patch.trim()
        || new TextEncoder().encode(proposal.patch).length > 512 * 1024) {
        throw new Error('El servidor devolvió una propuesta no válida.');
      }
      const proposalId = validProposalId(data.proposalId) ? data.proposalId : null;
      const expiresAt = Number.isSafeInteger(data.expiresAt) && data.expiresAt > 0 ? data.expiresAt : null;
      setChangeProposal({ ...data, proposalId, expiresAt });
      setProposalConsumed(consumedProposalIds.current.has(proposalId));
      setProposalExpired(expiresAt === null || expiresAt <= Date.now());
    } catch (failure) {
      setProposalError(failure instanceof TypeError
        ? 'No se pudo consultar el servidor local para generar la propuesta.'
        : failure instanceof SyntaxError ? 'El servidor devolvió una respuesta no válida.' : failure.message);
    } finally {
      proposalPending.current = false;
      setProposalLoading(false);
    }
  }

  async function applyChangeProposal() {
    const proposal = changeProposal;
    if (!proposal || !validProposalId(proposal.proposalId) || applyPending.current
      || consumedProposalIds.current.has(proposal.proposalId) || proposalPending.current
      || summaryPending.current || activationPending.current) return;
    if (!Number.isSafeInteger(proposal.expiresAt) || proposal.expiresAt <= Date.now()) {
      setProposalExpired(true);
      return;
    }
    if (!window.confirm(`Se modificarán ${proposal.proposal.files.length} archivo(s) del proyecto. Esta acción no hará commit. ¿Deseas continuar?`)) return;
    // The proposal can expire while its confirmation dialog remains open.
    if (proposal.expiresAt <= Date.now()) {
      setProposalExpired(true);
      return;
    }
    applyPending.current = true;
    consumedProposalIds.current.add(proposal.proposalId);
    setProposalConsumed(true);
    setApplyState('applying');
    setApplyError('');
    const uncertainMessage = 'No se pudo confirmar la aplicación. Pueden existir cambios parciales; se requiere revisión manual. Genera una nueva propuesta después de revisar.';
    try {
      const response = await fetch('/api/lab/api/opencode/apply-change-proposal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: proposal.proposalId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setApplyError(typeof data?.error === 'string' && data.error.trim() ? data.error : uncertainMessage);
        setApplyState('failed');
        return;
      }
      if (data?.applied !== true || !Array.isArray(data.files)
        || data.files.length !== proposal.proposal.files.length
        || new Set(data.files).size !== data.files.length
        || !data.files.every((file) => proposal.proposal.files.includes(file))) {
        setApplyError(uncertainMessage);
        setApplyState('failed');
        return;
      }
      setAppliedFiles(data.files);
      setApplyState('applied');
    } catch {
      // Never display exception text or retry a request whose outcome is unknown.
      setApplyError(uncertainMessage);
      setApplyState('failed');
    } finally {
      applyPending.current = false;
    }
  }

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

  function resetChat() {
    setMessages([]);
    setConversationId(null);
    setDraft('');
    setError('');
  }

  function newChat() {
    if (requestInProgress.current || openingRequest.current) return;
    resetChat();
  }

  function selectAgent(id) {
    if (requestInProgress.current || openingRequest.current || id === activeAgentId) return;
    setActiveAgentId(id);
    setLoadedAgent(null);
    setAgentLoading(true);
    setAgentError('');
    resetChat();
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
              <p className="section-description">Seleccionar es solo visual. Para cambiar OpenCode, pulsa Activar workspace. OpenCode ve el proyecto como <code>/workspace</code>.</p>
              {selectedWorkspace && <p>Seleccionado: <code>{selectedWorkspace}</code></p>}
              {workspaceActivating && <p className="workspace-activating" role="status">Activando workspace...</p>}
              {activeWorkspaceLoading && <p className="workspace-activating" role="status">Consultando workspace activo...</p>}
              {activeWorkspaceError && <p className="chat-error" role="alert">{activeWorkspaceError}</p>}
              {!activeWorkspaceLoading && infrastructure && !infrastructure.running && <p role="status">OpenCode no está ejecutándose.</p>}
              {!activeWorkspaceLoading && infrastructure?.running && !infrastructure.active && <p role="status">OpenCode está ejecutándose, pero no tiene un montaje en /workspace.</p>}
              {activeWorkspace && <p className="workspace-active" role="status">Workspace activo: <code>{activeWorkspace}</code></p>}
              {activationError && <p className="chat-error" role="alert">{activationError}</p>}
              {!workspacesLoading && !workspacesError && workspaces.some((workspace) => workspace.path === selectedWorkspace && workspace.exists) && (
                <button className="agent-select workspace-activate" type="button"
                  disabled={workspaceActivating || applyState === 'applying'} onClick={() => void activateSelectedWorkspace()}>
                  Activar workspace
                </button>
              )}
              {workspacesLoading && <p role="status">Cargando proyectos...</p>}
              {workspacesError && <p className="chat-error" role="alert">{workspacesError}</p>}
              {!workspacesLoading && !workspacesError && workspaces.length === 0 && <p>No hay workspaces recientes.</p>}
              {!workspacesLoading && !workspacesError && (
                <ul className="project-list">
                  {workspaces.map((workspace) => (
                    <li className={`section-card project-card${workspace.path === selectedWorkspace ? ' selected-project' : ''}`} key={workspace.path}>
                      <code>{workspace.path}</code>
                      <div className="project-details">
                        <span className="project-type">{workspace.type === 'windows' ? 'Windows' : 'WSL'}</span>
                        <span className={`project-status ${workspace.exists ? 'available' : 'unavailable'}`}>
                          {workspace.exists ? 'Disponible' : 'No disponible'}
                        </span>
                        {infrastructure?.running && workspace.path === activeWorkspace && <span className="workspace-active">Activo</span>}
                      </div>
                      <button className="agent-select" type="button"
                        disabled={!workspace.exists || workspaceActivating}
                        aria-pressed={workspace.path === selectedWorkspace}
                        aria-label={`Seleccionar ${workspace.path}`}
                        onClick={() => { if (workspace.exists && !activationPending.current) setSelectedWorkspace(workspace.path); }}>
                        {workspace.path === selectedWorkspace ? 'Seleccionado' : 'Seleccionar'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
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
              <section className="opencode-status section-card" aria-labelledby="opencode-title">
                <h2 id="opencode-title">OpenCode</h2>
                {openCodeLoading && <p role="status">Consultando OpenCode...</p>}
                {openCodeError && <p className="chat-error" role="alert">{openCodeError}</p>}
                {!openCodeLoading && openCode && (
                  <>
                    <p role="status">{!openCode.available ? 'OpenCode no está disponible.'
                      : !openCode.running ? 'El contenedor OpenCode está detenido.'
                        : !openCode.cliAvailable ? 'El contenedor está ejecutándose, pero la CLI no está disponible.'
                          : !openCode.version ? 'Contenedor y CLI disponibles; no se pudo obtener la versión.'
                            : 'OpenCode funciona correctamente.'}</p>
                    <dl className="configuration-list">
                      <div className="configuration-row"><dt>Estado</dt><dd>{openCode.available ? 'Disponible' : 'No disponible'}</dd></div>
                      <div className="configuration-row"><dt>Contenedor</dt><dd>{!openCode.available ? 'No existe' : openCode.running ? 'Ejecutándose' : 'Detenido'}</dd></div>
                      <div className="configuration-row"><dt>CLI</dt><dd>{openCode.cliAvailable ? 'Disponible' : 'No disponible'}</dd></div>
                      {openCode.version && <div className="configuration-row"><dt>Versión</dt><dd>{openCode.version}</dd></div>}
                      <div className="configuration-row"><dt>Workspace real detectado</dt><dd><code>{openCode.workspace ?? 'No detectado'}</code></dd></div>
                    </dl>
                  </>
                )}
              </section>
              <section className="opencode-status section-card" aria-labelledby="workspace-summary-title">
                <h2 id="workspace-summary-title">Análisis del workspace</h2>
                <p>Agente: <strong>Reviewer</strong> · Solo lectura</p>
                <button className="agent-select" type="button"
                  disabled={!canAnalyzeWorkspace || summaryLoading || proposalLoading || applyState === 'applying'}
                  onClick={() => void analyzeWorkspace()}>Analizar workspace</button>
                {summaryLoading && <p role="status">Analizando workspace...</p>}
                {summaryError && <p className="chat-error" role="alert">{summaryError}</p>}
                {workspaceSummary && (
                  <div className="workspace-summary-result">
                    <p role="status">Respuesta recibida de OpenCode.</p>
                    <p>Workspace analizado: <code>{workspaceSummary.workspace}</code></p>
                    <dl className="workspace-summary-response">
                      <dt>Tipo de proyecto</dt><dd>{workspaceSummary.summary.tipo}</dd>
                      <dt>Archivos y directorios principales</dt>
                      <dd>{workspaceSummary.summary.elementos.length ? (
                        <ul>{workspaceSummary.summary.elementos.map((element, index) => <li key={index}>{element}</li>)}</ul>
                      ) : 'No se observaron archivos ni directorios.'}</dd>
                      <dt>Propósito aparente</dt><dd>{workspaceSummary.summary.proposito}</dd>
                      <dt>Limitaciones</dt><dd>{workspaceSummary.summary.limitaciones}</dd>
                    </dl>
                  </div>
                )}
              </section>
              <section className="opencode-status section-card change-proposal" aria-labelledby="change-proposal-title">
                <h2 id="change-proposal-title">Propuesta de cambio</h2>
                <p>Motor: <strong>Ollama · generación determinista</strong></p>
                <label className="composer-label" htmlFor="change-request">Describe el cambio que quieres realizar</label>
                <textarea id="change-request" rows={4} maxLength={4000}
                  placeholder="Describe el cambio que quieres realizar"
                  value={changeRequest} disabled={proposalLoading || applyState === 'applying'}
                  onChange={(event) => setChangeRequest(event.target.value)} />
                <button className="agent-select" type="button"
                  disabled={!canAnalyzeWorkspace || !changeRequest.trim() || proposalLoading || summaryLoading
                    || workspaceActivating || isLoading || openingId !== null || applyState === 'applying'}
                  onClick={() => void generateChangeProposal()}>Generar propuesta</button>
                {applyState === 'idle' && <p className="proposal-notice">Esta propuesta todavía no ha modificado archivos.</p>}
                {proposalLoading && <p role="status">Generando propuesta...</p>}
                {proposalError && <p className="chat-error" role="alert">{proposalError}</p>}
                {changeProposal && (
                  <div className="workspace-summary-result">
                    <p role="status">Propuesta recibida.</p>
                    <dl className="proposal-details">
                      <dt>Motor</dt><dd>Ollama · generación determinista</dd>
                      <dt>Workspace</dt><dd><code>{changeProposal.workspace}</code></dd>
                      <dt>HEAD base</dt><dd><code>{changeProposal.baseHead}</code></dd>
                      <dt>Resumen</dt><dd>{changeProposal.proposal.summary}</dd>
                      <dt>Archivos afectados</dt>
                      <dd><ul>{changeProposal.proposal.files.map((file) => <li key={file}><code>{file}</code></li>)}</ul></dd>
                    </dl>
                    <h3>Diff propuesto</h3>
                    <pre className="proposal-patch" tabIndex={0} aria-label="Diff propuesto"><code>{changeProposal.proposal.patch}</code></pre>
                    <div className="proposal-apply-actions" aria-busy={applyState === 'applying'}>
                      {validProposalId(changeProposal.proposalId) && (
                        <button className="agent-select proposal-apply" type="button"
                          disabled={proposalConsumed || proposalExpired || applyState !== 'idle'
                            || proposalLoading || summaryLoading || workspaceActivating}
                          onClick={() => void applyChangeProposal()}>
                          {applyState === 'applying' ? 'Aplicando...' : 'Aplicar cambio'}
                        </button>
                      )}
                      {applyState === 'applying' && <p className="proposal-notice" role="status">Aplicando...</p>}
                      {applyState === 'applied' && (
                        <div className="proposal-apply-success" role="status">
                          <p>Cambio aplicado correctamente.</p>
                          <p>Archivos aplicados:</p>
                          <ul>{appliedFiles.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
                        </div>
                      )}
                      {proposalExpired && applyState === 'idle' && !proposalConsumed && (
                        <p className="proposal-apply-expired" role="status">La propuesta expiró. Genera una nueva propuesta.</p>
                      )}
                      {applyError && <p className="chat-error" role="alert">{applyError}</p>}
                    </div>
                    {applyState === 'idle' && <p className="proposal-notice">Esta propuesta todavía no ha modificado archivos.</p>}
                  </div>
                )}
              </section>
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
        <div className="chat-header-actions">
          <button className="agent-select new-chat" type="button"
            disabled={isLoading || openingId !== null
              || (conversationId === null && messages.length === 0 && !draft && !error)}
            onClick={newChat}>Nuevo chat</button>
          <div className="workspace-label">
            <span>Workspace</span>
            <code>/workspace</code>
          </div>
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
