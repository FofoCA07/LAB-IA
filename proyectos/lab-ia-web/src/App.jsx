import { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import Viewer from './Viewer';
import Actions from './Actions';
import './App.css';

function App() {
  const [activeSection, setActiveSection] = useState('Chat');
  return (
    <div className="app">
      <Header />

      <div className="main-content">
        <Sidebar activeSection={activeSection} onSelectSection={setActiveSection} />
        <div className="app-viewer" hidden={activeSection === 'Acciones'}>
          <Viewer activeSection={activeSection} onSelectSection={setActiveSection} />
        </div>
        {activeSection === 'Acciones' && <Actions />}
      </div>
    </div>
  );
}

export default App;
