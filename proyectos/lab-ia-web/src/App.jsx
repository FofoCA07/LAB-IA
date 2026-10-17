import { useCallback, useEffect, useRef, useState } from 'react';
import Pairing from './Pairing';
import { getSession, logout } from './auth';
import Header from './Header';
import Sidebar from './Sidebar';
import Viewer from './Viewer';
import Actions from './Actions';
import './App.css';

function App() {
  const [activeSection, setActiveSection] = useState('Chat');
  const [auth, setAuth] = useState({ status: 'checking', csrfToken: null });
  const [authError, setAuthError] = useState('');
  const [loggingOut, setLoggingOut] = useState(false);
  const logoutPending = useRef(false);

  useEffect(() => {
    let active = true;
    getSession().then(session => {
      if (active) setAuth(session.authenticated
        ? { status: 'authenticated', csrfToken: session.csrfToken }
        : { status: 'unauthenticated', csrfToken: null });
    }).catch(error => {
      if (active) {
        setAuthError(error.message);
        setAuth({ status: 'unauthenticated', csrfToken: null });
      }
    });
    return () => { active = false; };
  }, []);

  const invalidateSession = useCallback(() => {
    setAuthError('');
    setAuth({ status: 'unauthenticated', csrfToken: null });
  }, []);

  async function completePairing() {
    const session = await getSession();
    if (!session.authenticated) throw new Error('La sesión no pudo iniciarse.');
    setAuthError('');
    setActiveSection('Chat');
    setAuth({ status: 'authenticated', csrfToken: session.csrfToken });
  }

  async function closeSession() {
    if (logoutPending.current) return;
    logoutPending.current = true;
    setLoggingOut(true);
    setAuthError('');
    try {
      await logout(auth.csrfToken);
      setAuth({ status: 'unauthenticated', csrfToken: null });
    } catch {
      setAuthError('No se pudo cerrar la sesión. Inténtalo de nuevo.');
    } finally {
      logoutPending.current = false;
      setLoggingOut(false);
    }
  }

  if (auth.status === 'checking') {
    return <main className="pairing-screen auth-checking" role="status">Verificando sesión...</main>;
  }
  if (auth.status === 'unauthenticated') {
    return <Pairing onPaired={completePairing} initialError={authError} />;
  }

  return (
    <div className="app">
      <Header onLogout={closeSession} loggingOut={loggingOut} />
      {authError && <p className="app-auth-error auth-error" role="alert">{authError}</p>}

      <div className="main-content">
        <Sidebar activeSection={activeSection} onSelectSection={setActiveSection} />
        <div className="app-viewer" hidden={activeSection === 'Acciones'}>
          <Viewer activeSection={activeSection} onSelectSection={setActiveSection}
            csrfToken={auth.csrfToken} onSessionExpired={invalidateSession} />
        </div>
        {activeSection === 'Acciones' && <Actions />}
      </div>
    </div>
  );
}

export default App;
