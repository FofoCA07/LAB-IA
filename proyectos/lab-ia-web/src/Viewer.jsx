import React from 'react';

const Viewer = () => {
  return (
    <div className="Viewer">
      <h1>Dashboard Principal</h1>
      <p>Panel de control para el laboratorio de inteligencia artificial</p>
      <div className="card-container">
        <div className="card">
          <h2>Documentación</h2>
          <p>Consulta toda la documentación del laboratorio desde un único lugar.</p>
        </div>
        <div className="card">
          <h2>Agentes IA</h2>
          <p>Explora los agentes especializados disponibles en LAB-IA.</p>
        </div>
      </div>
    </div>
  );
};

export default Viewer;