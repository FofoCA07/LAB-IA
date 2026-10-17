import './Header.css';

function Header({ onLogout, loggingOut }) {
  return (
    <header className="header">
      <div className="header-brand">
        <span className="header-title">LAB-IA</span>
        <p className="header-subtitle">Laboratorio de inteligencia artificial</p>
      </div>
      <div className="header-status" aria-label="Entorno local de referencia">
        <span className="model-badge">Qwen3:8b</span>
        <span className="local-badge">Local</span>
        <button className="logout-button" onClick={onLogout} disabled={loggingOut}>
          {loggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
        </button>
      </div>
    </header>
  );
}

export default Header;
