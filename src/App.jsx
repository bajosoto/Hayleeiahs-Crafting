import React from 'react';
import IngredientSelector from './components/IngredientSelector';
import './App.css';

function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <p className="eyebrow">D&D Crafting System</p>
        <h1>Hayleeiah's Workbench</h1>
      </header>
      <IngredientSelector />
      <footer className="app-footer">
        <p>
          Made with 🖤 by{' '}
          <a href="https://github.com/bajosoto" target="_blank" rel="noreferrer">
            @bajosoto
          </a>{' '}
          for his D&amp;D amigos
        </p>
      </footer>
    </div>
  );
}

export default App;
