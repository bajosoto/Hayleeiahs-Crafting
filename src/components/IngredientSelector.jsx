import React, { useEffect, useMemo, useState } from 'react';
import {
  calculateResult,
  calculateTotals,
  resolveDominantAttribute
} from '../utils/calculateResult';

const DISCIPLINES = ['Herbalism', 'Alchemy', 'Poison'];
const ATTRIBUTE_LABELS = {
  potency: 'Potency',
  resonance: 'Resonance',
  entropy: 'Entropy'
};
const TIE_RULES = {
  Herbalism: 'Resonance > Entropy > Potency',
  Alchemy: 'Potency > Resonance > Entropy',
  Poison: 'Entropy > Potency > Resonance'
};

function IngredientSelector() {
  const [ingredients, setIngredients] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [recipes, setRecipes] = useState({ Herbalism: [], Alchemy: [], Poison: [] });
  const [selectedNames, setSelectedNames] = useState(['', '', '']);
  const [discipline, setDiscipline] = useState('Herbalism');
  const [deductOnCraft, setDeductOnCraft] = useState(true);
  const [recipeMode, setRecipeMode] = useState('deterministic');
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const [dmMode, setDmMode] = useState(false);
  const [grantName, setGrantName] = useState('');
  const [grantQuantity, setGrantQuantity] = useState(1);
  const [ingredientsDraft, setIngredientsDraft] = useState('');
  const [recipesDraft, setRecipesDraft] = useState('');
  const [dmMessage, setDmMessage] = useState('');

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      try {
        setLoading(true);
        const [ingredientData, inventoryData, herb, alchemy, poison] = await Promise.all([
          fetch('/data/ingredients.json').then((res) => res.json()),
          fetch('/data/inventory.json').then((res) => res.json()),
          fetch('/data/recipes_herbalism.json').then((res) => res.json()),
          fetch('/data/recipes_alchemy.json').then((res) => res.json()),
          fetch('/data/recipes_poison.json').then((res) => res.json())
        ]);

        if (!active) return;

        setIngredients(ingredientData);
        setInventory(inventoryData);
        setRecipes({
          Herbalism: herb,
          Alchemy: alchemy,
          Poison: poison
        });

        const sortedInventory = [...inventoryData].sort((a, b) => a.name.localeCompare(b.name));
        const initialSelection = sortedInventory
          .filter((item) => item.quantity > 0)
          .slice(0, 3)
          .map((item) => item.name);
        setSelectedNames([
          initialSelection[0] || '',
          initialSelection[1] || '',
          initialSelection[2] || ''
        ]);

        const sortedIngredients = [...ingredientData].sort((a, b) => a.name.localeCompare(b.name));
        setGrantName(sortedIngredients[0]?.name || '');
        setLoadError('');
      } catch (err) {
        if (!active) return;
        setLoadError('Failed to load data. Check the JSON files in public/data.');
      } finally {
        if (active) setLoading(false);
      }
    };

    loadData();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (ingredients.length) {
      setIngredientsDraft(JSON.stringify(ingredients, null, 2));
    }
  }, [ingredients]);

  useEffect(() => {
    const list = recipes[discipline] || [];
    setRecipesDraft(JSON.stringify(list, null, 2));
  }, [discipline, recipes]);

  const inventoryMap = useMemo(() => {
    const map = new Map();
    inventory.forEach((item) => map.set(item.name, item.quantity));
    return map;
  }, [inventory]);

  const ingredientMap = useMemo(() => {
    return new Map(ingredients.map((item) => [item.name, item]));
  }, [ingredients]);

  const sortedIngredients = useMemo(() => {
    return [...ingredients].sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredients]);

  const selectedIngredients = useMemo(() => {
    return selectedNames.map((name) => ingredientMap.get(name)).filter(Boolean);
  }, [selectedNames, ingredientMap]);

  const totals = useMemo(() => calculateTotals(selectedIngredients), [selectedIngredients]);
  const dominantAttribute = useMemo(() => {
    if (selectedIngredients.length !== 3) return null;
    return resolveDominantAttribute(totals, discipline);
  }, [totals, discipline, selectedIngredients.length]);

  const isTie = useMemo(() => {
    if (selectedIngredients.length !== 3) return false;
    const values = Object.values(totals);
    const maxValue = Math.max(...values);
    return values.filter((value) => value === maxValue).length > 1;
  }, [totals, selectedIngredients.length]);

  const inventoryRows = useMemo(() => {
    return ingredients
      .map((ingredient) => ({
        ...ingredient,
        quantity: inventoryMap.get(ingredient.name) ?? 0
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [ingredients, inventoryMap]);

  const inventoryDisplayRows = useMemo(() => {
    return inventoryRows.filter((ingredient) => ingredient.quantity > 0);
  }, [inventoryRows]);

  const handleSelectChange = (index, value) => {
    setSelectedNames((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setError('');
    setResult(null);
  };

  const handleCraft = () => {
    setError('');
    setDmMessage('');

    if (selectedNames.some((name) => !name)) {
      setError('Select three ingredients to craft.');
      return;
    }

    if (new Set(selectedNames).size < 3) {
      setError('Choose three unique ingredients.');
      return;
    }

    const missing = selectedNames.find((name) => (inventoryMap.get(name) ?? 0) <= 0);
    if (missing) {
      setError(`Not enough ${missing} in inventory.`);
      return;
    }

    const recipeList = recipes[discipline] || [];
    if (!recipeList.length) {
      setError(`No recipes loaded for ${discipline}.`);
      return;
    }

    const outcome = calculateResult(selectedIngredients, discipline, recipeList, {
      mode: recipeMode
    });

    setResult(outcome);

    if (deductOnCraft) {
      setInventory((prev) => {
        const next = prev.map((item) => ({ ...item }));
        selectedNames.forEach((name) => {
          const index = next.findIndex((item) => item.name === name);
          if (index >= 0) {
            next[index].quantity = Math.max(0, next[index].quantity - 1);
          }
        });
        return next;
      });
    }
  };

  const handleClear = () => {
    setSelectedNames(['', '', '']);
    setResult(null);
    setError('');
  };

  const handleGrant = () => {
    setDmMessage('');
    const quantity = Number(grantQuantity);
    if (!grantName) {
      setDmMessage('Pick an ingredient to grant.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setDmMessage('Enter a positive quantity.');
      return;
    }

    setInventory((prev) => {
      const next = prev.map((item) => ({ ...item }));
      const index = next.findIndex((item) => item.name === grantName);
      if (index >= 0) {
        next[index].quantity += quantity;
      } else {
        next.push({ name: grantName, quantity });
      }
      return next;
    });

    setDmMessage(`Granted ${quantity} ${grantName}.`);
  };

  const handleInventoryEdit = (name, value) => {
    const quantity = Math.max(0, Number(value));
    setInventory((prev) => {
      const next = prev.map((item) => ({ ...item }));
      const index = next.findIndex((item) => item.name === name);
      if (index >= 0) {
        next[index].quantity = quantity;
      } else {
        next.push({ name, quantity });
      }
      return next;
    });
  };

  const handleApplyIngredients = () => {
    try {
      const parsed = JSON.parse(ingredientsDraft);
      if (!Array.isArray(parsed)) throw new Error('Ingredients JSON must be an array.');
      setIngredients(parsed);
      setDmMessage('Ingredients updated in memory.');
    } catch (err) {
      setDmMessage('Invalid ingredients JSON.');
    }
  };

  const handleApplyRecipes = () => {
    try {
      const parsed = JSON.parse(recipesDraft);
      if (!Array.isArray(parsed)) throw new Error('Recipes JSON must be an array.');
      setRecipes((prev) => ({ ...prev, [discipline]: parsed }));
      setDmMessage(`${discipline} recipes updated in memory.`);
    } catch (err) {
      setDmMessage('Invalid recipes JSON.');
    }
  };

  const handleLoadIngredientsDraft = () => {
    setIngredientsDraft(JSON.stringify(ingredients, null, 2));
  };

  const handleLoadRecipesDraft = () => {
    setRecipesDraft(JSON.stringify(recipes[discipline] || [], null, 2));
  };

  return (
    <main className="app-grid">
      <section className="panel workbench">
        <div className="panel-header">
          <div>
            <h2>Workbench</h2>
            <p className="panel-subtitle">Craft with three ingredients and a discipline.</p>
          </div>
          <span className="badge">{discipline}</span>
        </div>

        {loading && <div className="panel-callout">Loading data...</div>}
        {loadError && <div className="panel-callout error">{loadError}</div>}

        <div className="workbench-grid">
          <div className="form-block">
            <h3>Ingredients</h3>
            <div className="select-grid">
              {selectedNames.map((value, index) => (
                <label className="select-field" key={`slot-${index}`}>
                  <span>Slot {index + 1}</span>
                  <select
                    value={value}
                    onChange={(event) => handleSelectChange(index, event.target.value)}
                  >
                    <option value="">Choose ingredient</option>
                    {inventoryRows
                      .filter((ingredient) => ingredient.quantity > 0)
                      .map((ingredient) => {
                      const alreadyPicked = selectedNames.includes(ingredient.name) && value !== ingredient.name;
                      const outOfStock = ingredient.quantity <= 0;
                      return (
                        <option
                          key={ingredient.name}
                          value={ingredient.name}
                          disabled={alreadyPicked || outOfStock}
                        >
                          {ingredient.name} ({ingredient.quantity} left)
                        </option>
                      );
                    })}
                  </select>
                </label>
              ))}
            </div>
            <button className="ghost" type="button" onClick={handleClear}>
              Clear selection
            </button>
          </div>

          <div className="form-block">
            <h3>Discipline</h3>
            <div className="discipline-grid">
              {DISCIPLINES.map((name) => (
                <label className="radio-card" key={name}>
                  <input
                    type="radio"
                    name="discipline"
                    value={name}
                    checked={discipline === name}
                    onChange={(event) => {
                      setDiscipline(event.target.value);
                      setResult(null);
                    }}
                  />
                  <span>{name}</span>
                </label>
              ))}
            </div>
            <p className="hint">Tie-breaker: {TIE_RULES[discipline]}</p>
          </div>
        </div>

        <div className="stat-grid">
          {Object.keys(ATTRIBUTE_LABELS).map((key) => (
            <div className="stat-card" key={key}>
              <span>{ATTRIBUTE_LABELS[key]}</span>
              <strong>{totals[key]}</strong>
            </div>
          ))}
        </div>

        <div className="actions">
          <label className="toggle">
            <input
              type="checkbox"
              checked={deductOnCraft}
              onChange={(event) => setDeductOnCraft(event.target.checked)}
            />
            Deduct ingredients on craft
          </label>
          <div className="toggle-group">
            <span>Recipe roll</span>
            <label>
              <input
                type="radio"
                name="recipe-mode"
                value="deterministic"
                checked={recipeMode === 'deterministic'}
                onChange={(event) => setRecipeMode(event.target.value)}
              />
              Deterministic
            </label>
            <label>
              <input
                type="radio"
                name="recipe-mode"
                value="random"
                checked={recipeMode === 'random'}
                onChange={(event) => setRecipeMode(event.target.value)}
              />
              Random
            </label>
          </div>
          <button
            className="primary"
            type="button"
            onClick={handleCraft}
            disabled={loading || !!loadError}
          >
            Craft recipe
          </button>
        </div>

        {error && <div className="panel-callout error">{error}</div>}
        {dominantAttribute && (
          <div className="panel-callout">
            Dominant attribute: {ATTRIBUTE_LABELS[dominantAttribute]}
            {isTie ? ' (tie-breaker applied)' : ''}
          </div>
        )}
      </section>

      <section className="panel result-panel">
        <div className="panel-header">
          <div>
            <h2>Crafted Result</h2>
            <p className="panel-subtitle">Your crafted item will appear here.</p>
          </div>
        </div>
        {result?.recipe ? (
          <div className="result-card">
            <h3>{result.recipe.name}</h3>
            <p className="result-meta">
              {result.recipe.category} | {result.recipe.rarity}
            </p>
            <p className="result-effect">{result.recipe.effect}</p>
            <div className="result-details">
              <span>Dominant: {ATTRIBUTE_LABELS[result.dominantAttribute]}</span>
              <span>
                Tier: {result.tierIndex + 1} | Roll: {result.roll + 1}/15
              </span>
            </div>
            {result.usedFallback && (
              <p className="notice">Recipe list is short, so a fallback recipe was used.</p>
            )}
          </div>
        ) : (
          <div className="empty-state">
            <p>No crafted item yet.</p>
            <p>Select ingredients and craft to reveal a recipe.</p>
          </div>
        )}
      </section>

      <section className="panel inventory-panel">
        <div className="panel-header">
          <div>
            <h2>Party Inventory</h2>
            <p className="panel-subtitle">Shared ingredients and their properties.</p>
          </div>
        </div>
        <div className="inventory-list">
          {inventoryDisplayRows.map((ingredient) => (
            <div className="inventory-row" key={ingredient.name}>
              <div>
                <h4>{ingredient.name}</h4>
                <p className="inventory-meta">
                  {ingredient.rarity} | {ingredient.source}
                </p>
                <p className="inventory-stats">
                  P {ingredient.potency} / R {ingredient.resonance} / E {ingredient.entropy}
                </p>
              </div>
              <div className="inventory-qty">x{ingredient.quantity}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="panel dm-panel">
        <div className="panel-header">
          <div>
            <h2>DM Tools</h2>
            <p className="panel-subtitle">Adjust data in memory for this session.</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={dmMode}
              onChange={(event) => setDmMode(event.target.checked)}
            />
            Enable DM mode
          </label>
        </div>

        {!dmMode ? (
          <div className="empty-state">
            <p>Enable DM mode to grant or edit ingredients.</p>
          </div>
        ) : (
          <div className="dm-grid">
            <div className="dm-card">
              <h3>Grant ingredients</h3>
              <label className="select-field">
                <span>Ingredient</span>
                <select
                  value={grantName}
                  onChange={(event) => setGrantName(event.target.value)}
                >
                  {sortedIngredients.map((ingredient) => (
                    <option key={ingredient.name} value={ingredient.name}>
                      {ingredient.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="select-field">
                <span>Quantity</span>
                <input
                  type="number"
                  min="1"
                  value={grantQuantity}
                  onChange={(event) => setGrantQuantity(event.target.value)}
                />
              </label>
              <button className="primary" type="button" onClick={handleGrant}>
                Grant
              </button>
            </div>

            <div className="dm-card">
              <h3>Edit inventory</h3>
              <div className="inventory-edit">
                {inventoryRows.map((ingredient) => (
                  <label className="inventory-edit-row" key={`edit-${ingredient.name}`}>
                    <span>{ingredient.name}</span>
                    <input
                      type="number"
                      min="0"
                      value={ingredient.quantity}
                      onChange={(event) =>
                        handleInventoryEdit(ingredient.name, event.target.value)
                      }
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="dm-card dm-wide">
              <h3>Ingredients JSON</h3>
              <textarea
                value={ingredientsDraft}
                onChange={(event) => setIngredientsDraft(event.target.value)}
                rows={10}
              />
              <div className="button-row">
                <button type="button" className="ghost" onClick={handleLoadIngredientsDraft}>
                  Load current
                </button>
                <button type="button" className="primary" onClick={handleApplyIngredients}>
                  Apply JSON
                </button>
              </div>
            </div>

            <div className="dm-card dm-wide">
              <h3>{discipline} recipes JSON</h3>
              <textarea
                value={recipesDraft}
                onChange={(event) => setRecipesDraft(event.target.value)}
                rows={10}
              />
              <div className="button-row">
                <button type="button" className="ghost" onClick={handleLoadRecipesDraft}>
                  Load current
                </button>
                <button type="button" className="primary" onClick={handleApplyRecipes}>
                  Apply JSON
                </button>
              </div>
            </div>

            {dmMessage && <div className="panel-callout">{dmMessage}</div>}
          </div>
        )}
      </section>
    </main>
  );
}

export default IngredientSelector;
