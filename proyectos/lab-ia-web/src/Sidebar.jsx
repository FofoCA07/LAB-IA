import './Sidebar.css';

const options = ['Chat', 'Agentes', 'Proyectos', 'Historial', 'Configuración'];

function Sidebar({ activeSection, onSelectSection }) {
  return (
    <aside className="sidebar">
      <p className="sidebar-label">Laboratorio</p>
      <nav aria-label="Secciones del laboratorio">
        <ul className="sidebar-menu">
          {options.map((option) => (
            <li key={option}>
              <button
                type="button"
                onClick={() => onSelectSection(option)}
                className={`sidebar-option${option === activeSection ? ' is-active' : ''}`}
                aria-current={option === activeSection ? 'page' : undefined}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <p className="sidebar-note">Un espacio para explorar, construir y aprender.</p>
    </aside>
  );
}

export default Sidebar;
