import Header from './Header';
import Sidebar from './Sidebar';
import Viewer from './Viewer';
import './App.css';

function App() {
  return (
    <div className="app">
      <Header />

      <div className="main-content">
        <Sidebar />
        <Viewer />
      </div>
    </div>
  );
}

export default App;