import { useState } from 'react';
import Header from './Header';
import Sidebar from './Sidebar';
import Viewer from './Viewer';
import './App.css';

function App() {
  const [activeSection, setActiveSection] = useState('Chat');
  return (
    <div className="app">
      <Header />

      <div className="main-content">
        <Sidebar activeSection={activeSection} onSelectSection={setActiveSection} />
        <Viewer activeSection={activeSection} onSelectSection={setActiveSection} />
      </div>
    </div>
  );
}

export default App;
