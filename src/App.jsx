import React from 'react';
import IngredientSelector from './components/IngredientSelector';
import './App.css';

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="eyebrow">D&D Crafting System</p>
        <h1>Arcane Crafting Workbench</h1>
        <p className="subtitle">
          Combine three ingredients, pick a discipline, and reveal the recipe shaped by potency,
          resonance, and entropy.
        </p>
      </header>
      <IngredientSelector />
      <footer className="app-footer">
        <p>Data is loaded from local JSON files. DM edits are session-only.</p>
      </footer>
    </div>
  );
}

export default App;
