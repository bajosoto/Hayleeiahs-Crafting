import React, { useEffect, useMemo, useState } from 'react';
import {
  calculateResult,
  calculateTotals,
  resolveDominantAttribute
} from '../utils/calculateResult';
import { supabase } from '../lib/supabaseClient';

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
const QUALITY_ORDER = { Potency: 0, Resonance: 1, Entropy: 2 };

const normalizeQuality = (value) => {
  const normalized = (value || '').trim();
  const lower = normalized.toLowerCase();
  if (lower === 'clarity') return 'Resonance';
  if (lower === 'chaos') return 'Entropy';
  if (lower === 'potency') return 'Potency';
  if (lower === 'resonance') return 'Resonance';
  if (lower === 'entropy') return 'Entropy';
  return normalized;
};

const normalizeIngredientRow = (row) => ({
  name: (row.name || '').trim(),
  potency: Number(row.potency ?? 0),
  resonance: Number(row.resonance ?? 0),
  entropy: Number(row.entropy ?? 0),
  rarity: row.rarity || '',
  source: row.source || ''
});

const normalizeRecipeRow = (row, disciplineFallback = '') => {
  const discipline = row.discipline || row.category || disciplineFallback;
  const recipeNo = Number(row.recipe_no ?? row.recipeNo ?? row.id ?? 0);
  return {
    id: recipeNo || row.id || 0,
    recipeNo,
    name: row.name || '',
    category: row.category || discipline,
    qualityCategory: normalizeQuality(row.quality_category || row.qualityCategory || ''),
    rarity: row.rarity || '',
    effect: row.effect || '',
    description: row.description || '',
    source: row.source || '',
    discipline
  };
};

const sortRecipes = (list) => {
  return [...list].sort((a, b) => {
    const qa = QUALITY_ORDER[a.qualityCategory] ?? 99;
    const qb = QUALITY_ORDER[b.qualityCategory] ?? 99;
    if (qa !== qb) return qa - qb;
    return (a.recipeNo || 0) - (b.recipeNo || 0);
  });
};

function IngredientSelector() {
  const hasSupabase = Boolean(supabase);

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
  const [syncError, setSyncError] = useState('');

  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState('anonymous');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const canEditData = !hasSupabase || userRole === 'dm';
  const canWriteInventory = !hasSupabase || userRole === 'dm' || userRole === 'party';

  useEffect(() => {
    if (!hasSupabase) return;
    let active = true;

    const fetchRole = async (currentSession) => {
      if (!currentSession?.user?.id) {
        if (active) setUserRole('anonymous');
        return;
      }
      const { data, error: roleError } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', currentSession.user.id)
        .single();
      if (!active) return;
      if (roleError || !data?.role) {
        setUserRole('anonymous');
        return;
      }
      setUserRole(data.role);
    };

    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      setSession(data.session || null);
      await fetchRole(data.session);
    };

    init();

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      fetchRole(nextSession);
    });

    return () => {
      active = false;
      listener?.subscription?.unsubscribe();
    };
  }, [hasSupabase]);

  useEffect(() => {
    if (hasSupabase && userRole !== 'dm') {
      setDmMode(false);
    }
  }, [hasSupabase, userRole]);

  useEffect(() => {
    let active = true;
    const loadData = async () => {
      try {
        setLoading(true);
        setLoadError('');
        setSyncError('');

        if (hasSupabase) {
          const [ingredientResult, inventoryResult, recipesResult] = await Promise.all([
            supabase.from('ingredients').select('*').order('name', { ascending: true }),
            supabase.from('inventory').select('*').order('name', { ascending: true }),
            supabase.from('recipes').select('*')
          ]);

          if (ingredientResult.error || inventoryResult.error || recipesResult.error) {
            throw new Error('Supabase query failed');
          }

          const ingredientData = (ingredientResult.data || [])
            .map(normalizeIngredientRow)
            .filter((item) => item.name);
          const inventoryData = (inventoryResult.data || []).map((row) => ({
            name: row.name,
            quantity: Number(row.quantity ?? 0)
          }));
          const recipeRows = (recipesResult.data || []).map((row) => normalizeRecipeRow(row));

          const grouped = { Herbalism: [], Alchemy: [], Poison: [] };
          recipeRows.forEach((recipe) => {
            if (grouped[recipe.discipline]) {
              grouped[recipe.discipline].push(recipe);
            }
          });

          const sortedRecipes = {
            Herbalism: sortRecipes(grouped.Herbalism),
            Alchemy: sortRecipes(grouped.Alchemy),
            Poison: sortRecipes(grouped.Poison)
          };

          if (!active) return;
          setIngredients(ingredientData);
          setInventory(inventoryData);
          setRecipes(sortedRecipes);

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
        } else {
          const baseUrl = import.meta.env.BASE_URL || '/';
          const [ingredientData, inventoryData, herb, alchemy, poison] = await Promise.all([
            fetch(`${baseUrl}data/ingredients.json`).then((res) => res.json()),
            fetch(`${baseUrl}data/inventory.json`).then((res) => res.json()),
            fetch(`${baseUrl}data/recipes_herbalism.json`).then((res) => res.json()),
            fetch(`${baseUrl}data/recipes_alchemy.json`).then((res) => res.json()),
            fetch(`${baseUrl}data/recipes_poison.json`).then((res) => res.json())
          ]);

          if (!active) return;

          const ingredientRows = ingredientData.map(normalizeIngredientRow);
          const herbRecipes = sortRecipes(herb.map((row) => normalizeRecipeRow(row, 'Herbalism')));
          const alchemyRecipes = sortRecipes(
            alchemy.map((row) => normalizeRecipeRow(row, 'Alchemy'))
          );
          const poisonRecipes = sortRecipes(poison.map((row) => normalizeRecipeRow(row, 'Poison')));

          setIngredients(ingredientRows);
          setInventory(inventoryData);
          setRecipes({
            Herbalism: herbRecipes,
            Alchemy: alchemyRecipes,
            Poison: poisonRecipes
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

          const sortedIngredients = [...ingredientRows].sort((a, b) => a.name.localeCompare(b.name));
          setGrantName(sortedIngredients[0]?.name || '');
        }

        setLoadError('');
      } catch (err) {
        if (!active) return;
        setLoadError(
          hasSupabase
            ? 'Failed to load data from Supabase. Check your tables and policies.'
            : 'Failed to load data. Check the JSON files in public/data.'
        );
      } finally {
        if (active) setLoading(false);
      }
    };

    loadData();
    return () => {
      active = false;
    };
  }, [hasSupabase]);

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

  const persistInventory = async (updates) => {
    if (!hasSupabase) return true;
    if (!canWriteInventory) {
      setError('Sign in as DM or Party to update inventory.');
      return false;
    }
    setSyncError('');
    const { error: upsertError } = await supabase
      .from('inventory')
      .upsert(updates, { onConflict: 'name' });
    if (upsertError) {
      setSyncError('Failed to sync inventory updates.');
      return false;
    }
    return true;
  };

  const handleCraft = async () => {
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
      if (!canWriteInventory) {
        setError('Sign in as DM or Party to deduct inventory.');
        return;
      }

      const updates = selectedNames.map((name) => ({
        name,
        quantity: Math.max(0, (inventoryMap.get(name) ?? 0) - 1)
      }));

      setInventory((prev) => {
        const next = prev.map((item) => ({ ...item }));
        updates.forEach((update) => {
          const index = next.findIndex((item) => item.name === update.name);
          if (index >= 0) {
            next[index].quantity = update.quantity;
          }
        });
        return next;
      });

      await persistInventory(updates);
    }
  };

  const handleClear = () => {
    setSelectedNames(['', '', '']);
    setResult(null);
    setError('');
  };

  const handleGrant = async () => {
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
    if (!canWriteInventory) {
      setDmMessage('Sign in as DM to grant inventory.');
      return;
    }

    const current = inventoryMap.get(grantName) ?? 0;
    const nextQuantity = current + quantity;

    setInventory((prev) => {
      const next = prev.map((item) => ({ ...item }));
      const index = next.findIndex((item) => item.name === grantName);
      if (index >= 0) {
        next[index].quantity += quantity;
      } else {
        next.push({ name: grantName, quantity: nextQuantity });
      }
      return next;
    });

    await persistInventory([{ name: grantName, quantity: nextQuantity }]);
    setDmMessage(`Granted ${quantity} ${grantName}.`);
  };

  const handleInventoryEdit = async (name, value) => {
    const quantity = Math.max(0, Number(value));
    if (!canWriteInventory) {
      setDmMessage('Sign in as DM to update inventory.');
      return;
    }

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

    await persistInventory([{ name, quantity }]);
  };

  const replaceIngredientsInDb = async (nextIngredients) => {
    if (!hasSupabase) return true;
    if (!canEditData) {
      setDmMessage('Sign in as DM to save ingredients.');
      return false;
    }

    setDmMessage('Saving ingredients to Supabase...');
    const { error: deleteError } = await supabase
      .from('ingredients')
      .delete()
      .neq('name', '');
    if (deleteError) {
      setDmMessage('Failed to clear ingredients table.');
      return false;
    }

    const { error: insertError } = await supabase
      .from('ingredients')
      .insert(nextIngredients);
    if (insertError) {
      setDmMessage('Failed to save ingredients.');
      return false;
    }

    setDmMessage('Ingredients saved to Supabase.');
    return true;
  };

  const replaceRecipesInDb = async (nextRecipes) => {
    if (!hasSupabase) return true;
    if (!canEditData) {
      setDmMessage('Sign in as DM to save recipes.');
      return false;
    }

    setDmMessage(`Saving ${discipline} recipes to Supabase...`);
    const { error: deleteError } = await supabase
      .from('recipes')
      .delete()
      .eq('discipline', discipline);
    if (deleteError) {
      setDmMessage('Failed to clear recipe list.');
      return false;
    }

    const payload = nextRecipes.map((recipe) => ({
      discipline,
      recipe_no: recipe.recipeNo || recipe.id || 0,
      name: recipe.name || '',
      category: recipe.category || discipline,
      quality_category: normalizeQuality(recipe.qualityCategory || recipe.quality_category || ''),
      rarity: recipe.rarity || '',
      effect: recipe.effect || '',
      description: recipe.description || '',
      source: recipe.source || ''
    }));

    const { error: insertError } = await supabase.from('recipes').insert(payload);
    if (insertError) {
      setDmMessage('Failed to save recipes.');
      return false;
    }

    setDmMessage(`${discipline} recipes saved to Supabase.`);
    return true;
  };

  const handleApplyIngredients = async () => {
    try {
      const parsed = JSON.parse(ingredientsDraft);
      if (!Array.isArray(parsed)) throw new Error('Ingredients JSON must be an array.');
      const normalized = parsed.map(normalizeIngredientRow).filter((item) => item.name);
      const saved = await replaceIngredientsInDb(normalized);
      if (saved) {
        setIngredients(normalized);
        setDmMessage('Ingredients updated in memory.');
      }
    } catch (err) {
      setDmMessage('Invalid ingredients JSON.');
    }
  };

  const handleApplyRecipes = async () => {
    try {
      const parsed = JSON.parse(recipesDraft);
      if (!Array.isArray(parsed)) throw new Error('Recipes JSON must be an array.');
      const normalized = sortRecipes(
        parsed.map((row) => normalizeRecipeRow(row, discipline)).filter((item) => item.name)
      );
      const saved = await replaceRecipesInDb(normalized);
      if (saved) {
        setRecipes((prev) => ({ ...prev, [discipline]: normalized }));
        setDmMessage(`${discipline} recipes updated in memory.`);
      }
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

  const handleSignIn = async (event) => {
    event.preventDefault();
    if (!hasSupabase) return;
    setAuthLoading(true);
    setAuthMessage('');

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: authEmail,
      password: authPassword
    });

    if (signInError) {
      setAuthMessage(signInError.message);
    } else {
      setAuthMessage('Signed in successfully.');
      setAuthPassword('');
    }

    setAuthLoading(false);
  };

  const handleSignOut = async () => {
    if (!hasSupabase) return;
    setAuthLoading(true);
    setAuthMessage('');
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) {
      setAuthMessage(signOutError.message);
    } else {
      setAuthMessage('Signed out.');
    }
    setAuthLoading(false);
  };

  return (
    <main className="app-grid">
      <section className="panel auth-panel">
        <div className="panel-header">
          <div>
            <h2>Access</h2>
            <p className="panel-subtitle">Sign in to sync inventory and DM edits.</p>
          </div>
          <span className="badge">
            {hasSupabase ? (session ? userRole : 'Guest') : 'Local'}
          </span>
        </div>

        {!hasSupabase && (
          <div className="panel-callout">
            Supabase is not configured. The app is running on local JSON data only.
          </div>
        )}

        {hasSupabase && (
          <div className="auth-grid">
            <div className="auth-status">
              <p>
                <strong>Status:</strong>{' '}
                {session?.user?.email ? `Signed in as ${session.user.email}` : 'Not signed in'}
              </p>
              <p>
                <strong>Role:</strong> {session ? userRole : 'Guest'}
              </p>
              <p className="hint">Inventory changes require DM or party login.</p>
            </div>
            <form className="auth-form" onSubmit={handleSignIn}>
              {!session && (
                <>
                  <label className="select-field">
                    <span>Email</span>
                    <input
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      required
                    />
                  </label>
                  <label className="select-field">
                    <span>Password</span>
                    <input
                      type="password"
                      value={authPassword}
                      onChange={(event) => setAuthPassword(event.target.value)}
                      required
                    />
                  </label>
                </>
              )}
              <div className="auth-actions">
                {session ? (
                  <button
                    className="ghost"
                    type="button"
                    onClick={handleSignOut}
                    disabled={authLoading}
                  >
                    Sign out
                  </button>
                ) : (
                  <button className="primary" type="submit" disabled={authLoading}>
                    Sign in
                  </button>
                )}
              </div>
            </form>
          </div>
        )}

        {authMessage && <div className="panel-callout">{authMessage}</div>}
        {syncError && <div className="panel-callout error">{syncError}</div>}
      </section>

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
            <p className="panel-subtitle">Update campaign data and inventory.</p>
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={dmMode}
              disabled={!canEditData}
              onChange={(event) => setDmMode(event.target.checked)}
            />
            Enable DM mode
          </label>
        </div>

        {!canEditData ? (
          <div className="empty-state">
            <p>Sign in as DM to edit ingredients, recipes, or inventory.</p>
          </div>
        ) : !dmMode ? (
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
