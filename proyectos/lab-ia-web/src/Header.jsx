import './Header.css';

function Header() {
  return (
    <header className="header">
      <div className="header-brand">
        <span className="header-title">LAB-IA</span>
        <p className="header-subtitle">Laboratorio de inteligencia artificial</p>
      </div>
      <div className="header-status" aria-label="Entorno local de referencia">
        <span className="model-badge">Qwen3:8b</span>
        <span className="local-badge">Local</span>
      </div>
    </header>
  );
}

export default Header;
