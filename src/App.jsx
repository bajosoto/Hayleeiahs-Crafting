import React from 'react';
import IngredientSelector from './components/IngredientSelector';
import './App.css';

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="eyebrow">D&D Crafting System</p>
        <h1>Hayleeiah's Crafting Workbench</h1>
      </header>
      <IngredientSelector />
      <footer className="app-footer">
        <p>Data loads from Supabase when configured; otherwise from local JSON files.</p>
      </footer>
    </div>
  );
}

export default App;
